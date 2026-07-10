//! Local SSH port forwarding (OpenSSH `-L` style).
//!
//! Binds a local TCP listener and, for each accepted connection, opens an SSH
//! `direct-tcpip` channel to the remote host:port as seen from the SSH server.

use anyhow::{anyhow, Context, Result};
use russh::client::Handle;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::io::copy_bidirectional;
use tokio::net::TcpListener;
use tokio::sync::RwLock;
use tokio_util::sync::CancellationToken;
use tracing::{debug, warn};

use crate::ssh::Client;

static FORWARD_ID_COUNTER: AtomicU64 = AtomicU64::new(1);

fn next_forward_id() -> String {
    let n = FORWARD_ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("pf-{millis}-{n}")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalForwardInfo {
    pub id: String,
    pub connection_id: String,
    pub name: Option<String>,
    pub local_bind_host: String,
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
    pub status: String,
    pub error: Option<String>,
}

struct ActiveForward {
    info: LocalForwardInfo,
    cancel: CancellationToken,
}

/// Manages local port forwards keyed by SSH `connection_id`.
pub struct PortForwardManager {
    forwards: Arc<RwLock<HashMap<String, HashMap<String, ActiveForward>>>>,
}

impl PortForwardManager {
    pub fn new() -> Self {
        Self {
            forwards: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn start_local(
        &self,
        connection_id: String,
        session: Arc<Handle<Client>>,
        name: Option<String>,
        local_bind_host: String,
        local_port: u16,
        remote_host: String,
        remote_port: u16,
    ) -> Result<LocalForwardInfo> {
        validate_forward_params(&local_bind_host, remote_host.as_str(), remote_port)?;

        let bind_addr: SocketAddr = format!("{local_bind_host}:{local_port}")
            .parse()
            .with_context(|| {
                format!("Invalid local bind address: {local_bind_host}:{local_port}")
            })?;

        let listener = TcpListener::bind(bind_addr).await.with_context(|| {
            format!("Failed to bind local port {local_bind_host}:{local_port}")
        })?;

        let actual_port = listener
            .local_addr()
            .map(|a| a.port())
            .unwrap_or(local_port);

        let id = next_forward_id();
        let cancel = CancellationToken::new();
        let info = LocalForwardInfo {
            id: id.clone(),
            connection_id: connection_id.clone(),
            name,
            local_bind_host: local_bind_host.clone(),
            local_port: actual_port,
            remote_host: remote_host.clone(),
            remote_port,
            status: "listening".to_string(),
            error: None,
        };

        let cancel_loop = cancel.clone();
        let remote_host_loop = remote_host.clone();
        tokio::spawn(async move {
            run_accept_loop(
                listener,
                session,
                remote_host_loop,
                remote_port,
                cancel_loop,
            )
            .await;
        });

        let mut map = self.forwards.write().await;
        let conn_map = map.entry(connection_id).or_default();
        conn_map.insert(
            id.clone(),
            ActiveForward {
                info: info.clone(),
                cancel,
            },
        );

        debug!(
            "Started local forward {} → {}:{} on connection {}",
            format!("{}:{}", info.local_bind_host, info.local_port),
            info.remote_host,
            info.remote_port,
            info.connection_id
        );

        Ok(info)
    }

    pub async fn stop(&self, connection_id: &str, forward_id: &str) -> Result<()> {
        let mut map = self.forwards.write().await;
        let Some(conn_map) = map.get_mut(connection_id) else {
            return Err(anyhow!("No port forwards for connection"));
        };
        let Some(active) = conn_map.remove(forward_id) else {
            return Err(anyhow!("Port forward not found"));
        };
        active.cancel.cancel();
        if conn_map.is_empty() {
            map.remove(connection_id);
        }
        Ok(())
    }

    pub async fn stop_all_for_connection(&self, connection_id: &str) {
        let mut map = self.forwards.write().await;
        if let Some(conn_map) = map.remove(connection_id) {
            for (_, active) in conn_map {
                active.cancel.cancel();
            }
            debug!("Stopped all local forwards for connection {connection_id}");
        }
    }

    pub async fn list(&self, connection_id: &str) -> Vec<LocalForwardInfo> {
        let map = self.forwards.read().await;
        map.get(connection_id)
            .map(|m| m.values().map(|a| a.info.clone()).collect())
            .unwrap_or_default()
    }
}

impl Default for PortForwardManager {
    fn default() -> Self {
        Self::new()
    }
}

pub fn validate_forward_params(
    local_bind_host: &str,
    remote_host: &str,
    remote_port: u16,
) -> Result<()> {
    if local_bind_host.trim().is_empty() {
        return Err(anyhow!("Local bind host is required"));
    }
    if remote_host.trim().is_empty() {
        return Err(anyhow!("Remote host is required"));
    }
    if remote_port == 0 {
        return Err(anyhow!("Remote port must be between 1 and 65535"));
    }
    Ok(())
}

async fn run_accept_loop(
    listener: TcpListener,
    session: Arc<Handle<Client>>,
    remote_host: String,
    remote_port: u16,
    cancel: CancellationToken,
) {
    loop {
        tokio::select! {
            _ = cancel.cancelled() => {
                break;
            }
            accepted = listener.accept() => {
                match accepted {
                    Ok((mut tcp, peer)) => {
                        let session = Arc::clone(&session);
                        let remote_host = remote_host.clone();
                        let cancel = cancel.clone();
                        tokio::spawn(async move {
                            let originator = peer.ip().to_string();
                            let originator_port = u32::from(peer.port());
                            match session
                                .channel_open_direct_tcpip(
                                    remote_host,
                                    u32::from(remote_port),
                                    originator,
                                    originator_port,
                                )
                                .await
                            {
                                Ok(channel) => {
                                    let mut stream = channel.into_stream();
                                    tokio::select! {
                                        _ = cancel.cancelled() => {}
                                        result = copy_bidirectional(&mut tcp, &mut stream) => {
                                            if let Err(e) = result {
                                                debug!("Port forward stream closed: {e}");
                                            }
                                        }
                                    }
                                }
                                Err(e) => {
                                    warn!("direct-tcpip channel open failed: {e}");
                                }
                            }
                        });
                    }
                    Err(e) => {
                        if cancel.is_cancelled() {
                            break;
                        }
                        warn!("Local forward accept failed: {e}");
                        break;
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_rejects_empty_remote_host() {
        let err = validate_forward_params("127.0.0.1", "", 80).unwrap_err();
        assert!(err.to_string().contains("Remote host"));
    }

    #[test]
    fn validate_rejects_zero_remote_port() {
        let err = validate_forward_params("127.0.0.1", "localhost", 0).unwrap_err();
        assert!(err.to_string().contains("Remote port"));
    }

    #[test]
    fn validate_accepts_defaults() {
        assert!(validate_forward_params("127.0.0.1", "localhost", 5432).is_ok());
    }

    #[test]
    fn validate_rejects_empty_bind_host() {
        let err = validate_forward_params("  ", "localhost", 22).unwrap_err();
        assert!(err.to_string().contains("Local bind host"));
    }

    #[test]
    fn forward_ids_are_unique() {
        let a = next_forward_id();
        let b = next_forward_id();
        assert_ne!(a, b);
        assert!(a.starts_with("pf-"));
    }

    #[tokio::test]
    async fn stop_all_is_noop_when_empty() {
        let mgr = PortForwardManager::new();
        mgr.stop_all_for_connection("missing").await;
        assert!(mgr.list("missing").await.is_empty());
    }

    #[tokio::test]
    async fn stop_missing_forward_errors() {
        let mgr = PortForwardManager::new();
        let err = mgr.stop("c1", "f1").await.unwrap_err();
        assert!(err.to_string().contains("No port forwards"));
    }
}
