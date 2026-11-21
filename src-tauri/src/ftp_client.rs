use anyhow::Result;
use async_std::io::ReadExt;
use async_std::net::{TcpStream, ToSocketAddrs};
use serde::Deserialize;
use std::time::Duration;

use crate::connection_diagnostics::{
    classify_tcp_io_error, ConnectDiagnosticError, ConnectErrorKind, ConnectStage,
};
use crate::sftp_client::{FileEntry, FileEntryType};

/// Configuration for an FTP/FTPS connection.
#[derive(Debug, Clone, Deserialize)]
pub struct FtpConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub ftps_enabled: bool,
    pub anonymous: bool,
}

/// Wrapper enum to handle both plain and TLS FTP streams.
enum FtpStreamKind {
    Plain(suppaftp::AsyncFtpStream),
    Secure(suppaftp::AsyncNativeTlsFtpStream),
}

/// Dispatch a method call to whichever stream variant is active.
macro_rules! ftp_stream {
    ($self:expr, $s:ident => $body:expr) => {{
        let kind = $self
            .stream
            .as_mut()
            .ok_or_else(|| anyhow::anyhow!("FTP session not connected"))?;
        match kind {
            FtpStreamKind::Plain($s) => $body,
            FtpStreamKind::Secure($s) => $body,
        }
    }};
}

/// FTP/FTPS client using `suppaftp` with async support.
pub struct FtpClient {
    stream: Option<FtpStreamKind>,
}

impl FtpClient {
    pub async fn connect_with_progress(
        config: &FtpConfig,
        on_stage: impl Fn(ConnectStage) + Send + Sync + 'static,
    ) -> Result<Self> {
        let addr = format!("{}:{}", config.host, config.port);

        tracing::info!(
            "FTP connecting to {} (ftps={}, anonymous={})",
            addr,
            config.ftps_enabled,
            config.anonymous
        );

        // Use async_std timeout since suppaftp uses async_std internally
        let timeout_duration = Duration::from_secs(15);

        let mut current_stage = ConnectStage::ResolvingDns;
        let transport = async {
            on_stage(current_stage);
            let host = config
                .host
                .strip_prefix('[')
                .and_then(|s| s.strip_suffix(']'))
                .filter(|s| s.parse::<std::net::Ipv6Addr>().is_ok())
                .unwrap_or(&config.host);
            let addresses: Vec<_> = (host, config.port)
                .to_socket_addrs()
                .await
                .map_err(|e| {
                    ConnectDiagnosticError::new(
                        ConnectErrorKind::DnsFailure,
                        current_stage,
                        format!("Failed to resolve FTP host {}: {e}", config.host),
                    )
                })?
                .collect();
            if addresses.is_empty() {
                return Err(ConnectDiagnosticError::new(
                    ConnectErrorKind::DnsFailure,
                    current_stage,
                    format!("No addresses found for FTP host {}", config.host),
                )
                .into());
            }
            current_stage = ConnectStage::EstablishingTcp;
            on_stage(current_stage);
            let tcp = TcpStream::connect(addresses.as_slice())
                .await
                .map_err(|e| classify_tcp_io_error(&e, &config.host, config.port))?;
            current_stage = ConnectStage::FtpGreeting;
            on_stage(current_stage);
            let stream = if config.ftps_enabled {
                FtpStreamKind::Secure(
                    suppaftp::AsyncNativeTlsFtpStream::connect_with_stream(tcp)
                        .await
                        .map_err(|e| ftp_stage_error(current_stage, "FTP greeting failed", e))?,
                )
            } else {
                FtpStreamKind::Plain(
                    suppaftp::AsyncFtpStream::connect_with_stream(tcp)
                        .await
                        .map_err(|e| ftp_stage_error(current_stage, "FTP greeting failed", e))?,
                )
            };
            Ok::<_, anyhow::Error>(stream)
        };
        let mut stream_kind = async_std::future::timeout(timeout_duration, transport)
            .await
            .map_err(|_| {
                ConnectDiagnosticError::new(
                    ConnectErrorKind::TcpTimeout,
                    current_stage,
                    format!("FTP connection to {addr} timed out after 15s"),
                )
            })??;

        if let FtpStreamKind::Secure(ftp_stream) = stream_kind {
            on_stage(ConnectStage::TlsHandshake);
            let tls_connector =
                suppaftp::async_native_tls::TlsConnector::new().danger_accept_invalid_certs(true);
            let secure_stream = ftp_stream
                .into_secure(
                    suppaftp::AsyncNativeTlsConnector::from(tls_connector),
                    &config.host,
                )
                .await
                .map_err(|e| {
                    ftp_stage_error(ConnectStage::TlsHandshake, "FTPS TLS handshake failed", e)
                })?;
            stream_kind = FtpStreamKind::Secure(secure_stream);
        }

        // Authenticate
        on_stage(ConnectStage::Authenticating);
        {
            let (user, pass) = if config.anonymous {
                ("anonymous", "anonymous@")
            } else {
                (config.username.as_str(), config.password.as_str())
            };
            tracing::info!("FTP authenticating as '{}'", user);
            match &mut stream_kind {
                FtpStreamKind::Plain(s) => s.login(user, pass).await,
                FtpStreamKind::Secure(s) => s.login(user, pass).await,
            }
            .map_err(|e| {
                ConnectDiagnosticError::new(
                    ConnectErrorKind::AuthenticationFailed,
                    ConnectStage::Authenticating,
                    format!("FTP authentication failed for user '{user}': {e}"),
                )
            })?;
        }

        tracing::info!("FTP authenticated successfully");

        // Set binary transfer type
        on_stage(ConnectStage::SettingTransferMode);
        {
            match &mut stream_kind {
                FtpStreamKind::Plain(s) => s.transfer_type(suppaftp::types::FileType::Binary).await,
                FtpStreamKind::Secure(s) => {
                    s.transfer_type(suppaftp::types::FileType::Binary).await
                }
            }
            .map_err(|e| {
                ftp_stage_error(
                    ConnectStage::SettingTransferMode,
                    "Failed to set binary transfer type",
                    e,
                )
            })?;
        }

        tracing::info!("FTP connection fully established to {}", addr);

        Ok(Self {
            stream: Some(stream_kind),
        })
    }

    pub async fn disconnect(&mut self) -> Result<()> {
        if let Some(kind) = self.stream.take() {
            match kind {
                FtpStreamKind::Plain(mut s) => {
                    let _ = s.quit().await;
                }
                FtpStreamKind::Secure(mut s) => {
                    let _ = s.quit().await;
                }
            }
        }
        Ok(())
    }

    // ===== File Operations =====

    /// List directory contents at `path`.
    pub async fn list_dir(&mut self, path: &str) -> Result<Vec<FileEntry>> {
        let entries: Vec<String> = ftp_stream!(self, s => {
            s.list(Some(path)).await.map_err(|e| {
                anyhow::anyhow!("Failed to list directory '{}': {}", path, e)
            })?
        });

        let mut result = Vec::new();
        for line in entries {
            if let Some(entry) = parse_ftp_list_line(&line) {
                if entry.name == "." || entry.name == ".." {
                    continue;
                }
                result.push(entry);
            }
        }

        // Sort: directories first, then by name
        result.sort_by(|a, b| {
            let a_is_dir = matches!(a.file_type, FileEntryType::Directory);
            let b_is_dir = matches!(b.file_type, FileEntryType::Directory);
            b_is_dir
                .cmp(&a_is_dir)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });

        Ok(result)
    }

    /// Download a remote file to a local path. Returns bytes downloaded.
    pub async fn download_file(&mut self, remote_path: &str, local_path: &str) -> Result<u64> {
        let data: Vec<u8> = ftp_stream!(self, s => {
            let mut data_stream = s.retr_as_stream(remote_path).await.map_err(|e| {
                anyhow::anyhow!("Failed to download file '{}': {}", remote_path, e)
            })?;
            let mut buf = Vec::new();
            data_stream.read_to_end(&mut buf).await.map_err(|e| {
                anyhow::anyhow!("Failed to read download stream: {}", e)
            })?;
            s.finalize_retr_stream(data_stream).await.map_err(|e| {
                anyhow::anyhow!("Failed to finalize download: {}", e)
            })?;
            buf
        });

        let total_bytes = data.len() as u64;
        tokio::fs::write(local_path, data).await?;
        Ok(total_bytes)
    }

    /// Upload a local file to a remote path. Returns bytes uploaded.
    pub async fn upload_file(&mut self, local_path: &str, remote_path: &str) -> Result<u64> {
        let data = tokio::fs::read(local_path)
            .await
            .map_err(|e| anyhow::anyhow!("Failed to read local file '{}': {}", local_path, e))?;
        let total_bytes = data.len() as u64;

        ftp_stream!(self, s => {
            let mut reader = async_std::io::Cursor::new(data);
            s.put_file(remote_path, &mut reader).await.map_err(|e| {
                anyhow::anyhow!("Failed to upload file '{}': {}", remote_path, e)
            })?
        });

        Ok(total_bytes)
    }

    /// Create a directory on the remote server.
    pub async fn create_dir(&mut self, path: &str) -> Result<()> {
        ftp_stream!(self, s => {
            s.mkdir(path).await.map_err(|e| {
                anyhow::anyhow!("Failed to create directory '{}': {}", path, e)
            })?
        });
        Ok(())
    }

    /// Rename a file or directory.
    pub async fn rename(&mut self, old_path: &str, new_path: &str) -> Result<()> {
        ftp_stream!(self, s => {
            s.rename(old_path, new_path).await.map_err(|e| {
                anyhow::anyhow!("Failed to rename '{}' to '{}': {}", old_path, new_path, e)
            })?
        });
        Ok(())
    }

    /// Delete a file on the remote server.
    pub async fn delete_file(&mut self, path: &str) -> Result<()> {
        ftp_stream!(self, s => {
            s.rm(path).await.map_err(|e| {
                anyhow::anyhow!("Failed to delete file '{}': {}", path, e)
            })?
        });
        Ok(())
    }

    /// Delete a directory on the remote server.
    pub async fn delete_dir(&mut self, path: &str) -> Result<()> {
        ftp_stream!(self, s => {
            s.rmdir(path).await.map_err(|e| {
                anyhow::anyhow!("Failed to delete directory '{}': {}", path, e)
            })?
        });
        Ok(())
    }
}

fn ftp_stage_error(
    stage: ConnectStage,
    context: &str,
    error: impl std::fmt::Display,
) -> ConnectDiagnosticError {
    ConnectDiagnosticError::new(
        ConnectErrorKind::Unknown,
        stage,
        format!("{context}: {error}"),
    )
}

/// Parse a single line from the FTP LIST command (Unix format).
/// Example: `drwxr-xr-x   2 user group  4096 Jan 01 12:00 dirname`
fn parse_ftp_list_line(line: &str) -> Option<FileEntry> {
    let line = line.trim();
    if line.is_empty() {
        return None;
    }

    // Unix-style listing
    let parts: Vec<&str> = line.splitn(9, char::is_whitespace).collect();
    if parts.len() < 9 {
        // Try to at least get the name
        if let Some(last) = line.split_whitespace().last() {
            return Some(FileEntry {
                name: last.to_string(),
                size: 0,
                modified: None,
                permissions: None,
                file_type: FileEntryType::File,
            });
        }
        return None;
    }

    let perms_str = parts[0];
    let file_type = if perms_str.starts_with('d') {
        FileEntryType::Directory
    } else if perms_str.starts_with('l') {
        FileEntryType::Symlink
    } else {
        FileEntryType::File
    };

    // Filter out empty parts from whitespace splitting
    let tokens: Vec<&str> = line.split_whitespace().collect();
    if tokens.len() < 9 {
        let name = tokens.last().unwrap_or(&"").to_string();
        return Some(FileEntry {
            name,
            size: 0,
            modified: None,
            permissions: Some(perms_str.to_string()),
            file_type,
        });
    }

    let size = tokens[4].parse::<u64>().unwrap_or(0);
    let month = tokens[5];
    let day = tokens[6];
    let time_or_year = tokens[7];
    let modified = Some(format!("{} {} {}", month, day, time_or_year));
    // Name is everything after the 8th token (handles spaces in names)
    let name = tokens[8..].join(" ");
    // For symlinks, strip the " -> target" part from the name
    let name = if matches!(file_type, FileEntryType::Symlink) {
        name.split(" -> ").next().unwrap_or(&name).to_string()
    } else {
        name
    };

    Some(FileEntry {
        name,
        size,
        modified,
        permissions: Some(perms_str.to_string()),
        file_type,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn local_ftp_server(
        failure: Option<ConnectStage>,
    ) -> (FtpConfig, tokio::task::JoinHandle<()>) {
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let task = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            if failure == Some(ConnectStage::FtpGreeting) {
                socket.write_all(b"SSH-2.0-test\r\n").await.unwrap();
                return;
            }
            socket.write_all(b"220 Test FTP ready\r\n").await.unwrap();
            let (reader, mut writer) = socket.into_split();
            let mut lines = BufReader::new(reader).lines();
            while let Some(line) = lines.next_line().await.unwrap() {
                let command = line.split_whitespace().next().unwrap_or("");
                let reply = match command {
                    "USER" => "331 Password required\r\n",
                    "PASS" if failure == Some(ConnectStage::Authenticating) => {
                        "530 Login rejected\r\n"
                    }
                    "PASS" => "230 Logged in\r\n",
                    "TYPE" if failure == Some(ConnectStage::SettingTransferMode) => {
                        "500 TYPE rejected\r\n"
                    }
                    "TYPE" if line == "TYPE I" => "200 Binary mode\r\n",
                    "AUTH" => "534 TLS unavailable\r\n",
                    "QUIT" => "221 Goodbye\r\n",
                    _ => "500 Unsupported\r\n",
                };
                if writer.write_all(reply.as_bytes()).await.is_err() || command == "QUIT" {
                    break;
                }
            }
        });
        (
            FtpConfig {
                host: "127.0.0.1".into(),
                port,
                username: "test".into(),
                password: "test".into(),
                ftps_enabled: failure == Some(ConnectStage::TlsHandshake),
                anonymous: false,
            },
            task,
        )
    }

    #[tokio::test]
    async fn local_ftp_reports_progress_and_binary_mode() {
        let (config, server) = local_ftp_server(None).await;
        let stages = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let observed = stages.clone();
        let mut client = FtpClient::connect_with_progress(&config, move |stage| {
            observed.lock().unwrap().push(stage);
        })
        .await
        .unwrap();
        assert_eq!(
            *stages.lock().unwrap(),
            vec![
                ConnectStage::ResolvingDns,
                ConnectStage::EstablishingTcp,
                ConnectStage::FtpGreeting,
                ConnectStage::Authenticating,
                ConnectStage::SettingTransferMode,
            ]
        );
        client.disconnect().await.unwrap();
        server.await.unwrap();
    }

    #[tokio::test]
    async fn local_ftp_preserves_failed_stage_including_tls() {
        for stage in [
            ConnectStage::FtpGreeting,
            ConnectStage::TlsHandshake,
            ConnectStage::Authenticating,
            ConnectStage::SettingTransferMode,
        ] {
            let (config, server) = local_ftp_server(Some(stage)).await;
            let error = FtpClient::connect_with_progress(&config, |_| {})
                .await
                .err()
                .unwrap();
            let diagnostic = crate::connection_diagnostics::diagnostic_from_anyhow(&error).unwrap();
            assert_eq!(diagnostic.stage, stage);
            if stage == ConnectStage::Authenticating {
                assert_eq!(diagnostic.kind, ConnectErrorKind::AuthenticationFailed);
            }
            server.await.unwrap();
        }
    }

    #[tokio::test]
    #[ignore = "Requires a writable test FTP server and FTP_TEST_HOST, FTP_TEST_USER, FTP_TEST_PASS (optional FTP_TEST_PORT)"]
    async fn test_ftp_crud_cycle() {
        let config = FtpConfig {
            host: std::env::var("FTP_TEST_HOST").expect("set FTP_TEST_HOST"),
            port: std::env::var("FTP_TEST_PORT")
                .unwrap_or_else(|_| "21".into())
                .parse()
                .expect("FTP_TEST_PORT must be a valid port"),
            username: std::env::var("FTP_TEST_USER").expect("set FTP_TEST_USER"),
            password: std::env::var("FTP_TEST_PASS").expect("set FTP_TEST_PASS"),
            ftps_enabled: false,
            anonymous: false,
        };
        let mut client = FtpClient::connect_with_progress(&config, |_| {})
            .await
            .unwrap();

        let local = tempfile::Builder::new()
            .prefix("skd-ftp-")
            .tempdir()
            .unwrap();
        let dir_name = local.path().file_name().unwrap().to_str().unwrap();
        let test_dir = format!("/{dir_name}");
        let test_file_remote = format!("{test_dir}/hello.txt");
        let renamed_file_remote = format!("{test_dir}/hello_renamed.txt");
        client.create_dir(&test_dir).await.unwrap();

        let tmp_upload = local.path().join("upload.txt");
        let upload_content = b"Hello from skd E2E test!\nLine 2\n";
        tokio::fs::write(&tmp_upload, upload_content)
            .await
            .expect("write temp file");

        let uploaded_bytes = client
            .upload_file(tmp_upload.to_str().unwrap(), &test_file_remote)
            .await
            .expect("upload_file should succeed");
        assert_eq!(uploaded_bytes, upload_content.len() as u64);
        let entries = client.list_dir(&test_dir).await.unwrap();
        assert!(entries.iter().any(|e| e.name == "hello.txt"));

        let tmp_download = local.path().join("download.txt");
        let downloaded_bytes = client
            .download_file(&test_file_remote, tmp_download.to_str().unwrap())
            .await
            .expect("download_file should succeed");
        assert_eq!(downloaded_bytes, upload_content.len() as u64);

        let downloaded_data = tokio::fs::read(&tmp_download)
            .await
            .expect("read downloaded");
        assert_eq!(
            downloaded_data, upload_content,
            "downloaded content should match uploaded content"
        );

        client
            .rename(&test_file_remote, &renamed_file_remote)
            .await
            .unwrap();
        let entries = client.list_dir(&test_dir).await.unwrap();
        assert!(!entries.iter().any(|e| e.name == "hello.txt"));
        assert!(entries.iter().any(|e| e.name == "hello_renamed.txt"));

        client.delete_file(&renamed_file_remote).await.unwrap();
        client.delete_dir(&test_dir).await.unwrap();
        let root_entries = client.list_dir("/").await.unwrap();
        assert!(!root_entries.iter().any(|e| e.name == dir_name));
        client.disconnect().await.unwrap();
    }

    #[test]
    fn test_parse_ftp_list_line_unix_dir() {
        let line = "drwxr-xr-x   2 user group  4096 Jan 15 12:00 mydir";
        let entry = parse_ftp_list_line(line).expect("should parse");
        assert_eq!(entry.name, "mydir");
        assert!(matches!(entry.file_type, FileEntryType::Directory));
        assert_eq!(entry.size, 4096);
        assert_eq!(entry.permissions.as_deref(), Some("drwxr-xr-x"));
    }

    #[test]
    fn test_parse_ftp_list_line_unix_file() {
        let line = "-rw-r--r--   1 user group  12345 Feb 28 09:30 report.pdf";
        let entry = parse_ftp_list_line(line).expect("should parse");
        assert_eq!(entry.name, "report.pdf");
        assert!(matches!(entry.file_type, FileEntryType::File));
        assert_eq!(entry.size, 12345);
    }

    #[test]
    fn test_parse_ftp_list_line_symlink() {
        let line = "lrwxrwxrwx   1 user group  10 Mar 01 00:00 link -> target";
        let entry = parse_ftp_list_line(line).expect("should parse");
        assert_eq!(entry.name, "link");
        assert!(matches!(entry.file_type, FileEntryType::Symlink));
    }

    #[test]
    fn test_parse_ftp_list_line_name_with_spaces() {
        let line = "-rw-r--r--   1 user group  100 Dec 25 23:59 my file name.txt";
        let entry = parse_ftp_list_line(line).expect("should parse");
        assert_eq!(entry.name, "my file name.txt");
    }

    #[test]
    fn test_parse_ftp_list_line_empty() {
        assert!(parse_ftp_list_line("").is_none());
        assert!(parse_ftp_list_line("   ").is_none());
    }

    #[test]
    fn test_parse_ftp_list_line_dot_entries() {
        // These are filtered out in list_dir, but the parser itself should parse them
        let line = "drwxr-xr-x   2 user group  4096 Jan 01 00:00 .";
        let entry = parse_ftp_list_line(line).expect("should parse");
        assert_eq!(entry.name, ".");
    }

    // ---- Task 5.4: Additional unit tests ----

    #[test]
    fn test_parse_ftp_list_large_file_size() {
        let line = "-rw-r--r--   1 user group  9999999999 Dec 31 23:59 huge.iso";
        let entry = parse_ftp_list_line(line).expect("should parse");
        assert_eq!(entry.name, "huge.iso");
        assert_eq!(entry.size, 9999999999);
    }

    #[test]
    fn test_parse_ftp_list_zero_size() {
        let line = "-rw-r--r--   1 user group  0 Apr 01 00:00 empty.txt";
        let entry = parse_ftp_list_line(line).expect("should parse");
        assert_eq!(entry.size, 0);
    }
}
