//! Path-based SFTP transfers. File contents never accumulate in memory.

use anyhow::Result;
use russh_sftp::client::SftpSession;
use serde::Serialize;
use std::time::{Duration, Instant};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

const BUFFER_BYTES: usize = 64 * 1024;
const PROGRESS_INTERVAL: Duration = Duration::from_millis(100);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgress {
    pub bytes_transferred: u64,
    pub total_bytes: Option<u64>,
}

pub type ProgressCallback = dyn Fn(TransferProgress) + Send + Sync;

struct Reporter<'a> {
    callback: Option<&'a ProgressCallback>,
    total: Option<u64>,
    last_report: Instant,
}

impl<'a> Reporter<'a> {
    fn new(callback: Option<&'a ProgressCallback>, total: Option<u64>) -> Self {
        let reporter = Self {
            callback,
            total,
            last_report: Instant::now(),
        };
        reporter.send(0);
        reporter
    }

    fn send(&self, bytes: u64) {
        if let Some(callback) = self.callback {
            callback(TransferProgress {
                bytes_transferred: bytes,
                total_bytes: self.total,
            });
        }
    }

    fn update(&mut self, bytes: u64, now: Instant) {
        if now.duration_since(self.last_report) >= PROGRESS_INTERVAL {
            self.send(bytes);
            self.last_report = now;
        }
    }
}

async fn copy_stream<R: AsyncRead + Unpin, W: AsyncWrite + Unpin>(
    reader: &mut R,
    writer: &mut W,
    reporter: &mut Reporter<'_>,
) -> Result<u64> {
    let mut buffer = vec![0; BUFFER_BYTES];
    let mut bytes = 0;
    loop {
        let read = reader.read(&mut buffer).await?;
        if read == 0 {
            break;
        }
        writer.write_all(&buffer[..read]).await?;
        bytes += read as u64;
        reporter.update(bytes, Instant::now());
    }
    writer.flush().await?;
    Ok(bytes)
}

// Preserve the transfer error even if closing the remote handle also fails.
async fn close_file(file: &mut russh_sftp::client::fs::File, result: Result<u64>) -> Result<u64> {
    match result {
        Ok(bytes) => {
            file.shutdown().await?;
            Ok(bytes)
        }
        Err(error) => {
            let _ = tokio::time::timeout(Duration::from_secs(1), file.shutdown()).await;
            Err(error)
        }
    }
}

pub async fn download(
    sftp: &SftpSession,
    remote_path: &str,
    local_path: &str,
    progress: Option<&ProgressCallback>,
) -> Result<u64> {
    let mut remote = sftp.open(remote_path).await?;
    let total = remote
        .metadata()
        .await
        .ok()
        .and_then(|metadata| metadata.size);
    let mut reporter = Reporter::new(progress, total);
    let result = async {
        // Open the source first, so a missing source cannot truncate the target.
        let mut local = tokio::fs::File::create(local_path).await?;
        copy_stream(&mut remote, &mut local, &mut reporter).await
    }
    .await;
    let bytes = close_file(&mut remote, result).await?;
    reporter.send(bytes);
    Ok(bytes)
}

pub async fn upload(
    sftp: &SftpSession,
    local_path: &str,
    remote_path: &str,
    progress: Option<&ProgressCallback>,
) -> Result<u64> {
    let mut local = tokio::fs::File::open(local_path).await?;
    let total = local.metadata().await.ok().map(|metadata| metadata.len());
    let mut remote = sftp.create(remote_path).await?;
    let mut reporter = Reporter::new(progress, total);
    let result = copy_stream(&mut local, &mut remote, &mut reporter).await;
    let bytes = close_file(&mut remote, result).await?;
    reporter.send(bytes);
    Ok(bytes)
}

#[cfg(test)]
mod tests;
