//! Path-based SFTP transfers. File contents never accumulate in memory.

use anyhow::{anyhow, Result};
use russh_sftp::client::SftpSession;
use serde::Serialize;
use std::time::{Duration, Instant};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio_util::sync::CancellationToken;

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

// Cancellation and dedicated-session setup adapted from upstream PR #168,
// 4a63fb8403bbb958aec797bee647b1e26a23ea70 (MIT). Keep our bounded copy loop.
pub const CANCEL_ERROR: &str = "Transfer cancelled";
const CLOSE_TIMEOUT: Duration = Duration::from_millis(500);
const CLEANUP_TIMEOUT: Duration = Duration::from_secs(1);

async fn interrupt<T>(
    cancel: &CancellationToken,
    future: impl std::future::Future<Output = T>,
) -> Result<T> {
    tokio::select! {
        biased;
        _ = cancel.cancelled() => Err(anyhow!(CANCEL_ERROR)),
        value = future => Ok(value),
    }
}

#[cfg(test)]
async fn copy_stream<R: AsyncRead + Unpin, W: AsyncWrite + Unpin>(
    reader: &mut R,
    writer: &mut W,
    reporter: &mut Reporter<'_>,
) -> Result<u64> {
    copy_stream_cancellable(reader, writer, reporter, &CancellationToken::new()).await
}

async fn copy_stream_cancellable<R: AsyncRead + Unpin, W: AsyncWrite + Unpin>(
    reader: &mut R,
    writer: &mut W,
    reporter: &mut Reporter<'_>,
    cancel: &CancellationToken,
) -> Result<u64> {
    let mut buffer = vec![0; BUFFER_BYTES];
    let mut bytes = 0;
    loop {
        let read = interrupt(cancel, reader.read(&mut buffer)).await??;
        if read == 0 {
            break;
        }
        interrupt(cancel, writer.write_all(&buffer[..read])).await??;
        bytes += read as u64;
        reporter.update(bytes, Instant::now());
    }
    interrupt(cancel, writer.flush()).await??;
    Ok(bytes)
}

async fn close_file(
    file: &mut russh_sftp::client::fs::File,
    result: Result<u64>,
    cancel: &CancellationToken,
) -> Result<u64> {
    let result = match result {
        Ok(bytes) => interrupt(cancel, file.shutdown())
            .await
            .and_then(|r| r.map(|_| bytes).map_err(Into::into)),
        Err(error) => Err(error),
    };
    if result.is_err() {
        // shutdown may wait for WRITE acknowledgements. Its timeout followed by
        // File::drop (close_nowait) and closing the dedicated session bounds this.
        let _ = tokio::time::timeout(CLOSE_TIMEOUT, file.shutdown()).await;
    }
    result
}

#[cfg(test)]
pub async fn download(
    sftp: &SftpSession,
    remote_path: &str,
    local_path: &str,
    progress: Option<&ProgressCallback>,
) -> Result<u64> {
    download_cancellable(
        sftp,
        remote_path,
        local_path,
        progress,
        &CancellationToken::new(),
    )
    .await
}

pub async fn download_cancellable(
    sftp: &SftpSession,
    remote_path: &str,
    local_path: &str,
    progress: Option<&ProgressCallback>,
    cancel: &CancellationToken,
) -> Result<u64> {
    let mut remote = interrupt(cancel, sftp.open(remote_path)).await??;
    let mut local = None;
    let mut reporter = Reporter {
        callback: progress,
        total: None,
        last_report: Instant::now(),
    };
    let result = async {
        reporter.total = interrupt(cancel, remote.metadata())
            .await?
            .ok()
            .and_then(|m| m.size);
        reporter.last_report = Instant::now();
        reporter.send(0);
        // Opening the source first protects an existing target from a missing source.
        local = Some(interrupt(cancel, tokio::fs::File::create(local_path)).await??);
        copy_stream_cancellable(&mut remote, local.as_mut().unwrap(), &mut reporter, cancel).await
    }
    .await;
    let bytes = if result.is_err() {
        let error = result.unwrap_err();
        let _ = tokio::time::timeout(CLEANUP_TIMEOUT, async {
            if let Some(local) = &mut local {
                let _ = tokio::time::timeout(CLOSE_TIMEOUT, local.flush()).await;
            }
            let _ = close_file(&mut remote, Err(anyhow!(CANCEL_ERROR)), cancel).await;
        })
        .await;
        return Err(error);
    } else {
        close_file(&mut remote, result, cancel).await?
    };
    reporter.send(bytes);
    Ok(bytes)
}

#[cfg(test)]
pub async fn upload(
    sftp: &SftpSession,
    local_path: &str,
    remote_path: &str,
    progress: Option<&ProgressCallback>,
) -> Result<u64> {
    upload_cancellable(
        sftp,
        local_path,
        remote_path,
        progress,
        &CancellationToken::new(),
    )
    .await
}

pub async fn upload_cancellable(
    sftp: &SftpSession,
    local_path: &str,
    remote_path: &str,
    progress: Option<&ProgressCallback>,
    cancel: &CancellationToken,
) -> Result<u64> {
    let mut local = interrupt(cancel, tokio::fs::File::open(local_path)).await??;
    let total = interrupt(cancel, local.metadata())
        .await?
        .ok()
        .map(|m| m.len());
    let mut remote = interrupt(cancel, sftp.create(remote_path)).await??;
    let mut reporter = Reporter::new(progress, total);
    let result = copy_stream_cancellable(&mut local, &mut remote, &mut reporter, cancel).await;
    let bytes = close_file(&mut remote, result, cancel).await?;
    reporter.send(bytes);
    Ok(bytes)
}

pub async fn transfer(
    session: &russh::client::Handle<crate::ssh::Client>,
    upload: bool,
    local_path: &str,
    remote_path: &str,
    progress: Option<&ProgressCallback>,
    cancel: &CancellationToken,
) -> Result<u64> {
    let channel = interrupt(cancel, session.channel_open_session()).await??;
    interrupt(cancel, channel.request_subsystem(true, "sftp")).await??;
    let config = russh_sftp::client::Config {
        request_timeout_secs: 120,
        ..Default::default()
    };
    let sftp = interrupt(
        cancel,
        SftpSession::new_with_config(channel.into_stream(), config),
    )
    .await??;
    let result = if upload {
        upload_cancellable(&sftp, local_path, remote_path, progress, cancel).await
    } else {
        download_cancellable(&sftp, remote_path, local_path, progress, cancel).await
    };
    // Only this transfer's subsystem is closed; the authenticated transport and
    // listing session remain usable after cancelling a file.
    let _ = sftp.close().await;
    result
}

#[cfg(test)]
mod tests;
