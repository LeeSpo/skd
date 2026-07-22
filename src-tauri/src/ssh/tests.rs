#[cfg(test)]
mod tests {
    use crate::ssh::{AuthMethod, SshClient, SshConfig};
    use std::sync::Arc;
    use tokio::sync::RwLock;

    // Test credentials - Replace with your own test server credentials
    const TEST_HOST: &str = "localhost"; // Replace with your test SSH server
    const TEST_USERNAME: &str = "testuser"; // Replace with your test username
    const TEST_PASSWORD: &str = "testpass"; // Replace with your test password
    const TEST_PORT: u16 = 22;

    fn create_test_config() -> SshConfig {
        SshConfig {
            host: TEST_HOST.to_string(),
            port: TEST_PORT,
            username: TEST_USERNAME.to_string(),
            auth_method: AuthMethod::Password {
                password: TEST_PASSWORD.to_string(),
            },
            host_key_verification: false,
        }
    }

    async fn connect_client(client: &mut SshClient, config: &SshConfig) -> anyhow::Result<()> {
        client
            .connect_with_progress(
                config,
                crate::connection_diagnostics::default_tcp_timeout(),
                |_| {},
                None,
            )
            .await
    }

    // Unit test - doesn't require external SSH server
    #[test]
    fn test_ssh_config_creation() {
        let config = create_test_config();
        assert_eq!(config.host, "localhost");
        assert_eq!(config.port, 22);
        assert_eq!(config.username, "testuser");
    }

    // Note: The following tests are integration tests that require a running SSH server.
    // They are marked as ignored to prevent CI failures.
    // To run these tests locally, start an SSH server and run: cargo test -- --ignored --nocapture

    #[tokio::test]
    #[ignore]
    async fn test_ssh_connection() {
        let client = Arc::new(RwLock::new(SshClient::new()));
        let mut client_write = client.write().await;
        let config = create_test_config();

        let result = connect_client(&mut client_write, &config).await;

        assert!(
            result.is_ok(),
            "SSH connection should succeed: {:?}",
            result.err()
        );

        // Disconnect
        let disconnect_result = client_write.disconnect().await;
        assert!(disconnect_result.is_ok(), "Disconnect should succeed");
    }

    #[tokio::test]
    #[ignore]
    async fn test_execute_command() {
        let client = Arc::new(RwLock::new(SshClient::new()));
        let mut client_write = client.write().await;
        let config = create_test_config();

        // Connect
        connect_client(&mut client_write, &config)
            .await
            .expect("Failed to connect");

        // Execute command
        let output = client_write
            .execute_command("echo 'test'")
            .await
            .expect("Failed to execute command");

        assert!(
            output.contains("test"),
            "Command output should contain 'test'"
        );

        // Disconnect
        client_write.disconnect().await.ok();
    }

    #[tokio::test]
    #[ignore]
    async fn test_invalid_credentials() {
        let client = Arc::new(RwLock::new(SshClient::new()));
        let mut client_write = client.write().await;

        let config = SshConfig {
            host: TEST_HOST.to_string(),
            port: TEST_PORT,
            username: TEST_USERNAME.to_string(),
            auth_method: AuthMethod::Password {
                password: "wrongpassword".to_string(),
            },
            host_key_verification: false,
        };

        let result = connect_client(&mut client_write, &config).await;

        assert!(
            result.is_err(),
            "Connection with invalid password should fail"
        );
    }

    #[tokio::test]
    #[ignore]
    async fn test_get_system_stats() {
        let client = Arc::new(RwLock::new(SshClient::new()));
        let mut client_write = client.write().await;
        let config = create_test_config();

        // Connect
        connect_client(&mut client_write, &config)
            .await
            .expect("Failed to connect");

        // Get CPU usage
        let cpu_output = client_write
            .execute_command("top -bn1 | grep 'Cpu(s)' | awk '{print $2}' | cut -d'%' -f1")
            .await;
        assert!(cpu_output.is_ok(), "Should get CPU stats");

        // Get memory usage
        let mem_output = client_write
            .execute_command("free | grep Mem | awk '{print ($3/$2) * 100.0}'")
            .await;
        assert!(mem_output.is_ok(), "Should get memory stats");

        // Disconnect
        client_write.disconnect().await.ok();
    }

    #[tokio::test]
    #[ignore]
    async fn test_process_list() {
        let client = Arc::new(RwLock::new(SshClient::new()));
        let mut client_write = client.write().await;
        let config = create_test_config();

        // Connect
        connect_client(&mut client_write, &config)
            .await
            .expect("Failed to connect");

        // Get process list
        let output = client_write
            .execute_command("ps aux --sort=-%cpu | head -10")
            .await
            .expect("Failed to get process list");

        assert!(!output.is_empty(), "Process list should not be empty");
        assert!(
            output.contains("PID") || output.contains("USER"),
            "Output should contain process info"
        );

        // Disconnect
        client_write.disconnect().await.ok();
    }
}

// ── Key-loading unit tests (no SSH server required) ──────────────────────────

#[cfg(test)]
mod key_loading_tests {
    use russh::keys::{decode_secret_key, encode_pkcs8_pem, key::safe_rng, Algorithm, PrivateKey};
    use std::io::Write;
    use tempfile::NamedTempFile;

    /// Generate a fresh Ed25519 key pair and return its PKCS#8 PEM encoding as a
    /// `String` with Unix (`\n`) line endings.
    fn generate_pem_lf() -> String {
        let key = PrivateKey::random(&mut safe_rng(), Algorithm::Ed25519)
            .expect("Ed25519 generation must succeed");
        let mut buf = Vec::new();
        encode_pkcs8_pem(&key, &mut buf).expect("PEM encoding must succeed");
        String::from_utf8(buf).expect("PEM is valid UTF-8")
    }

    // ── 1. Baseline: decode from key content with LF line endings ────────────

    #[test]
    fn test_decode_secret_key_with_lf_content() {
        let pem = generate_pem_lf();
        assert!(pem.contains("-----BEGIN"), "Should be a PEM-encoded key");
        let result = decode_secret_key(&pem, None);
        assert!(
            result.is_ok(),
            "decode_secret_key should succeed with LF-only PEM content: {:?}",
            result.err()
        );
    }

    // ── 2. CRLF fix: key content normalised from \r\n to \n must parse OK ───

    #[test]
    fn test_decode_secret_key_after_crlf_normalisation() {
        let pem_lf = generate_pem_lf();
        // Simulate a Windows-created file by converting every \n to \r\n.
        let pem_crlf = pem_lf.replace('\n', "\r\n");

        // Sanity check: raw CRLF content should fail (or at least shows the
        // parser is sensitive to line endings on some platforms — we normalise
        // before calling decode_secret_key so users never hit this).
        // We don't assert failure here because behaviour may vary; what matters
        // is that after normalisation it always succeeds.

        let normalised = pem_crlf.replace("\r\n", "\n");
        let result = decode_secret_key(&normalised, None);
        assert!(
            result.is_ok(),
            "decode_secret_key should succeed after CRLF→LF normalisation: {:?}",
            result.err()
        );
    }

    // ── 3. Bug repro: passing a file *path* string directly fails ────────────
    //    This confirms why the old code was broken on every platform.

    #[test]
    fn test_decode_secret_key_rejects_file_path_string() {
        // A file path is not valid PEM content — decode must fail.
        let fake_path = "/home/user/.ssh/id_rsa";
        let result = decode_secret_key(fake_path, None);
        assert!(
            result.is_err(),
            "decode_secret_key should reject a bare file path string"
        );
    }

    // ── 4. Missing key file returns a clear error ─────────────────────────────

    #[tokio::test]
    async fn test_connect_invalid_key_content_returns_error() {
        use crate::ssh::{AuthMethod, SshClient, SshConfig};

        let config = SshConfig {
            host: "127.0.0.1".to_string(),
            port: 22,
            username: "user".to_string(),
            auth_method: AuthMethod::PublicKey {
                key_content: "not-a-valid-private-key".to_string(),
                passphrase: None,
            },
            host_key_verification: false,
        };

        let mut client = SshClient::new();
        let err = client
            .connect_with_progress(
                &config,
                crate::connection_diagnostics::default_tcp_timeout(),
                |_| {},
                None,
            )
            .await
            .unwrap_err();
        let msg = err.to_string();
        assert!(
            msg.contains("Failed to load SSH private key")
                || msg.contains("Connection refused")
                || msg.contains("timed out"),
            "Error should mention invalid key or connection failure, got: {msg}"
        );
    }

    // ── 5. Key loaded from a temp file (via read+decode) succeeds ────────────
    //    This mirrors the code path that was fixed: read file → normalise → decode.

    #[test]
    fn test_key_round_trip_via_file() {
        let pem = generate_pem_lf();

        let mut tmp = NamedTempFile::new().expect("tempfile creation must succeed");
        tmp.write_all(pem.as_bytes()).expect("write must succeed");
        tmp.flush().unwrap();

        // Replicate the fixed code path exactly.
        let content = std::fs::read_to_string(tmp.path()).expect("read_to_string must succeed");
        let content = content.replace("\r\n", "\n");
        let result = decode_secret_key(&content, None);
        assert!(
            result.is_ok(),
            "Key round-tripped through a file should decode successfully: {:?}",
            result.err()
        );
    }

    // ── 6. CRLF key written to file still loads correctly after normalisation ─

    #[test]
    fn test_crlf_key_file_round_trip() {
        let pem_crlf = generate_pem_lf().replace('\n', "\r\n");

        let mut tmp = NamedTempFile::new().expect("tempfile creation must succeed");
        tmp.write_all(pem_crlf.as_bytes())
            .expect("write must succeed");
        tmp.flush().unwrap();

        let content = std::fs::read_to_string(tmp.path()).expect("read_to_string must succeed");
        let normalised = content.replace("\r\n", "\n");
        let result = decode_secret_key(&normalised, None);
        assert!(
            result.is_ok(),
            "CRLF key written to file should parse after normalisation: {:?}",
            result.err()
        );
    }

    // ── 7. Tilde expansion ───────────────────────────────────────────────────

    #[test]
    fn test_tilde_expansion_unix_style() {
        let path = "~/.ssh/id_rsa".to_string();
        let expanded = expand_tilde(&path);
        assert!(
            !expanded.starts_with('~'),
            "Unix-style tilde should be expanded, got: {expanded}"
        );
    }

    #[test]
    fn test_no_tilde_path_unchanged() {
        let path = "/absolute/path/to/key".to_string();
        let expanded = expand_tilde(&path);
        assert_eq!(expanded, path, "Path without tilde should be unchanged");
    }

    /// Replication of the tilde-expansion logic from `SshClient::connect` so it
    /// can be tested independently without constructing a full `SshConfig`.
    use crate::ssh::key_loader::expand_tilde;
}

mod keyboard_interactive_tests {
    use crate::ssh::{AuthMethod, KeyboardInteractiveResponder, SshClient, SshConfig};
    use russh::server::{Auth, Response, Session};
    use std::borrow::Cow;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    #[derive(Clone)]
    struct KeyboardInteractiveServer;

    impl russh::server::Handler for KeyboardInteractiveServer {
        type Error = anyhow::Error;

        async fn auth_keyboard_interactive(
            &mut self,
            _user: &str,
            _submethods: &str,
            response: Option<Response<'_>>,
        ) -> Result<Auth, Self::Error> {
            let Some(response) = response else {
                return Ok(Auth::Partial {
                    name: Cow::Borrowed("Password authentication"),
                    instructions: Cow::Borrowed("Enter your account password"),
                    prompts: Cow::Owned(vec![(Cow::Borrowed("Password:"), false)]),
                });
            };

            let values = response
                .map(|value| String::from_utf8_lossy(&value).into_owned())
                .collect::<Vec<_>>();
            match values.as_slice() {
                [password] if password == "secret" => Ok(Auth::Partial {
                    name: Cow::Borrowed("Two-factor authentication"),
                    instructions: Cow::Borrowed("Enter the current OTP"),
                    prompts: Cow::Owned(vec![(Cow::Borrowed("Verification code:"), true)]),
                }),
                [otp] if otp == "123456" => Ok(Auth::Accept),
                _ => Ok(Auth::Reject {
                    proceed_with_methods: None,
                    partial_success: false,
                }),
            }
        }

        async fn auth_succeeded(&mut self, _session: &mut Session) -> Result<(), Self::Error> {
            Ok(())
        }
    }

    #[tokio::test]
    async fn completes_two_round_keyboard_interactive_authentication() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let mut server_config = russh::server::Config {
            auth_rejection_time: Duration::ZERO,
            ..Default::default()
        };
        server_config.keys.push(
            russh::keys::PrivateKey::random(
                &mut russh::keys::key::safe_rng(),
                russh::keys::Algorithm::Ed25519,
            )
            .unwrap(),
        );
        let server_config = Arc::new(server_config);

        let server_task = tokio::spawn(async move {
            let (socket, _) = listener.accept().await.unwrap();
            russh::server::run_stream(server_config, socket, KeyboardInteractiveServer)
                .await
                .unwrap();
        });

        let observed = Arc::new(Mutex::new(Vec::<(String, bool)>::new()));
        let responder_observed = observed.clone();
        let responder: KeyboardInteractiveResponder = Arc::new(move |challenge| {
            let observed = responder_observed.clone();
            Box::pin(async move {
                let prompt = challenge.prompts.first().unwrap();
                observed
                    .lock()
                    .unwrap()
                    .push((prompt.prompt.clone(), prompt.echo));
                if prompt.prompt == "Password:" {
                    Ok(vec!["secret".to_string()])
                } else {
                    Ok(vec!["123456".to_string()])
                }
            })
        });

        let config = SshConfig {
            host: address.ip().to_string(),
            port: address.port(),
            username: "testuser".to_string(),
            auth_method: AuthMethod::KeyboardInteractive,
            host_key_verification: false,
        };
        let mut client = SshClient::new();
        client
            .connect_with_progress(&config, Duration::from_secs(5), |_| {}, Some(responder))
            .await
            .unwrap();

        assert_eq!(
            *observed.lock().unwrap(),
            vec![
                ("Password:".to_string(), false),
                ("Verification code:".to_string(), true),
            ]
        );
        client.disconnect().await.unwrap();
        server_task.await.unwrap();
    }
}

mod rsa_host_key_compatibility_tests {
    use crate::ssh::{AuthMethod, SshClient, SshConfig};
    use russh::keys::{
        encode_pkcs8_pem, key::safe_rng, ssh_key::private::RsaKeypair, Algorithm, HashAlg,
        PrivateKey, PublicKey,
    };
    use russh::server::Auth;
    use std::borrow::Cow;
    use std::sync::Arc;
    use std::time::Duration;

    #[derive(Clone)]
    struct PublicKeyServer;

    impl russh::server::Handler for PublicKeyServer {
        type Error = anyhow::Error;

        async fn auth_publickey(
            &mut self,
            _user: &str,
            _public_key: &PublicKey,
        ) -> Result<Auth, Self::Error> {
            Ok(Auth::Accept)
        }
    }

    async fn connects_with_rsa_algorithm(
        host_key: PrivateKey,
        key_content: String,
        algorithm: Algorithm,
    ) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let mut server_config = russh::server::Config {
            auth_rejection_time: Duration::ZERO,
            preferred: russh::Preferred {
                key: Cow::Owned(vec![algorithm]),
                ..Default::default()
            },
            ..Default::default()
        };
        server_config.keys.push(host_key);
        let server_config = Arc::new(server_config);

        let server_task = tokio::spawn(async move {
            let (socket, _) = listener.accept().await.unwrap();
            russh::server::run_stream(server_config, socket, PublicKeyServer)
                .await
                .unwrap();
        });

        let config = SshConfig {
            host: address.ip().to_string(),
            port: address.port(),
            username: "testuser".to_string(),
            auth_method: AuthMethod::PublicKey {
                key_content,
                passphrase: None,
            },
            host_key_verification: false,
        };
        let mut client = SshClient::new();
        client
            .connect_with_progress(&config, Duration::from_secs(5), |_| {}, None)
            .await
            .unwrap();
        client.disconnect().await.unwrap();
        server_task.await.unwrap();
    }

    #[tokio::test]
    async fn supports_modern_and_legacy_rsa_signatures() {
        let rsa = RsaKeypair::random(&mut safe_rng(), 2048).unwrap();
        let host_key = PrivateKey::new(rsa.into(), "test-rsa-host").unwrap();
        let mut key_content = Vec::new();
        encode_pkcs8_pem(&host_key, &mut key_content).unwrap();
        let key_content = String::from_utf8(key_content).unwrap();

        connects_with_rsa_algorithm(
            host_key.clone(),
            key_content.clone(),
            Algorithm::Rsa {
                hash: Some(HashAlg::Sha512),
            },
        )
        .await;
        connects_with_rsa_algorithm(host_key, key_content, Algorithm::Rsa { hash: None }).await;
    }
}
