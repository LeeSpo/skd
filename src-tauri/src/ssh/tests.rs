// ── Key-loading unit tests (no SSH server required) ──────────────────────────

// Regression adapted from upstream PR #187 / russh's compressor fix: an Ok
// result with a full output buffer must not truncate incompressible packets.
#[test]
fn incompressible_packets_survive_compression_roundtrip() {
    use russh::compression::{Compress, Compression, Decompress, ZLIB};
    let mut seed = 0x9e37_79b9_7f4a_7c15u64;
    for len in [65_536, 200_000] {
        let input: Vec<u8> = (0..len)
            .map(|_| {
                seed ^= seed << 13;
                seed ^= seed >> 7;
                seed ^= seed << 17;
                (seed >> 24) as u8
            })
            .collect();
        let mut compressor = Compress::None;
        Compression::new(&ZLIB).init_compress(&mut compressor);
        let mut compressed = Vec::new();
        let bytes = compressor
            .compress(&input, &mut compressed)
            .unwrap()
            .to_vec();
        let mut decompressor = Decompress::None;
        Compression::new(&ZLIB).init_decompress(&mut decompressor);
        let mut output = Vec::new();
        assert_eq!(decompressor.decompress(&bytes, &mut output).unwrap(), input);
    }
}

#[cfg(test)]
mod key_loading_tests {
    use crate::ssh::key_loader::expand_tilde;
    use russh::keys::decode_secret_key;

    // ── 1. Bug repro: passing a file *path* string directly fails ────────────
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

    // ── 2. Missing key file returns a clear error ─────────────────────────────

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
            keepalive_interval_secs: 60,
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

    // ── 3. Tilde expansion ───────────────────────────────────────────────────

    #[test]
    fn test_no_tilde_path_unchanged() {
        let path = "/absolute/path/to/key".to_string();
        let expanded = expand_tilde(&path);
        assert_eq!(expanded, path, "Path without tilde should be unchanged");
    }
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
            keepalive_interval_secs: 60,
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
            keepalive_interval_secs: 60,
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
