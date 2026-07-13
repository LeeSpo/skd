use crate::connection_diagnostics::{classify_connect_error, ConnectStage};
use crate::connection_manager::ConnectionManager;
use crate::WEBSOCKET_PORT;
use anyhow::Result;
use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio_tungstenite::{accept_async, tungstenite::Message};
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
        error_kind: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        failed_stage: Option<String>,
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
    match tokio::time::timeout(Duration::from_millis(CONTROL_SEND_TIMEOUT_MS), tx.send(frame)).await {
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
                        if let Err(e) = server.handle_connection(stream).await {
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
    async fn handle_connection(&self, stream: TcpStream) -> Result<()> {
        let ws_stream = accept_async(stream).await?;
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
                        Ok(PtyLifecycleEvent::Started { connection_id, generation }) => {
                            active_pty_generations.insert(connection_id, generation);
                        }
                        Ok(PtyLifecycleEvent::Closed { connection_id, generation }) => {
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
                            error_kind: Some(diag.kind.as_str().to_string()),
                            failed_stage: Some(diag.stage.as_str().to_string()),
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
                let connection_manager = self.connection_manager.clone();
                let connection_id_clone = connection_id.clone();
                let tx_clone = tx.clone();

                tokio::spawn(async move {
                    let mut accumulated = Vec::with_capacity(OUTPUT_FLUSH_BYTES);
                    let mut last_flush = tokio::time::Instant::now();

                    loop {
                        // --- Read from PTY (1 ms poll) ---
                        let read_result = tokio::select! {
                            biased;
                            _ = cancel_token.cancelled() => {
                                tracing::info!(
                                    "PTY reader task cancelled for {}",
                                    connection_id_clone
                                );
                                // Flush any remaining data before exiting.
                                let _ = flush_output(
                                    &tx_clone,
                                    &connection_id_clone,
                                    &mut accumulated,
                                    &cancel_token,
                                ).await;
                                return;
                            }
                            result = connection_manager.read_from_pty(&connection_id_clone) => result,
                        };

                        match read_result {
                            Ok(data) if data.is_empty() => {
                                // 1 ms poll returned nothing — flush if interval elapsed.
                                if !accumulated.is_empty()
                                    && should_flush_pty_output(
                                        accumulated.len(),
                                        last_flush.elapsed().as_millis(),
                                    )
                                {
                                    if flush_output(
                                        &tx_clone,
                                        &connection_id_clone,
                                        &mut accumulated,
                                        &cancel_token,
                                    )
                                    .await
                                        == SendOutcome::Closed
                                    {
                                        break;
                                    }
                                    last_flush = tokio::time::Instant::now();
                                }
                            }
                            Ok(data) => {
                                accumulated.extend_from_slice(&data);
                                if should_flush_pty_output(
                                    accumulated.len(),
                                    last_flush.elapsed().as_millis(),
                                ) {
                                    if flush_output(
                                        &tx_clone,
                                        &connection_id_clone,
                                        &mut accumulated,
                                        &cancel_token,
                                    )
                                    .await
                                        == SendOutcome::Closed
                                    {
                                        break;
                                    }
                                    last_flush = tokio::time::Instant::now();
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
