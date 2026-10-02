use crate::connection_diagnostics::{classify_connect_error, ConnectErrorKind, ConnectStage};
use crate::connection_manager::ConnectionManager;
use crate::{WEBSOCKET_PORT, WEBSOCKET_TOKEN};
use anyhow::Result;
use base64::Engine as _;
use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;
use subtle::ConstantTimeEq;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request};
use tokio_tungstenite::tungstenite::http::StatusCode;
use tokio_tungstenite::{accept_hdr_async, tungstenite::Message, WebSocketStream};
use tokio_util::sync::CancellationToken;

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum WsMessage {
    /// Start a new PTY connection
    StartPty {
        connection_id: String,
        cols: u32,
        rows: u32,
    },
    /// Terminal input (user typing)
    Input {
        connection_id: String,
        data: Vec<u8>,
    },
    /// Terminal output (from PTY)
    Output {
        connection_id: String,
        data: Vec<u8>,
    },
    /// Resize terminal
    Resize {
        connection_id: String,
        cols: u32,
        rows: u32,
    },
    /// Pause output (flow control - like ttyd)
    Pause { connection_id: String },
    /// Resume output (flow control - like ttyd)
    Resume { connection_id: String },
    /// Close PTY connection
    Close {
        connection_id: String,
        /// If provided, the close is only applied when the generation matches
        /// the current session. This prevents a stale close (from a remounting
        /// component) from killing a newly created PTY session.
        #[serde(default)]
        generation: Option<u64>,
    },
    /// Error message (optionally classified for connection diagnostics)
    Error {
        message: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        error_kind: Option<ConnectErrorKind>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        failed_stage: Option<ConnectStage>,
    },
    /// Success confirmation
    Success { message: String },
    /// PTY session started — includes the generation counter so the frontend
    /// can send it back in Close to avoid stale-close races.
    PtyStarted {
        connection_id: String,
        generation: u64,
    },
    /// Session-stage progress (e.g. requesting PTY) for diagnostics UI.
    Progress {
        connection_id: String,
        stage: String,
    },
}

/// WebSocket server for terminal I/O
/// Handles bidirectional communication between frontend and PTY connections
pub struct WebSocketServer {
    connection_manager: Arc<ConnectionManager>,
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Back-pressure bound: maximum binary output frames queued between the PTY
/// reader task and the WebSocket sender task.  When this fills up the PTY
/// reader *blocks*, propagating pressure back through output_tx → SSH channel
/// → TCP window → the remote process (e.g. `yes`).
const WS_OUTPUT_QUEUE_CAPACITY: usize = 256;

/// Batch PTY output into frames of at most this size before sending.
const OUTPUT_FLUSH_BYTES: usize = 16 * 1024;

/// Maximum time (ms) between flushes — keeps latency low for slow output.
const OUTPUT_FLUSH_INTERVAL_MS: u128 = 10;

/// Faster flush for small interactive redraws (zsh line editor, autosuggestions).
const OUTPUT_FLUSH_INTERVAL_INTERACTIVE_MS: u128 = 2;

/// Buffers below this size are treated as interactive line-editor output.
const INTERACTIVE_FLUSH_THRESHOLD: usize = 512;

/// Timeout (ms) for sending JSON *control* messages.  Control messages are
/// best-effort: if the channel is saturated we drop the ACK rather than block
/// the message-dispatch loop.  Output frames use blocking sends instead.
const CONTROL_SEND_TIMEOUT_MS: u64 = 100;

/// Command byte that identifies a binary PTY output frame sent to the frontend.
const BINARY_OUTPUT_CMD: u8 = 0x01;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WsTx = mpsc::Sender<Message>;

const APP_ORIGINS: &[&str] = &[
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
];
const DEV_ORIGINS: &[&str] = &["http://localhost:1420", "http://127.0.0.1:1420"];

fn generate_bridge_token() -> Result<String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes)
        .map_err(|e| anyhow::anyhow!("Failed to generate WebSocket bridge token: {e}"))?;
    Ok(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes))
}

fn validate_handshake(
    request: &Request,
    expected_token: &str,
    allow_dev_origins: bool,
) -> std::result::Result<(), &'static str> {
    if expected_token.is_empty() {
        return Err("bridge token not initialized");
    }
    let mut origins = request.headers().get_all("origin").iter();
    if let Some(origin) = origins.next() {
        if origins.next().is_some() {
            return Err("multiple origins");
        }
        let origin = origin.to_str().map_err(|_| "invalid origin")?;
        if !APP_ORIGINS.contains(&origin) && !(allow_dev_origins && DEV_ORIGINS.contains(&origin)) {
            return Err("origin not allowed");
        }
    }

    let mut tokens = request
        .uri()
        .query()
        .unwrap_or_default()
        .split('&')
        .filter_map(|parameter| {
            let (key, value) = parameter.split_once('=').unwrap_or((parameter, ""));
            (key == "token").then_some(value)
        });
    let token = tokens.next().ok_or("missing token")?;
    if tokens.next().is_some() {
        return Err("multiple tokens");
    }
    if !bool::from(token.as_bytes().ct_eq(expected_token.as_bytes())) {
        return Err("invalid token");
    }
    Ok(())
}

async fn accept_authenticated_connection(
    stream: TcpStream,
    expected_token: &str,
) -> Result<WebSocketStream<TcpStream>> {
    accept_hdr_async(stream, |request: &Request, response| {
        match validate_handshake(request, expected_token, cfg!(debug_assertions)) {
            Ok(()) => Ok(response),
            Err(reason) => {
                // Never log the request URI: it contains the bridge secret.
                tracing::warn!("Rejected WebSocket handshake: {}", reason);
                let mut rejection = ErrorResponse::new(Some(reason.to_string()));
                *rejection.status_mut() = StatusCode::FORBIDDEN;
                Err(rejection)
            }
        }
    })
    .await
    // Handshake library errors may contain request headers or URIs.
    .map_err(|_| anyhow::anyhow!("WebSocket handshake failed"))
}

#[derive(Debug, PartialEq, Eq)]
enum SendOutcome {
    Sent,
    /// WS sender task exited — treat as a fatal error in the reader loop.
    Closed,
    /// Only returned for control messages that timed out.
    Dropped,
}

#[derive(Debug, PartialEq, Eq)]
enum PtyLifecycleEvent {
    None,
    Started {
        connection_id: String,
        generation: u64,
    },
    Closed {
        connection_id: String,
        generation: Option<u64>,
    },
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/// Encode a binary PTY output frame:
///   [0x01][id_len: u16 BE][connection_id bytes][payload bytes]
fn encode_output_frame(connection_id: &str, data: &[u8]) -> Vec<u8> {
    let id_bytes = connection_id.as_bytes();
    let id_len = id_bytes.len().min(u16::MAX as usize);
    let mut frame = Vec::with_capacity(3 + id_len + data.len());
    frame.push(BINARY_OUTPUT_CMD);
    frame.extend_from_slice(&(id_len as u16).to_be_bytes());
    frame.extend_from_slice(&id_bytes[..id_len]);
    frame.extend_from_slice(data);
    frame
}

/// Send a JSON control message with a timeout.
/// Control messages are best-effort — a saturated channel returns `Dropped`.
async fn send_control(tx: &WsTx, msg: &WsMessage) -> Result<SendOutcome> {
    let frame = Message::Text(serde_json::to_string(msg)?.into());
    match tokio::time::timeout(
        Duration::from_millis(CONTROL_SEND_TIMEOUT_MS),
        tx.send(frame),
    )
    .await
    {
        Ok(Ok(())) => Ok(SendOutcome::Sent),
        Ok(Err(_)) => Ok(SendOutcome::Closed),
        Err(_) => Ok(SendOutcome::Dropped),
    }
}

/// Flush accumulated PTY bytes as a binary output frame.
///
/// **Blocks** until the WS channel has room or the session is cancelled.
/// This is the end-to-end backpressure mechanism: a full WS channel stalls
/// the PTY reader, which stalls `output_tx`, which stalls `channel.wait()`,
/// which exhausts the SSH window and stops the remote process from sending.
async fn flush_output(
    tx: &WsTx,
    connection_id: &str,
    accumulated: &mut Vec<u8>,
    cancel: &CancellationToken,
) -> SendOutcome {
    if accumulated.is_empty() {
        return SendOutcome::Sent;
    }
    let frame = encode_output_frame(connection_id, accumulated);
    accumulated.clear();
    tokio::select! {
        biased;
        _ = cancel.cancelled() => SendOutcome::Closed,
        result = tx.send(Message::Binary(frame.into())) => match result {
            Ok(()) => SendOutcome::Sent,
            Err(_) => SendOutcome::Closed,
        }
    }
}

async fn flush_pty_output_batch(
    tx: &WsTx,
    connection_id: &str,
    accumulated: &mut Vec<u8>,
    cancel: &CancellationToken,
    last_flush: &mut tokio::time::Instant,
) -> SendOutcome {
    let outcome = flush_output(tx, connection_id, accumulated, cancel).await;
    if outcome != SendOutcome::Closed {
        *last_flush = tokio::time::Instant::now();
    }
    outcome
}

fn should_remove_pty_state(active_gen: Option<u64>, closed_gen: Option<u64>) -> bool {
    match (active_gen, closed_gen) {
        (Some(a), Some(c)) => a == c,
        (Some(_), None) => true,
        _ => false,
    }
}

fn output_flush_interval_ms(accumulated_len: usize) -> u128 {
    if accumulated_len < INTERACTIVE_FLUSH_THRESHOLD {
        OUTPUT_FLUSH_INTERVAL_INTERACTIVE_MS
    } else {
        OUTPUT_FLUSH_INTERVAL_MS
    }
}

/// Whether accumulated PTY bytes should be sent now.
/// Interactive chunks flush immediately — release builds read the local PTY
/// faster than dev and would otherwise batch past the 2 ms window.
fn should_flush_pty_output(accumulated_len: usize, elapsed_ms: u128) -> bool {
    accumulated_len >= OUTPUT_FLUSH_BYTES
        || accumulated_len < INTERACTIVE_FLUSH_THRESHOLD
        || elapsed_ms >= output_flush_interval_ms(accumulated_len)
}

impl WebSocketServer {
    pub fn new(connection_manager: Arc<ConnectionManager>) -> Self {
        Self { connection_manager }
    }

    /// Start the WebSocket server, trying ports 9001-9010 to find an available one
    pub async fn start(self: Arc<Self>) -> Result<()> {
        if WEBSOCKET_TOKEN.get().is_none() {
            let token = generate_bridge_token()?;
            WEBSOCKET_TOKEN
                .set(token)
                .map_err(|_| anyhow::anyhow!("WebSocket bridge token already initialized"))?;
        }
        // Try ports 9001-9010 to find an available one
        let mut listener = None;
        let mut bound_port = 0u16;

        for port in 9001..=9010 {
            let addr: SocketAddr = format!("127.0.0.1:{}", port).parse()?;
            match TcpListener::bind(&addr).await {
                Ok(l) => {
                    tracing::info!("WebSocket server listening on {}", addr);
                    listener = Some(l);
                    bound_port = port;
                    break;
                }
                Err(e) => {
                    tracing::warn!("Port {} unavailable: {}, trying next...", port, e);
                }
            }
        }

        let listener = listener
            .ok_or_else(|| anyhow::anyhow!("Failed to bind to any port in range 9001-9010"))?;

        // Store the bound port in the global atomic for frontend to query
        WEBSOCKET_PORT.store(bound_port, Ordering::SeqCst);
        tracing::info!("WebSocket port stored: {}", bound_port);

        loop {
            match listener.accept().await {
                Ok((stream, addr)) => {
                    tracing::info!("New WebSocket connection from: {}", addr);
                    let server = self.clone();
                    tokio::spawn(async move {
                        let token = WEBSOCKET_TOKEN
                            .get()
                            .map(String::as_str)
                            .unwrap_or_default();
                        if let Err(e) = server.handle_connection(stream, token).await {
                            tracing::error!("WebSocket connection error: {}", e);
                        }
                    });
                }
                Err(e) => {
                    tracing::error!("Failed to accept connection: {}", e);
                }
            }
        }
    }

    /// Handle a single WebSocket connection
    async fn handle_connection(&self, stream: TcpStream, expected_token: &str) -> Result<()> {
        let ws_stream = accept_authenticated_connection(stream, expected_token).await?;
        let (mut ws_sender, mut ws_receiver) = ws_stream.split();

        // Bounded channel: when full the PTY reader blocks, providing backpressure
        // all the way back to the SSH channel and the remote process.
        let (tx, mut rx) = mpsc::channel::<Message>(WS_OUTPUT_QUEUE_CAPACITY);
        let mut active_pty_generations: HashMap<String, u64> = HashMap::new();

        // Forward messages from the bounded channel to the WebSocket.
        let ws_sender_task = tokio::spawn(async move {
            while let Some(msg) = rx.recv().await {
                if ws_sender.send(msg).await.is_err() {
                    break;
                }
            }
        });

        // Handle incoming WebSocket messages
        while let Some(msg) = ws_receiver.next().await {
            match msg {
                Ok(Message::Binary(data)) => {
                    // Binary INPUT command from frontend (fast path, no JSON).
                    // Format: [0x00][connection_id: 36 bytes][data bytes]
                    if data.is_empty() {
                        continue;
                    }
                    match data[0] {
                        0x00 => {
                            if data.len() < 37 {
                                tracing::warn!("Binary INPUT message too short");
                                continue;
                            }
                            let connection_id = String::from_utf8_lossy(&data[1..37]).to_string();
                            let input_data = data[37..].to_vec();
                            if let Err(e) = self
                                .connection_manager
                                .write_to_pty(&connection_id, input_data)
                                .await
                            {
                                tracing::error!("Failed to write to PTY: {}", e);
                            }
                        }
                        _ => {
                            tracing::warn!("Unknown binary command: {}", data[0]);
                        }
                    }
                }
                Ok(Message::Text(text)) => {
                    tracing::debug!("Received text message: {}", text);
                    let ws_msg: WsMessage = match serde_json::from_str(&text) {
                        Ok(msg) => msg,
                        Err(e) => {
                            let error = WsMessage::Error {
                                message: format!("Invalid message format: {}", e),
                                error_kind: None,
                                failed_stage: None,
                            };
                            let _ = send_control(&tx, &error).await?;
                            continue;
                        }
                    };
                    match self.handle_message(ws_msg, tx.clone()).await {
                        Ok(PtyLifecycleEvent::Started {
                            connection_id,
                            generation,
                        }) => {
                            active_pty_generations.insert(connection_id, generation);
                        }
                        Ok(PtyLifecycleEvent::Closed {
                            connection_id,
                            generation,
                        }) => {
                            if should_remove_pty_state(
                                active_pty_generations.get(&connection_id).copied(),
                                generation,
                            ) {
                                active_pty_generations.remove(&connection_id);
                            }
                        }
                        Ok(PtyLifecycleEvent::None) => {}
                        Err(e) => {
                            let error = WsMessage::Error {
                                message: format!("Error handling message: {}", e),
                                error_kind: None,
                                failed_stage: None,
                            };
                            let _ = send_control(&tx, &error).await?;
                        }
                    }
                }
                Ok(Message::Close(_)) => {
                    tracing::info!("WebSocket connection closed by client");
                    break;
                }
                Ok(Message::Ping(_)) | Ok(Message::Pong(_)) | Ok(Message::Frame(_)) => {}
                Err(e) => {
                    tracing::error!("WebSocket error: {}", e);
                    break;
                }
            }
        }

        // Clean up all active PTY sessions so the SSH channel and reader task
        // are torn down promptly when the browser tab closes.
        for (connection_id, generation) in active_pty_generations {
            if let Err(e) = self
                .connection_manager
                .close_pty_connection(&connection_id, Some(generation))
                .await
            {
                tracing::warn!(
                    "Failed to close PTY session {} on WebSocket cleanup: {}",
                    connection_id,
                    e
                );
            }
        }
        ws_sender_task.abort();

        Ok(())
    }

    /// Handle a WebSocket message
    async fn handle_message(&self, msg: WsMessage, tx: WsTx) -> Result<PtyLifecycleEvent> {
        match msg {
            WsMessage::StartPty {
                connection_id,
                cols,
                rows,
            } => {
                tracing::info!(
                    "Starting PTY connection: {} ({}x{})",
                    connection_id,
                    cols,
                    rows
                );

                let progress = WsMessage::Progress {
                    connection_id: connection_id.clone(),
                    stage: ConnectStage::RequestingPty.as_str().to_string(),
                };
                let _ = send_control(&tx, &progress).await;

                let generation = match self
                    .connection_manager
                    .start_pty_connection(&connection_id, cols, rows)
                    .await
                {
                    Ok(gen) => gen,
                    Err(e) => {
                        let diag = classify_connect_error(&e, ConnectStage::RequestingPty);
                        let error = WsMessage::Error {
                            message: diag.message,
                            error_kind: Some(diag.kind),
                            failed_stage: Some(diag.stage),
                        };
                        let _ = send_control(&tx, &error).await;
                        return Ok(PtyLifecycleEvent::None);
                    }
                };

                let cancel_token = self
                    .connection_manager
                    .get_pty_cancel_token(&connection_id)
                    .await
                    .ok_or_else(|| {
                        anyhow::anyhow!("PTY session disappeared immediately after creation")
                    })?;

                let response = WsMessage::Success {
                    message: format!("PTY connection started: {}", connection_id),
                };
                send_control(&tx, &response).await?;

                let started = WsMessage::PtyStarted {
                    connection_id: connection_id.clone(),
                    generation,
                };
                send_control(&tx, &started).await?;

                let connected = WsMessage::Progress {
                    connection_id: connection_id.clone(),
                    stage: ConnectStage::Connected.as_str().to_string(),
                };
                let _ = send_control(&tx, &connected).await;

                // Spawn the PTY reader task.
                // `flush_output` blocks when the WS channel is full — this
                // propagates back-pressure through output_tx to the SSH window.
                // Wait on the output channel (native-style: sleep until data).
                let connection_manager = self.connection_manager.clone();
                let connection_id_clone = connection_id.clone();
                let tx_clone = tx.clone();

                tokio::spawn(async move {
                    let mut accumulated = Vec::with_capacity(OUTPUT_FLUSH_BYTES);
                    let mut last_flush = tokio::time::Instant::now();
                    let flush_interval = Duration::from_millis(OUTPUT_FLUSH_INTERVAL_MS as u64);

                    loop {
                        tokio::select! {
                            biased;
                            _ = cancel_token.cancelled() => {
                                tracing::info!(
                                    "PTY reader task cancelled for {}",
                                    connection_id_clone
                                );
                                return;
                            }
                            result = connection_manager.read_from_pty(&connection_id_clone) => {
                                match result {
                                    Ok(data) => {
                                        accumulated.extend_from_slice(&data);
                                        if should_flush_pty_output(
                                            accumulated.len(),
                                            last_flush.elapsed().as_millis(),
                                        ) && flush_pty_output_batch(
                                                &tx_clone,
                                                &connection_id_clone,
                                                &mut accumulated,
                                                &cancel_token,
                                                &mut last_flush,
                                            )
                                            .await
                                                == SendOutcome::Closed
                                        {
                                            break;
                                        }
                                    }
                                    Err(e) => {
                                        tracing::error!(
                                            "Error reading from PTY {}: {}",
                                            connection_id_clone,
                                            e
                                        );
                                        let error_msg = WsMessage::Error {
                                            message: format!("Connection lost: {}", e),
                                            error_kind: None,
                                            failed_stage: None,
                                        };
                                        let _ = send_control(&tx_clone, &error_msg).await;
                                        break;
                                    }
                                }
                            }
                            _ = tokio::time::sleep_until(last_flush + flush_interval),
                                if !accumulated.is_empty() =>
                            {
                                if flush_pty_output_batch(
                                    &tx_clone,
                                    &connection_id_clone,
                                    &mut accumulated,
                                    &cancel_token,
                                    &mut last_flush,
                                )
                                .await
                                    == SendOutcome::Closed
                                {
                                    break;
                                }
                            }
                        }
                    }

                    tracing::info!("PTY reader task exiting for {}", connection_id_clone);
                });

                Ok(PtyLifecycleEvent::Started {
                    connection_id,
                    generation,
                })
            }
            WsMessage::Input {
                connection_id,
                data,
            } => {
                tracing::debug!(
                    "Received input for connection {}: {} bytes",
                    connection_id,
                    data.len()
                );
                self.connection_manager
                    .write_to_pty(&connection_id, data)
                    .await?;
                Ok(PtyLifecycleEvent::None)
            }
            WsMessage::Resize {
                connection_id,
                cols,
                rows,
            } => {
                tracing::info!("Resizing terminal {}: {}x{}", connection_id, cols, rows);
                self.connection_manager
                    .resize_pty(&connection_id, cols, rows)
                    .await?;
                let response = WsMessage::Success {
                    message: format!("Terminal resized: {}x{}", cols, rows),
                };
                send_control(&tx, &response).await?;
                Ok(PtyLifecycleEvent::None)
            }
            WsMessage::Pause { connection_id } => {
                tracing::debug!(
                    "Pause received for connection: {} (no-op; backpressure via bounded channel)",
                    connection_id
                );
                Ok(PtyLifecycleEvent::None)
            }
            WsMessage::Resume { connection_id } => {
                tracing::debug!(
                    "Resume received for connection: {} (no-op; backpressure via bounded channel)",
                    connection_id
                );
                Ok(PtyLifecycleEvent::None)
            }
            WsMessage::Close {
                connection_id,
                generation,
            } => {
                tracing::info!(
                    "Closing PTY connection: {} (gen: {:?})",
                    connection_id,
                    generation
                );
                self.connection_manager
                    .close_pty_connection(&connection_id, generation)
                    .await?;
                let response = WsMessage::Success {
                    message: format!("PTY connection closed: {}", connection_id),
                };
                send_control(&tx, &response).await?;
                Ok(PtyLifecycleEvent::Closed {
                    connection_id,
                    generation,
                })
            }

            _ => {
                tracing::warn!("Unexpected message type received");
                Ok(PtyLifecycleEvent::None)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    use tokio_tungstenite::tungstenite::http::HeaderValue;

    const TOKEN: &str = "test-bridge-secret";

    fn request(query: &str, origin: Option<&str>) -> Request {
        let mut request = format!("ws://127.0.0.1:9001/?{query}")
            .into_client_request()
            .unwrap();
        if let Some(origin) = origin {
            request
                .headers_mut()
                .insert("origin", origin.parse().unwrap());
        }
        request
    }

    #[test]
    fn authenticates_app_origins_and_native_clients() {
        for origin in APP_ORIGINS.iter().copied().map(Some).chain([None]) {
            assert_eq!(
                validate_handshake(&request("token=test-bridge-secret", origin), TOKEN, false),
                Ok(())
            );
        }
        assert_eq!(
            validate_handshake(
                &request("other=1&token=test-bridge-secret&after=2", None),
                TOKEN,
                false
            ),
            Ok(())
        );
    }

    #[test]
    fn dev_origins_are_only_accepted_in_debug_policy() {
        for origin in DEV_ORIGINS {
            let request = request("token=test-bridge-secret", Some(origin));
            assert!(validate_handshake(&request, TOKEN, true).is_ok());
            assert_eq!(
                validate_handshake(&request, TOKEN, false),
                Err("origin not allowed")
            );
        }
    }

    #[test]
    fn rejects_missing_empty_wrong_and_duplicate_tokens() {
        for query in [
            "",
            "token",
            "token=",
            "token=%20",
            "token=wrong",
            "token=test-bridge-secre",
            "token=test-bridge-secret-extra",
            "token=test-bridge-secret&token=test-bridge-secret",
            "token=test-bridge-secret&token",
            "token=wrong&token=test-bridge-secret",
        ] {
            assert!(
                validate_handshake(&request(query, None), TOKEN, true).is_err(),
                "accepted {query}"
            );
        }
        assert!(validate_handshake(&request("token=test-bridge-secret", None), "", true).is_err());
    }

    #[test]
    fn rejects_foreign_null_invalid_and_duplicate_origins() {
        for origin in [
            "https://example.com",
            "null",
            "",
            "tauri://localhost.evil",
            "http://localhost:1421",
        ] {
            assert!(validate_handshake(
                &request("token=test-bridge-secret", Some(origin)),
                TOKEN,
                true
            )
            .is_err());
        }
        let mut invalid = request("token=test-bridge-secret", None);
        invalid
            .headers_mut()
            .insert("origin", HeaderValue::from_bytes(b"\xff").unwrap());
        assert_eq!(
            validate_handshake(&invalid, TOKEN, true),
            Err("invalid origin")
        );
        let mut duplicate = request("token=test-bridge-secret", Some("tauri://localhost"));
        duplicate
            .headers_mut()
            .append("origin", HeaderValue::from_static("tauri://localhost"));
        assert_eq!(
            validate_handshake(&duplicate, TOKEN, true),
            Err("multiple origins")
        );
    }

    #[test]
    fn token_is_256_bits_urlsafe_and_fresh() {
        let token = generate_bridge_token().unwrap();
        assert_eq!(token.len(), 43);
        assert!(token
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_'));
        assert_eq!(
            base64::engine::general_purpose::URL_SAFE_NO_PAD
                .decode(&token)
                .unwrap()
                .len(),
            32
        );
        assert_ne!(token, generate_bridge_token().unwrap());
    }

    async fn spawn_bridge() -> (
        SocketAddr,
        Arc<ConnectionManager>,
        tokio::task::JoinHandle<Result<()>>,
    ) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let manager = Arc::new(ConnectionManager::new());
        let server = WebSocketServer::new(manager.clone());
        let task = tokio::spawn(async move {
            let (stream, _) = listener.accept().await?;
            server.handle_connection(stream, TOKEN).await
        });
        (addr, manager, task)
    }

    #[tokio::test]
    async fn authenticated_socket_upgrades_and_reaches_pty_dispatch() {
        let (addr, _, server) = spawn_bridge().await;
        let mut request = format!("ws://{addr}/?token={TOKEN}")
            .into_client_request()
            .unwrap();
        request
            .headers_mut()
            .insert("origin", HeaderValue::from_static("tauri://localhost"));
        let (mut socket, response) = tokio_tungstenite::connect_async(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::SWITCHING_PROTOCOLS);
        socket
            .send(Message::Text(
                r#"{"type":"StartPty","connection_id":"missing-ssh-session","cols":80,"rows":24}"#
                    .into(),
            ))
            .await
            .unwrap();
        for expected in ["Progress", "Error"] {
            let message = tokio::time::timeout(Duration::from_secs(5), socket.next())
                .await
                .unwrap()
                .unwrap()
                .unwrap();
            let value: serde_json::Value =
                serde_json::from_str(message.to_text().unwrap()).unwrap();
            assert_eq!(value["type"], expected);
        }
        socket.close(None).await.unwrap();
        tokio::time::timeout(Duration::from_secs(5), server)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
    }

    #[tokio::test]
    async fn native_socket_with_token_needs_no_origin() {
        let (addr, _, server) = spawn_bridge().await;
        let (mut socket, response) =
            tokio_tungstenite::connect_async(format!("ws://{addr}/?token={TOKEN}"))
                .await
                .unwrap();
        assert_eq!(response.status(), StatusCode::SWITCHING_PROTOCOLS);
        socket.close(None).await.unwrap();
        tokio::time::timeout(Duration::from_secs(5), server)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
    }

    #[tokio::test]
    async fn real_handshake_rejects_unauthenticated_and_foreign_clients() {
        for (query, origin) in [
            ("", None),
            ("token=wrong", None),
            ("token=test-bridge-secret", Some("https://example.com")),
        ] {
            let (addr, _, server) = spawn_bridge().await;
            let mut request = format!("ws://{addr}/?{query}")
                .into_client_request()
                .unwrap();
            if let Some(origin) = origin {
                request
                    .headers_mut()
                    .insert("origin", origin.parse().unwrap());
            }
            let error = tokio_tungstenite::connect_async(request).await.unwrap_err();
            match error {
                tokio_tungstenite::tungstenite::Error::Http(response) => {
                    assert_eq!(response.status(), StatusCode::FORBIDDEN)
                }
                other => panic!("unexpected handshake error: {other}"),
            }
            assert!(server.await.unwrap().is_err());
        }
    }

    #[tokio::test]
    async fn rejected_upgrade_cannot_start_a_pty_even_with_pipelined_input() {
        let (addr, manager, server) = spawn_bridge().await;
        let mut stream = TcpStream::connect(addr).await.unwrap();
        let request = format!("GET / HTTP/1.1\r\nHost: {addr}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n");
        let message =
            br#"{"type":"StartPty","connection_id":"local-auth-probe","cols":80,"rows":24}"#;
        assert!(message.len() < 126);
        let mask = [1, 2, 3, 4];
        let mut bytes = request.into_bytes();
        bytes.extend_from_slice(&[0x81, 0x80 | message.len() as u8]);
        bytes.extend_from_slice(&mask);
        bytes.extend(
            message
                .iter()
                .enumerate()
                .map(|(i, byte)| byte ^ mask[i % 4]),
        );
        stream.write_all(&bytes).await.unwrap();
        let mut response = Vec::new();
        tokio::time::timeout(Duration::from_secs(5), stream.read_to_end(&mut response))
            .await
            .unwrap()
            .unwrap();
        // tungstenite may reject bytes sent before the upgrade as
        // JunkAfterRequest, before invoking the authentication callback.
        // Either rejection must keep the PTY dispatcher unreachable.
        assert!(
            response.is_empty() || String::from_utf8_lossy(&response).starts_with("HTTP/1.1 403")
        );
        assert!(server.await.unwrap().is_err());
        assert!(manager
            .get_pty_cancel_token("local-auth-probe")
            .await
            .is_none());
    }

    #[test]
    fn should_flush_pty_output_immediately_for_interactive_chunks() {
        assert!(should_flush_pty_output(64, 0));
        assert!(should_flush_pty_output(INTERACTIVE_FLUSH_THRESHOLD - 1, 0));
    }

    #[test]
    fn should_flush_pty_output_waits_for_interval_on_medium_chunks() {
        assert!(!should_flush_pty_output(INTERACTIVE_FLUSH_THRESHOLD, 0));
        assert!(should_flush_pty_output(
            INTERACTIVE_FLUSH_THRESHOLD,
            OUTPUT_FLUSH_INTERVAL_MS,
        ));
    }

    #[test]
    fn should_flush_pty_output_on_size_cap() {
        assert!(should_flush_pty_output(OUTPUT_FLUSH_BYTES, 0));
    }
}
