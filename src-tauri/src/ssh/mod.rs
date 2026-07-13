mod key_loader;

use crate::connection_diagnostics::{
    classify_handshake_error, classify_tcp_io_error, default_tcp_timeout, ConnectDiagnosticError,
    ConnectErrorKind, ConnectStage,
};
use crate::known_hosts::{
    format_mismatch_host_error, format_unknown_host_error, verify_host_key, VerifyResult,
};
use crate::pty_session::PtySession;
use anyhow::Result;
use russh::*;
use russh_keys::*;
pub use key_loader::{key_file_permission_warning, load_private_key_from_content, read_private_key_file};
use russh_sftp::client::SftpSession;
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{lookup_host, TcpStream};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

/// Preferred host-key algorithms advertised to the server, ordered from most to
/// least preferred.  RSA variants (including the legacy `ssh-rsa` / SHA-1) are
/// included so that older servers that only offer RSA host keys are still
/// reachable.  The `openssl` feature on `russh` / `russh-keys` must be enabled
/// for the RSA entries to have any effect.
pub static PREFERRED_HOST_KEY_ALGOS: &[russh_keys::key::Name] = &[
    russh_keys::key::ED25519,
    russh_keys::key::ECDSA_SHA2_NISTP256,
    russh_keys::key::ECDSA_SHA2_NISTP521,
    russh_keys::key::RSA_SHA2_256,
    russh_keys::key::RSA_SHA2_512,
    russh_keys::key::SSH_RSA,
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_method: AuthMethod,
    pub host_key_verification: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum AuthMethod {
    Password {
        password: String,
    },
    PublicKey {
        key_content: String,
        passphrase: Option<String>,
    },
}

pub struct SshClient {
    session: Option<Arc<client::Handle<Client>>>,
}

/// SSH client handler with optional host-key verification.
pub struct SshHandler {
    pub host: String,
    pub port: u16,
    pub verify_host_key: bool,
}

impl SshHandler {
    pub fn new(host: String, port: u16, verify_host_key: bool) -> Self {
        Self {
            host,
            port,
            verify_host_key,
        }
    }
}

#[async_trait::async_trait]
impl client::Handler for SshHandler {
    type Error = anyhow::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &key::PublicKey,
    ) -> Result<bool, Self::Error> {
        if !self.verify_host_key {
            return Ok(true);
        }

        match verify_host_key(&self.host, self.port, server_public_key)? {
            VerifyResult::Known => Ok(true),
            VerifyResult::Unknown { .. } => Err(anyhow::anyhow!(format_unknown_host_error(
                &self.host,
                self.port,
                server_public_key,
            ))),
            VerifyResult::Mismatch { .. } => {
                let result = verify_host_key(&self.host, self.port, server_public_key)?;
                Err(anyhow::anyhow!(format_mismatch_host_error(
                    &self.host,
                    self.port,
                    &result,
                )))
            }
        }
    }
}

/// Backward-compatible alias used by SFTP client.
pub type Client = SshHandler;

impl SshClient {
    pub fn new() -> Self {
        Self { session: None }
    }

    pub async fn connect(&mut self, config: &SshConfig) -> Result<()> {
        self.connect_with_progress(config, default_tcp_timeout(), |_| {}).await
    }

    /// Staged SSH connect with progress callbacks for diagnostics UI.
    pub async fn connect_with_progress(
        &mut self,
        config: &SshConfig,
        tcp_timeout: Duration,
        on_stage: impl FnMut(ConnectStage),
    ) -> Result<()> {
        let session = establish_authenticated_session(config, tcp_timeout, on_stage).await?;
        self.session = Some(Arc::new(session));
        Ok(())
    }
}

/// Establish an authenticated SSH session with staged progress reporting.
///
/// Stages: DNS → TCP → host key / handshake → authenticate.
pub async fn establish_authenticated_session(
    config: &SshConfig,
    tcp_timeout: Duration,
    mut on_stage: impl FnMut(ConnectStage),
) -> Result<client::Handle<SshHandler>> {
    // ── 1. DNS ──────────────────────────────────────────────────────────────
    on_stage(ConnectStage::ResolvingDns);
    let addrs: Vec<SocketAddr> = match lookup_host((config.host.as_str(), config.port)).await {
        Ok(iter) => iter.collect(),
        Err(e) => {
            return Err(ConnectDiagnosticError::new(
                ConnectErrorKind::DnsFailure,
                ConnectStage::ResolvingDns,
                format!(
                    "Failed to resolve hostname '{}': {}. Check the host name and DNS settings.",
                    config.host, e
                ),
            )
            .into());
        }
    };

    if addrs.is_empty() {
        return Err(ConnectDiagnosticError::new(
            ConnectErrorKind::DnsFailure,
            ConnectStage::ResolvingDns,
            format!(
                "No addresses found for hostname '{}'. Check the host name and DNS settings.",
                config.host
            ),
        )
        .into());
    }

    // ── 2. TCP ──────────────────────────────────────────────────────────────
    on_stage(ConnectStage::EstablishingTcp);
    let mut last_tcp_error: Option<ConnectDiagnosticError> = None;
    let mut stream: Option<TcpStream> = None;

    for addr in &addrs {
        match tokio::time::timeout(tcp_timeout, TcpStream::connect(addr)).await {
            Ok(Ok(s)) => {
                stream = Some(s);
                break;
            }
            Ok(Err(e)) => {
                last_tcp_error = Some(classify_tcp_io_error(&e, &config.host, config.port));
            }
            Err(_) => {
                last_tcp_error = Some(ConnectDiagnosticError::new(
                    ConnectErrorKind::TcpTimeout,
                    ConnectStage::EstablishingTcp,
                    format!(
                        "Connection timed out after {} seconds while reaching {}:{} ({}). Check the host address and network connectivity.",
                        tcp_timeout.as_secs(),
                        config.host,
                        config.port,
                        addr
                    ),
                ));
            }
        }
    }

    let stream = match stream {
        Some(s) => s,
        None => {
            return Err(last_tcp_error
                .unwrap_or_else(|| {
                    ConnectDiagnosticError::new(
                        ConnectErrorKind::Unknown,
                        ConnectStage::EstablishingTcp,
                        format!(
                            "Failed to connect to {}:{}",
                            config.host, config.port
                        ),
                    )
                })
                .into());
        }
    };

    // ── 3. Host key + SSH handshake ─────────────────────────────────────────
    // Host-key verification runs inside connect_stream via SshHandler.
    on_stage(ConnectStage::VerifyingHostKey);
    on_stage(ConnectStage::SshHandshake);

    let ssh_config = client::Config {
        preferred: russh::Preferred {
            key: std::borrow::Cow::Borrowed(PREFERRED_HOST_KEY_ALGOS),
            ..russh::Preferred::DEFAULT
        },
        // Send a keepalive every 60 s. After 3 missed replies russh closes
        // the connection, preventing the server from silently dropping idle
        // sessions after hours of inactivity.
        keepalive_interval: Some(Duration::from_secs(60)),
        keepalive_max: 3,
        ..client::Config::default()
    };

    let handler = SshHandler::new(
        config.host.clone(),
        config.port,
        config.host_key_verification,
    );

    let mut ssh_session =
        match client::connect_stream(Arc::new(ssh_config), stream, handler).await {
            Ok(session) => session,
            Err(e) => {
                let err = anyhow::anyhow!(e);
                return Err(classify_handshake_error(&err, &config.host, config.port).into());
            }
        };

    // ── 4. Authenticate ─────────────────────────────────────────────────────
    on_stage(ConnectStage::Authenticating);

    let authenticated = match &config.auth_method {
        AuthMethod::Password { password } => match ssh_session
            .authenticate_password(&config.username, password)
            .await
        {
            Ok(ok) => ok,
            Err(e) => {
                return Err(ConnectDiagnosticError::new(
                    ConnectErrorKind::PasswordIncorrect,
                    ConnectStage::Authenticating,
                    format!("Password authentication failed: {e}"),
                )
                .into());
            }
        },
        AuthMethod::PublicKey {
            key_content,
            passphrase,
        } => {
            let key = match load_private_key_from_content(key_content, passphrase.as_deref()) {
                Ok(k) => k,
                Err(e) => {
                    let message = e.to_string();
                    let kind = if message.to_lowercase().contains("passphrase")
                        || message.to_lowercase().contains("decrypt")
                    {
                        // Wrong passphrase is closer to auth failure than format.
                        ConnectErrorKind::PrivateKeyFormatUnsupported
                    } else {
                        ConnectErrorKind::PrivateKeyFormatUnsupported
                    };
                    return Err(ConnectDiagnosticError::new(
                        kind,
                        ConnectStage::Authenticating,
                        message,
                    )
                    .into());
                }
            };

            match ssh_session
                .authenticate_publickey(&config.username, Arc::new(key))
                .await
            {
                Ok(ok) => ok,
                Err(e) => {
                    return Err(ConnectDiagnosticError::new(
                        ConnectErrorKind::PublicKeyUnauthorized,
                        ConnectStage::Authenticating,
                        format!(
                            "Public key authentication failed: {e}. The key may not be authorized on the server."
                        ),
                    )
                    .into());
                }
            }
        }
    };

    if !authenticated {
        let (kind, message) = match &config.auth_method {
            AuthMethod::Password { .. } => (
                ConnectErrorKind::PasswordIncorrect,
                "Password authentication failed. Please check your password and try again."
                    .to_string(),
            ),
            AuthMethod::PublicKey { .. } => (
                ConnectErrorKind::PublicKeyUnauthorized,
                "Public key authentication failed. The key may not be authorized on the server."
                    .to_string(),
            ),
        };
        return Err(ConnectDiagnosticError::new(kind, ConnectStage::Authenticating, message).into());
    }

    Ok(ssh_session)
}

impl SshClient {
    // Changed to &self instead of &mut self to allow concurrent access
    pub async fn execute_command(&self, command: &str) -> Result<String> {
        if let Some(session) = &self.session {
            let mut channel = session.channel_open_session().await?;
            channel.exec(true, command).await?;

            let mut output = String::new();
            let mut code = None;
            let mut eof_received = false;
            let mut server_closed = false;

            loop {
                let msg = channel.wait().await;
                match msg {
                    Some(ChannelMsg::Data { ref data }) => {
                        output.push_str(&String::from_utf8_lossy(data));
                    }
                    Some(ChannelMsg::ExitStatus { exit_status }) => {
                        code = Some(exit_status);
                        if eof_received {
                            break;
                        }
                    }
                    Some(ChannelMsg::Eof) => {
                        eof_received = true;
                        if code.is_some() {
                            break;
                        }
                    }
                    Some(ChannelMsg::Close) => {
                        server_closed = true;
                        break;
                    }
                    None => {
                        server_closed = true;
                        break;
                    }
                    _ => {}
                }
            }

            // Send SSH_MSG_CHANNEL_CLOSE if the server hasn't already closed the channel.
            // Without this, russh's session keeps the channel in its internal map until
            // the session is torn down, causing per-poll memory growth.
            if !server_closed {
                let _ = channel.close().await;
            }

            // Consider success if we got output and no explicit error code, or code 0
            match code {
                Some(0) => Ok(output),
                None if !output.is_empty() => Ok(output), // No exit code but got output = success
                _ => Err(anyhow::anyhow!("Command failed with code: {:?}", code)),
            }
        } else {
            Err(anyhow::anyhow!("Not connected"))
        }
    }

    pub async fn disconnect(&mut self) -> Result<()> {
        if let Some(session) = self.session.take() {
            // Try to unwrap Arc, if we're the only owner
            match Arc::try_unwrap(session) {
                Ok(session) => {
                    session
                        .disconnect(Disconnect::ByApplication, "", "English")
                        .await?;
                }
                Err(arc_session) => {
                    // Other references exist, just drop our reference
                    drop(arc_session);
                }
            }
        }
        Ok(())
    }

    pub fn is_connected(&self) -> bool {
        self.session.is_some()
    }

    /// Clone of the authenticated session handle for concurrent channels
    /// (PTY, SFTP, local port forwarding, etc.).
    pub fn session_handle(&self) -> Option<Arc<client::Handle<Client>>> {
        self.session.clone()
    }

    /// Create a persistent PTY shell session (like ttyd)
    /// This enables interactive commands like vim, less, more, top, etc.
    pub async fn create_pty_session(&self, cols: u32, rows: u32) -> Result<PtySession> {
        if let Some(session) = &self.session {
            // Open a new SSH channel
            let mut channel = session.channel_open_session().await.map_err(|e| {
                ConnectDiagnosticError::pty_failed(format!("Failed to open SSH channel for PTY: {e}"))
            })?;

            // Request PTY with terminal type and dimensions
            // Similar to ttyd's approach: xterm-256color terminal
            channel
                .request_pty(
                    true,             // want_reply
                    "xterm-256color", // terminal type (like ttyd)
                    cols,             // columns
                    rows,             // rows
                    0,                // pixel_width (not used)
                    0,                // pixel_height (not used)
                    &[],              // terminal modes
                )
                .await
                .map_err(|e| {
                    ConnectDiagnosticError::pty_failed(format!("Failed to request PTY: {e}"))
                })?;

            // Start interactive shell
            channel.request_shell(true).await.map_err(|e| {
                ConnectDiagnosticError::pty_failed(format!("Failed to start shell on PTY: {e}"))
            })?;

            // Create channels for bidirectional communication (like ttyd's pty_buf)
            // Increased capacity for better buffering during fast input
            let (input_tx, mut input_rx) = mpsc::channel::<Vec<u8>>(1000); // Increased from 100
            let (output_tx, output_rx) = mpsc::channel::<Vec<u8>>(128); // Bounded: back-pressure to SSH window

            // Clone channel for input task
            let input_channel = channel.make_writer();

            // Create a channel for resize requests
            let (resize_tx, mut resize_rx) = mpsc::channel::<(u32, u32)>(16);

            // Spawn task to handle input (frontend → SSH)
            // This is similar to ttyd's pty_write and INPUT command handling
            // Key: immediate write + flush for responsiveness
            tokio::spawn(async move {
                let mut writer = input_channel;
                while let Some(data) = input_rx.recv().await {
                    // Write data immediately
                    if let Err(e) = writer.write_all(&data).await {
                        eprintln!("[PTY] Failed to send data to SSH: {}", e);
                        break;
                    }
                    // Critical: flush immediately after write (like ttyd)
                    // This ensures data is sent to PTY without buffering delay
                    if let Err(e) = writer.flush().await {
                        eprintln!("[PTY] Failed to flush data to SSH: {}", e);
                        break;
                    }
                }
            });

            // Spawn task to handle output (SSH → frontend) AND resize requests.
            // The channel must stay in this task because `wait()` requires `&mut self`,
            // but we also need `window_change()` which only requires `&self`.
            // We use `tokio::select!` to multiplex between output reading and resize.
            tokio::spawn(async move {
                loop {
                    tokio::select! {
                        msg = channel.wait() => {
                            match msg {
                                Some(ChannelMsg::Data { data }) => {
                                    if output_tx.send(data.to_vec()).await.is_err() {
                                        break;
                                    }
                                }
                                Some(ChannelMsg::ExtendedData { data, .. }) => {
                                    // stderr data (also send to output)
                                    if output_tx.send(data.to_vec()).await.is_err() {
                                        break;
                                    }
                                }
                                Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => {
                                    eprintln!("[PTY] Channel closed");
                                    break;
                                }
                                Some(ChannelMsg::ExitStatus { exit_status }) => {
                                    eprintln!("[PTY] Process exited with status: {}", exit_status);
                                }
                                _ => {}
                            }
                        }
                        resize = resize_rx.recv() => {
                            match resize {
                                Some((cols, rows)) => {
                                    if let Err(e) = channel.window_change(cols, rows, 0, 0).await {
                                        eprintln!("[PTY] Failed to send window change: {}", e);
                                    } else {
                                        eprintln!("[PTY] Window changed to {}x{}", cols, rows);
                                    }
                                }
                                None => {
                                    // resize channel closed, session is being torn down
                                    break;
                                }
                            }
                        }
                    }
                }
            });

            Ok(PtySession {
                input_tx,
                output_rx: Arc::new(tokio::sync::Mutex::new(output_rx)),
                resize_tx,
                cancel: CancellationToken::new(),
            })
        } else {
            Err(anyhow::anyhow!("Not connected"))
        }
    }

    pub async fn download_file(&self, remote_path: &str, local_path: &str) -> Result<u64> {
        if let Some(session) = &self.session {
            // Open SFTP subsystem
            let channel = session.channel_open_session().await?;
            channel.request_subsystem(true, "sftp").await?;
            let sftp = SftpSession::new(channel.into_stream()).await?;

            // Open remote file for reading
            let mut remote_file = sftp.open(remote_path).await?;

            // Read file content
            let mut buffer = Vec::new();
            let mut temp_buf = vec![0u8; 8192];
            let mut total_bytes = 0u64;

            loop {
                let n = remote_file.read(&mut temp_buf).await?;
                if n == 0 {
                    break;
                }
                buffer.extend_from_slice(&temp_buf[..n]);
                total_bytes += n as u64;
            }

            // Write to local file
            tokio::fs::write(local_path, buffer).await?;

            Ok(total_bytes)
        } else {
            Err(anyhow::anyhow!("Not connected"))
        }
    }

    pub async fn download_file_to_memory(&self, remote_path: &str) -> Result<Vec<u8>> {
        if let Some(session) = &self.session {
            // Open SFTP subsystem
            let channel = session.channel_open_session().await?;
            channel.request_subsystem(true, "sftp").await?;
            let sftp = SftpSession::new(channel.into_stream()).await?;

            // Open remote file for reading
            let mut remote_file = sftp.open(remote_path).await?;

            // Read file content
            let mut buffer = Vec::new();
            let mut temp_buf = vec![0u8; 8192];

            loop {
                let n = remote_file.read(&mut temp_buf).await?;
                if n == 0 {
                    break;
                }
                buffer.extend_from_slice(&temp_buf[..n]);
            }

            Ok(buffer)
        } else {
            Err(anyhow::anyhow!("Not connected"))
        }
    }

    pub async fn upload_file(&self, local_path: &str, remote_path: &str) -> Result<u64> {
        if let Some(session) = &self.session {
            // Read local file
            let data = tokio::fs::read(local_path).await?;
            let total_bytes = data.len() as u64;

            // Open SFTP subsystem
            let channel = session.channel_open_session().await?;
            channel.request_subsystem(true, "sftp").await?;
            let sftp = SftpSession::new(channel.into_stream()).await?;

            // Create remote file for writing
            let mut remote_file = sftp.create(remote_path).await?;

            // Write data in chunks
            let mut offset = 0;
            let chunk_size = 8192;

            while offset < data.len() {
                let end = std::cmp::min(offset + chunk_size, data.len());
                remote_file.write_all(&data[offset..end]).await?;
                offset = end;
            }

            remote_file.flush().await?;

            Ok(total_bytes)
        } else {
            Err(anyhow::anyhow!("Not connected"))
        }
    }

    pub async fn upload_file_from_bytes(&self, data: &[u8], remote_path: &str) -> Result<u64> {
        if let Some(session) = &self.session {
            let total_bytes = data.len() as u64;

            // Open SFTP subsystem
            let channel = session.channel_open_session().await?;
            channel.request_subsystem(true, "sftp").await?;
            let sftp = SftpSession::new(channel.into_stream()).await?;

            // Create remote file for writing
            let mut remote_file = sftp.create(remote_path).await?;

            // Write data in chunks
            let mut offset = 0;
            let chunk_size = 8192;

            while offset < data.len() {
                let end = std::cmp::min(offset + chunk_size, data.len());
                remote_file.write_all(&data[offset..end]).await?;
                offset = end;
            }

            remote_file.flush().await?;

            Ok(total_bytes)
        } else {
            Err(anyhow::anyhow!("Not connected"))
        }
    }
}

#[cfg(test)]
mod tests;
