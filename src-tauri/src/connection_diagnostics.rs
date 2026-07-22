//! SSH connection stage progress and classified errors.
//!
//! Stages cover DNS → TCP → handshake → host key → auth → PTY → connected.
//! Error kinds map failures into user-facing categories for the frontend.

use serde::{Deserialize, Serialize};
use std::fmt;
use std::io;
use std::time::Duration;

/// Event name emitted to the frontend during connect / PTY setup.
pub const CONNECT_PROGRESS_EVENT: &str = "ssh-connect-progress";

/// Ordered connection stages shown in the connection dialog / terminal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConnectStage {
    ResolvingDns,
    EstablishingTcp,
    SshHandshake,
    VerifyingHostKey,
    Authenticating,
    RequestingPty,
    Connected,
}

impl ConnectStage {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ResolvingDns => "resolvingDns",
            Self::EstablishingTcp => "establishingTcp",
            Self::SshHandshake => "sshHandshake",
            Self::VerifyingHostKey => "verifyingHostKey",
            Self::Authenticating => "authenticating",
            Self::RequestingPty => "requestingPty",
            Self::Connected => "connected",
        }
    }
}

impl fmt::Display for ConnectStage {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Classified connection error kinds for the UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConnectErrorKind {
    DnsFailure,
    TcpTimeout,
    ConnectionRefused,
    NetworkUnreachable,
    ProxyFailure,
    SshHandshakeFailed,
    SshAlgorithmIncompatible,
    HostKeyMismatch,
    /// Unknown host key — interactive trust flow on the frontend.
    HostKeyUnknown,
    AuthenticationFailed,
    PasswordIncorrect,
    PublicKeyUnauthorized,
    PrivateKeyFormatUnsupported,
    PrivateKeyPassphraseIncorrect,
    KeyboardInteractiveRejected,
    KeyboardInteractiveTimeout,
    PtyCreateFailed,
    Cancelled,
    Unknown,
}

impl ConnectErrorKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::DnsFailure => "dnsFailure",
            Self::TcpTimeout => "tcpTimeout",
            Self::ConnectionRefused => "connectionRefused",
            Self::NetworkUnreachable => "networkUnreachable",
            Self::ProxyFailure => "proxyFailure",
            Self::SshHandshakeFailed => "sshHandshakeFailed",
            Self::SshAlgorithmIncompatible => "sshAlgorithmIncompatible",
            Self::HostKeyMismatch => "hostKeyMismatch",
            Self::HostKeyUnknown => "hostKeyUnknown",
            Self::AuthenticationFailed => "authenticationFailed",
            Self::PasswordIncorrect => "passwordIncorrect",
            Self::PublicKeyUnauthorized => "publicKeyUnauthorized",
            Self::PrivateKeyFormatUnsupported => "privateKeyFormatUnsupported",
            Self::PrivateKeyPassphraseIncorrect => "privateKeyPassphraseIncorrect",
            Self::KeyboardInteractiveRejected => "keyboardInteractiveRejected",
            Self::KeyboardInteractiveTimeout => "keyboardInteractiveTimeout",
            Self::PtyCreateFailed => "ptyCreateFailed",
            Self::Cancelled => "cancelled",
            Self::Unknown => "unknown",
        }
    }
}

impl fmt::Display for ConnectErrorKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Progress payload emitted over Tauri events.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectProgressEvent {
    pub connection_id: String,
    pub stage: ConnectStage,
}

/// Structured connect failure returned to the frontend.
#[derive(Debug, Clone)]
pub struct ConnectDiagnosticError {
    pub kind: ConnectErrorKind,
    pub stage: ConnectStage,
    pub message: String,
}

impl ConnectDiagnosticError {
    pub fn new(kind: ConnectErrorKind, stage: ConnectStage, message: impl Into<String>) -> Self {
        Self {
            kind,
            stage,
            message: message.into(),
        }
    }

    pub fn cancelled() -> Self {
        Self::new(
            ConnectErrorKind::Cancelled,
            ConnectStage::EstablishingTcp,
            "Connection cancelled by user",
        )
    }

    pub fn pty_failed(message: impl Into<String>) -> Self {
        Self::new(
            ConnectErrorKind::PtyCreateFailed,
            ConnectStage::RequestingPty,
            message,
        )
    }
}

impl fmt::Display for ConnectDiagnosticError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for ConnectDiagnosticError {}

/// Extract a [`ConnectDiagnosticError`] from an `anyhow::Error` chain if present.
pub fn diagnostic_from_anyhow(err: &anyhow::Error) -> Option<&ConnectDiagnosticError> {
    err.downcast_ref::<ConnectDiagnosticError>()
}

/// Map a free-form error into a diagnostic when the chain has no structured value.
pub fn classify_connect_error(err: &anyhow::Error, fallback_stage: ConnectStage) -> ConnectDiagnosticError {
    if let Some(diag) = diagnostic_from_anyhow(err) {
        return diag.clone();
    }

    let message = err.to_string();
    let lower = message.to_lowercase();

    if lower.contains("cancelled by user") || lower.contains("connection cancelled") {
        return ConnectDiagnosticError::new(
            ConnectErrorKind::Cancelled,
            fallback_stage,
            message,
        );
    }

    if message.contains(crate::known_hosts::UNKNOWN_HOST_KEY_PREFIX) {
        return ConnectDiagnosticError::new(
            ConnectErrorKind::HostKeyUnknown,
            ConnectStage::VerifyingHostKey,
            message,
        );
    }

    if lower.contains("host key mismatch") {
        return ConnectDiagnosticError::new(
            ConnectErrorKind::HostKeyMismatch,
            ConnectStage::VerifyingHostKey,
            message,
        );
    }

    if lower.contains("failed to decrypt ssh key")
        || lower.contains("incorrect passphrase")
        || (lower.contains("private key") && lower.contains("passphrase"))
    {
        return ConnectDiagnosticError::new(
            ConnectErrorKind::PrivateKeyPassphraseIncorrect,
            ConnectStage::Authenticating,
            message,
        );
    }

    if lower.contains("failed to load ssh private key")
        || lower.contains("valid ssh private key")
        || lower.contains("private key format")
    {
        return ConnectDiagnosticError::new(
            ConnectErrorKind::PrivateKeyFormatUnsupported,
            ConnectStage::Authenticating,
            message,
        );
    }

    if lower.contains("password authentication failed")
        || (lower.contains("authentication failed") && lower.contains("password"))
    {
        return ConnectDiagnosticError::new(
            ConnectErrorKind::PasswordIncorrect,
            ConnectStage::Authenticating,
            message,
        );
    }

    if lower.contains("public key authentication failed")
        || lower.contains("not be authorized")
        || (lower.contains("authentication failed") && lower.contains("public key"))
    {
        return ConnectDiagnosticError::new(
            ConnectErrorKind::PublicKeyUnauthorized,
            ConnectStage::Authenticating,
            message,
        );
    }

    if lower.contains("authentication failed") {
        return ConnectDiagnosticError::new(
            ConnectErrorKind::AuthenticationFailed,
            ConnectStage::Authenticating,
            message,
        );
    }

    if lower.contains("no such host")
        || lower.contains("name or service not known")
        || lower.contains("nodename nor servname")
        || lower.contains("failed to resolve")
        || lower.contains("dns")
        || lower.contains("failed to lookup")
    {
        return ConnectDiagnosticError::new(
            ConnectErrorKind::DnsFailure,
            ConnectStage::ResolvingDns,
            message,
        );
    }

    if lower.contains("timed out") || lower.contains("timeout") {
        return ConnectDiagnosticError::new(
            ConnectErrorKind::TcpTimeout,
            ConnectStage::EstablishingTcp,
            message,
        );
    }

    if lower.contains("connection refused") {
        return ConnectDiagnosticError::new(
            ConnectErrorKind::ConnectionRefused,
            ConnectStage::EstablishingTcp,
            message,
        );
    }

    if lower.contains("network is unreachable")
        || lower.contains("host is unreachable")
        || lower.contains("no route to host")
    {
        return ConnectDiagnosticError::new(
            ConnectErrorKind::NetworkUnreachable,
            ConnectStage::EstablishingTcp,
            message,
        );
    }

    if lower.contains("kex")
        || lower.contains("key exchange")
        || lower.contains("no common")
        || lower.contains("algorithm")
        || lower.contains("no matching")
        || lower.contains("incompatible")
    {
        return ConnectDiagnosticError::new(
            ConnectErrorKind::SshAlgorithmIncompatible,
            ConnectStage::SshHandshake,
            message,
        );
    }

    if lower.contains("proxy") {
        return ConnectDiagnosticError::new(
            ConnectErrorKind::ProxyFailure,
            ConnectStage::EstablishingTcp,
            message,
        );
    }

    if lower.contains("pty") {
        return ConnectDiagnosticError::pty_failed(message);
    }

    let fallback_kind = if fallback_stage == ConnectStage::SshHandshake {
        ConnectErrorKind::SshHandshakeFailed
    } else {
        ConnectErrorKind::Unknown
    };
    ConnectDiagnosticError::new(fallback_kind, fallback_stage, message)
}

/// Classify a raw I/O error that occurred while establishing TCP.
pub fn classify_tcp_io_error(err: &io::Error, host: &str, port: u16) -> ConnectDiagnosticError {
    let kind = err.kind();
    let message = format!("Failed to connect to {host}:{port}: {err}");

    match kind {
        io::ErrorKind::TimedOut => ConnectDiagnosticError::new(
            ConnectErrorKind::TcpTimeout,
            ConnectStage::EstablishingTcp,
            format!(
                "Connection timed out while reaching {host}:{port}. Check the host address and network connectivity."
            ),
        ),
        io::ErrorKind::ConnectionRefused => ConnectDiagnosticError::new(
            ConnectErrorKind::ConnectionRefused,
            ConnectStage::EstablishingTcp,
            format!("Connection refused by {host}:{port}. The SSH service may be down or the port is wrong."),
        ),
        io::ErrorKind::NetworkUnreachable | io::ErrorKind::HostUnreachable => ConnectDiagnosticError::new(
            ConnectErrorKind::NetworkUnreachable,
            ConnectStage::EstablishingTcp,
            message,
        ),
        _ => {
            let lower = err.to_string().to_lowercase();
            if lower.contains("timed out") || lower.contains("timeout") {
                ConnectDiagnosticError::new(
                    ConnectErrorKind::TcpTimeout,
                    ConnectStage::EstablishingTcp,
                    format!(
                        "Connection timed out while reaching {host}:{port}. Check the host address and network connectivity."
                    ),
                )
            } else {
                ConnectDiagnosticError::new(
                    ConnectErrorKind::Unknown,
                    ConnectStage::EstablishingTcp,
                    message,
                )
            }
        }
    }
}

/// Classify handshake / connect_stream errors (after TCP is up).
pub fn classify_handshake_error(err: &anyhow::Error, host: &str, port: u16) -> ConnectDiagnosticError {
    let message = err.to_string();
    let lower = message.to_lowercase();

    if message.contains(crate::known_hosts::UNKNOWN_HOST_KEY_PREFIX) {
        return ConnectDiagnosticError::new(
            ConnectErrorKind::HostKeyUnknown,
            ConnectStage::VerifyingHostKey,
            message,
        );
    }

    if lower.contains("host key mismatch") {
        return ConnectDiagnosticError::new(
            ConnectErrorKind::HostKeyMismatch,
            ConnectStage::VerifyingHostKey,
            message,
        );
    }

    if lower.contains("kex")
        || lower.contains("key exchange")
        || lower.contains("no common")
        || lower.contains("algorithm")
        || lower.contains("no matching")
        || lower.contains("incompatible")
        || lower.contains("unknown algorithm")
    {
        return ConnectDiagnosticError::new(
            ConnectErrorKind::SshAlgorithmIncompatible,
            ConnectStage::SshHandshake,
            format!("SSH algorithm negotiation failed with {host}:{port}: {message}"),
        );
    }

    ConnectDiagnosticError::new(
        ConnectErrorKind::SshHandshakeFailed,
        ConnectStage::SshHandshake,
        format!("Failed to complete SSH handshake with {host}:{port}: {message}"),
    )
}

/// Default TCP connect timeout used by SSH sessions.
pub fn default_tcp_timeout() -> Duration {
    Duration::from_secs(3)
}

/// Default TCP connect timeout used by standalone SFTP sessions.
pub fn sftp_tcp_timeout() -> Duration {
    Duration::from_secs(10)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stage_serde_camel_case() {
        let json = serde_json::to_string(&ConnectStage::ResolvingDns).unwrap();
        assert_eq!(json, "\"resolvingDns\"");
        let back: ConnectStage = serde_json::from_str(&json).unwrap();
        assert_eq!(back, ConnectStage::ResolvingDns);
    }

    #[test]
    fn kind_serde_camel_case() {
        let json = serde_json::to_string(&ConnectErrorKind::PasswordIncorrect).unwrap();
        assert_eq!(json, "\"passwordIncorrect\"");
    }

    #[test]
    fn classifies_dns_message() {
        let err = anyhow::anyhow!("failed to lookup address information: Name or service not known");
        let diag = classify_connect_error(&err, ConnectStage::ResolvingDns);
        assert_eq!(diag.kind, ConnectErrorKind::DnsFailure);
        assert_eq!(diag.stage, ConnectStage::ResolvingDns);
    }

    #[test]
    fn classifies_timeout_message() {
        let err = anyhow::anyhow!("Connection timed out after 3 seconds");
        let diag = classify_connect_error(&err, ConnectStage::EstablishingTcp);
        assert_eq!(diag.kind, ConnectErrorKind::TcpTimeout);
    }

    #[test]
    fn classifies_actionable_tcp_errors() {
        let refused = io::Error::from(io::ErrorKind::ConnectionRefused);
        let diag = classify_tcp_io_error(&refused, "example.com", 22);
        assert_eq!(diag.kind, ConnectErrorKind::ConnectionRefused);

        let unreachable = io::Error::from(io::ErrorKind::NetworkUnreachable);
        let diag = classify_tcp_io_error(&unreachable, "example.com", 22);
        assert_eq!(diag.kind, ConnectErrorKind::NetworkUnreachable);
    }

    #[test]
    fn classifies_generic_handshake_failure() {
        let err = anyhow::anyhow!("peer closed connection during exchange");
        let diag = classify_handshake_error(&err, "example.com", 22);
        assert_eq!(diag.kind, ConnectErrorKind::SshHandshakeFailed);
        assert_eq!(diag.stage, ConnectStage::SshHandshake);
    }

    #[test]
    fn classifies_password_failure() {
        let err = anyhow::anyhow!("Password authentication failed: refused");
        let diag = classify_connect_error(&err, ConnectStage::Authenticating);
        assert_eq!(diag.kind, ConnectErrorKind::PasswordIncorrect);
        assert_eq!(diag.stage, ConnectStage::Authenticating);
    }

    #[test]
    fn classifies_public_key_unauthorized() {
        let err = anyhow::anyhow!(
            "Public key authentication failed: x. The key may not be authorized on the server."
        );
        let diag = classify_connect_error(&err, ConnectStage::Authenticating);
        assert_eq!(diag.kind, ConnectErrorKind::PublicKeyUnauthorized);
    }

    #[test]
    fn classifies_private_key_format() {
        let err = anyhow::anyhow!(
            "Failed to load SSH private key: bad. Ensure the file is a valid SSH private key (RSA, Ed25519, or ECDSA)."
        );
        let diag = classify_connect_error(&err, ConnectStage::Authenticating);
        assert_eq!(diag.kind, ConnectErrorKind::PrivateKeyFormatUnsupported);
    }

    #[test]
    fn classifies_private_key_passphrase() {
        let err = anyhow::anyhow!("Failed to decrypt SSH key: incorrect passphrase");
        let diag = classify_connect_error(&err, ConnectStage::Authenticating);
        assert_eq!(diag.kind, ConnectErrorKind::PrivateKeyPassphraseIncorrect);
    }

    #[test]
    fn classifies_generic_authentication_failure() {
        let err = anyhow::anyhow!("Authentication failed without a supported method");
        let diag = classify_connect_error(&err, ConnectStage::Authenticating);
        assert_eq!(diag.kind, ConnectErrorKind::AuthenticationFailed);
    }

    #[test]
    fn classifies_host_key_mismatch() {
        let err = anyhow::anyhow!("Host key mismatch for example.com:22. Server fingerprint: a. Expected: b.");
        let diag = classify_connect_error(&err, ConnectStage::SshHandshake);
        assert_eq!(diag.kind, ConnectErrorKind::HostKeyMismatch);
        assert_eq!(diag.stage, ConnectStage::VerifyingHostKey);
    }

    #[test]
    fn classifies_unknown_host_key() {
        let err = anyhow::anyhow!("UNKNOWN_HOST_KEY:{{\"host\":\"h\"}}");
        let diag = classify_connect_error(&err, ConnectStage::SshHandshake);
        assert_eq!(diag.kind, ConnectErrorKind::HostKeyUnknown);
        assert_eq!(diag.stage, ConnectStage::VerifyingHostKey);
    }

    #[test]
    fn classifies_algorithm_incompatibility() {
        let err = anyhow::anyhow!("no common kex algorithm");
        let diag = classify_connect_error(&err, ConnectStage::SshHandshake);
        assert_eq!(diag.kind, ConnectErrorKind::SshAlgorithmIncompatible);
    }

    #[test]
    fn classifies_cancelled() {
        let err = anyhow::anyhow!("Connection cancelled by user");
        let diag = classify_connect_error(&err, ConnectStage::EstablishingTcp);
        assert_eq!(diag.kind, ConnectErrorKind::Cancelled);
    }

    #[test]
    fn classifies_pty_failure() {
        let err = anyhow::anyhow!("Failed to open PTY channel");
        let diag = classify_connect_error(&err, ConnectStage::RequestingPty);
        assert_eq!(diag.kind, ConnectErrorKind::PtyCreateFailed);
    }

    #[test]
    fn structured_error_round_trips_through_anyhow() {
        let original = ConnectDiagnosticError::new(
            ConnectErrorKind::DnsFailure,
            ConnectStage::ResolvingDns,
            "bad host",
        );
        let err: anyhow::Error = original.into();
        let recovered = classify_connect_error(&err, ConnectStage::Authenticating);
        assert_eq!(recovered.kind, ConnectErrorKind::DnsFailure);
        assert_eq!(recovered.stage, ConnectStage::ResolvingDns);
        assert_eq!(recovered.message, "bad host");
    }

    #[test]
    fn progress_event_serializes_camel_case() {
        let event = ConnectProgressEvent {
            connection_id: "c1".into(),
            stage: ConnectStage::Authenticating,
        };
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["connectionId"], "c1");
        assert_eq!(json["stage"], "authenticating");
    }
}
