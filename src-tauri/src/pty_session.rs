use std::sync::Arc;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

/// Shared PTY session handle for interactive terminals (SSH or local shell).
pub struct PtySession {
    pub input_tx: mpsc::Sender<Vec<u8>>,
    pub output_rx: Arc<tokio::sync::Mutex<mpsc::Receiver<Vec<u8>>>>,
    pub resize_tx: mpsc::Sender<(u32, u32)>,
    /// Cancelled when this session is torn down.
    pub cancel: CancellationToken,
}