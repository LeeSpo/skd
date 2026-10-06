//! Bounded single-connection SFTP pipelines, adapted from R-Shell PR #187
//! (cdc7408b8bf61b50aa21b157232d08c8237c5188, MIT). Keep skd's progress,
//! cancellation and strict completion semantics around the upstream loops.

use anyhow::{anyhow, Result};
use futures::{
    stream::{FuturesOrdered, FuturesUnordered},
    StreamExt,
};
use russh_sftp::{
    client::{Config, RawSftpSession},
    protocol::{FileAttributes, OpenFlags, StatusCode},
};
use serde::Serialize;
use std::{
    collections::BTreeMap,
    future::Future,
    io,
    pin::Pin,
    sync::Arc,
    task::{Context, Poll},
    time::{Duration, Instant},
};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, ReadBuf};
use tokio_util::sync::{CancellationToken, WaitForCancellationFutureOwned};

const CHUNK_BYTES: u32 = 32 * 1024;
const MAX_CHUNK_BYTES: u32 = 261_120;
const READ_WINDOW_BYTES: u64 = crate::ssh::CHANNEL_WINDOW_SIZE as u64;
const WRITE_WINDOW_BYTES: u64 = 4 * 1024 * 1024;
const MAX_REQUESTS: usize = 1024;
const LOCAL_BUFFER_BYTES: usize = 256 * 1024;
const PROGRESS_INTERVAL: Duration = Duration::from_millis(100);
const CLOSE_TIMEOUT: Duration = Duration::from_millis(500);
const CLEANUP_TIMEOUT: Duration = Duration::from_secs(1);
pub const CANCEL_ERROR: &str = "Transfer cancelled";

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

// RawSftpSession queues close behind pending writes. Wake blocked I/O when its
// owner drops, so exhausted SSH credit cannot keep the subsystem tasks alive.
struct TransferStream<S> {
    inner: S,
    stopped: Pin<Box<WaitForCancellationFutureOwned>>,
}

impl<S: AsyncRead + Unpin> AsyncRead for TransferStream<S> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        if self.stopped.as_mut().poll(cx).is_ready() {
            // EOF makes the library's background reader exit rather than retry.
            return Poll::Ready(Ok(()));
        }
        Pin::new(&mut self.inner).poll_read(cx, buf)
    }
}

impl<S: AsyncWrite + Unpin> AsyncWrite for TransferStream<S> {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        if self.stopped.as_mut().poll(cx).is_ready() {
            return Poll::Ready(Err(io::ErrorKind::ConnectionAborted.into()));
        }
        Pin::new(&mut self.inner).poll_write(cx, buf)
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        if self.stopped.as_mut().poll(cx).is_ready() {
            return Poll::Ready(Err(io::ErrorKind::ConnectionAborted.into()));
        }
        Pin::new(&mut self.inner).poll_flush(cx)
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        if self.stopped.as_mut().poll(cx).is_ready() {
            return Poll::Ready(Err(io::ErrorKind::ConnectionAborted.into()));
        }
        Pin::new(&mut self.inner).poll_shutdown(cx)
    }
}

/// Owns only the dedicated subsystem, including during failed setup/cleanup.
struct TransferSession {
    raw: Arc<RawSftpSession>,
    stop: CancellationToken,
    read_len: u32,
    write_len: u32,
    packet_len: u64,
    fsync: bool,
}

impl Drop for TransferSession {
    fn drop(&mut self) {
        let _ = self.raw.close_session();
        self.stop.cancel();
    }
}

impl TransferSession {
    async fn new(
        stream: impl AsyncRead + AsyncWrite + Unpin + Send + 'static,
        cancel: &CancellationToken,
    ) -> Result<Self> {
        let config = Config {
            request_timeout_secs: 120,
            ..Default::default()
        };
        let stop = CancellationToken::new();
        let stream = TransferStream {
            inner: stream,
            stopped: Box::pin(stop.clone().cancelled_owned()),
        };
        let mut session = Self {
            raw: Arc::new(RawSftpSession::new_with_config(stream, config)),
            stop,
            read_len: CHUNK_BYTES,
            write_len: CHUNK_BYTES,
            packet_len: 262_144,
            fsync: false,
        };
        let version = interrupt(cancel, session.raw.init()).await??;
        let has_extension = |name: &str| version.extensions.get(name).is_some_and(|v| v == "1");
        session.fsync = has_extension("fsync@openssh.com");
        if has_extension("limits@openssh.com") {
            let limits = interrupt(cancel, session.raw.limits()).await??;
            let negotiated_len = |len: u64| {
                if len == 0 {
                    CHUNK_BYTES
                } else {
                    len.min(u64::from(MAX_CHUNK_BYTES)) as u32
                }
            };
            session.read_len = negotiated_len(limits.max_read_len);
            session.write_len = negotiated_len(limits.max_write_len);
            if limits.max_packet_len > 0 {
                session.packet_len = session.packet_len.min(limits.max_packet_len);
            }
            // No pipeline has cloned the raw session yet.
            Arc::get_mut(&mut session.raw)
                .unwrap()
                .set_limits(limits.into());
        }
        Ok(session)
    }

    fn request_len(&self, handle: &str, upload: bool) -> Result<u32> {
        // Include the length prefix. A READ request has the same fixed fields
        // as WRITE except its payload, while DATA replies have 13 bytes overhead.
        let request_overhead = 25 + handle.len() as u64;
        if self.packet_len <= request_overhead {
            return Err(anyhow!("SFTP packet limit cannot fit the file handle"));
        }
        let (len, overhead) = if upload {
            (self.write_len, request_overhead)
        } else {
            (self.read_len, 13)
        };
        Ok(u64::from(len).min(self.packet_len - overhead) as u32)
    }

    async fn close(
        &self,
        handle: &str,
        result: Result<u64>,
        cancel: &CancellationToken,
    ) -> Result<u64> {
        let result = match result {
            Ok(bytes) => interrupt(cancel, self.raw.close(handle))
                .await
                .and_then(|r| r.map(|_| bytes).map_err(Into::into)),
            Err(error) => Err(error),
        };
        if result.is_err() {
            let _ = tokio::time::timeout(CLOSE_TIMEOUT, self.raw.close(handle)).await;
        }
        result
    }
}

fn pipeline_depth(len: u32, upload: bool, total: Option<u64>) -> usize {
    let (budget, minimum) = if upload {
        (WRITE_WINDOW_BYTES, 16)
    } else {
        (READ_WINDOW_BYTES, 64)
    };
    let depth = (budget / u64::from(len)).clamp(minimum, MAX_REQUESTS as u64) as usize;
    // Avoid issuing a full window past EOF on small files. Size is only a hint:
    // one probe beyond it preserves reads until actual EOF, including size=0.
    total.map_or(depth, |n| {
        depth.min(
            n.div_ceil(u64::from(len))
                .saturating_add(1)
                .min(MAX_REQUESTS as u64) as usize,
        )
    })
}

// Sliding READ/WRITE futures are adapted from upstream. Short replies are
// repaired in place so pending offsets and the single-stream budget stay valid.
async fn pipelined_read(
    raw: Arc<RawSftpSession>,
    handle: String,
    range: u64,
    offset: u64,
    len: u32,
) -> (u64, u64, u32, Result<Option<Vec<u8>>>) {
    let result = match raw.read(handle, offset, len).await {
        Ok(data) if data.data.len() <= len as usize => Ok(Some(data.data)),
        Ok(_) => Err(anyhow!("SFTP response exceeds the requested read length")),
        Err(russh_sftp::client::error::Error::Status(status))
            if status.status_code == StatusCode::Eof =>
        {
            Ok(None)
        }
        Err(e) => Err(e.into()),
    };
    (range, offset, len, result)
}

#[derive(Default)]
struct ReadRange {
    data: Vec<u8>,
    complete: bool,
    error: Option<anyhow::Error>,
}

async fn pipelined_write(
    raw: Arc<RawSftpSession>,
    handle: String,
    offset: u64,
    data: Vec<u8>,
) -> Result<u64> {
    let len = data.len() as u64;
    raw.write(handle, offset, data).await?;
    Ok(len)
}

async fn download_via_raw<W: AsyncWrite + Unpin>(
    session: &TransferSession,
    handle: &str,
    writer: &mut W,
    reporter: &mut Reporter<'_>,
    cancel: &CancellationToken,
) -> Result<u64> {
    let read_len = session.request_len(handle, false)?;
    let depth = pipeline_depth(read_len, false, reporter.total);
    let mut transferred = 0;
    let mut next_offset = 0;
    let mut eof = None;
    let mut ranges: BTreeMap<u64, ReadRange> = BTreeMap::new();
    let mut inflight = FuturesUnordered::new();
    loop {
        if cancel.is_cancelled() {
            return Err(anyhow!(CANCEL_ERROR));
        }
        // Completed replies still own a slot until written. Each range holds
        // at most read_len bytes across its buffer and its one pending request.
        while eof.is_none() && ranges.len() < depth {
            ranges.insert(next_offset, ReadRange::default());
            inflight.push(pipelined_read(
                Arc::clone(&session.raw),
                handle.to_owned(),
                next_offset,
                next_offset,
                read_len,
            ));
            next_offset += u64::from(read_len);
        }
        let Some((start, offset, requested, result)) = interrupt(cancel, inflight.next()).await?
        else {
            return Err(anyhow!("SFTP read pipeline ended before EOF"));
        };
        let range = ranges.get_mut(&start).unwrap();
        match result {
            Ok(Some(data)) if !data.is_empty() => {
                let len = data.len() as u32;
                range.data.extend_from_slice(&data);
                range.complete = len == requested;
                if !range.complete {
                    // Repair every range independently, including replies that
                    // arrive before the first range. This avoids a serial RTT
                    // per short reply without discarding pending offsets.
                    inflight.push(pipelined_read(
                        Arc::clone(&session.raw),
                        handle.to_owned(),
                        start,
                        offset + u64::from(len),
                        requested - len,
                    ));
                }
            }
            Ok(_) => {
                eof = Some(eof.map_or(offset, |end: u64| end.min(offset)));
                range.complete = true;
            }
            Err(error) => {
                // Consume errors in file order, so speculative requests past
                // an earlier EOF cannot turn a completed download into failure.
                range.error = Some(error);
                range.complete = true;
            }
        }
        while let Some(mut first) = ranges.first_entry() {
            let range = first.get_mut();
            if !range.data.is_empty() {
                let data = std::mem::take(&mut range.data);
                interrupt(cancel, writer.write_all(&data)).await??;
                transferred += data.len() as u64;
                reporter.update(transferred, Instant::now());
            }
            if eof.is_some_and(|end| transferred >= end) {
                break;
            }
            if let Some(error) = range.error.take() {
                return Err(error);
            }
            if !range.complete {
                break;
            }
            first.remove();
        }
        if eof.is_some_and(|end| transferred >= end) {
            break;
        }
    }
    interrupt(cancel, writer.flush()).await??;
    Ok(transferred)
}

async fn read_fill<R: AsyncRead + Unpin>(reader: &mut R, buf: &mut [u8]) -> std::io::Result<usize> {
    let mut filled = 0;
    while filled < buf.len() {
        let n = reader.read(&mut buf[filled..]).await?;
        if n == 0 {
            break;
        }
        filled += n;
    }
    Ok(filled)
}

async fn upload_via_raw<R: AsyncRead + Unpin>(
    session: &TransferSession,
    handle: &str,
    reader: &mut R,
    reporter: &mut Reporter<'_>,
    cancel: &CancellationToken,
) -> Result<u64> {
    let write_len = session.request_len(handle, true)?;
    let depth = pipeline_depth(write_len, true, reporter.total);
    let mut buffer = vec![0; write_len as usize];
    let mut transferred = 0;
    let mut next_offset = 0;
    let mut inflight = FuturesOrdered::new();
    let mut eof = false;
    loop {
        if cancel.is_cancelled() {
            return Err(anyhow!(CANCEL_ERROR));
        }
        while !eof && inflight.len() < depth {
            let n = interrupt(cancel, read_fill(reader, &mut buffer)).await??;
            if n == 0 {
                eof = true;
                break;
            }
            inflight.push_back(pipelined_write(
                Arc::clone(&session.raw),
                handle.to_owned(),
                next_offset,
                buffer[..n].to_vec(),
            ));
            next_offset += n as u64;
        }
        let Some(result) = interrupt(cancel, inflight.next()).await? else {
            break;
        };
        transferred += result?;
        reporter.update(transferred, Instant::now());
    }
    Ok(transferred)
}

async fn download_cancellable(
    session: &TransferSession,
    remote_path: &str,
    local_path: &str,
    progress: Option<&ProgressCallback>,
    cancel: &CancellationToken,
) -> Result<u64> {
    let handle = interrupt(
        cancel,
        session
            .raw
            .open(remote_path, OpenFlags::READ, FileAttributes::default()),
    )
    .await??
    .handle;
    let mut writer = None;
    let mut reporter = Reporter {
        callback: progress,
        total: None,
        last_report: Instant::now(),
    };
    let result = async {
        reporter.total = interrupt(cancel, session.raw.fstat(&handle))
            .await?
            .ok()
            .and_then(|m| m.attrs.size);
        reporter.last_report = Instant::now();
        reporter.send(0);
        // A missing source must not truncate an existing destination.
        let file = interrupt(cancel, tokio::fs::File::create(local_path)).await??;
        writer = Some(tokio::io::BufWriter::with_capacity(
            LOCAL_BUFFER_BYTES,
            file,
        ));
        download_via_raw(
            session,
            &handle,
            writer.as_mut().unwrap(),
            &mut reporter,
            cancel,
        )
        .await
    }
    .await;
    let result = match result {
        Ok(bytes) => session.close(&handle, Ok(bytes), cancel).await,
        Err(error) => {
            let _ = tokio::time::timeout(CLEANUP_TIMEOUT, async {
                if let Some(writer) = &mut writer {
                    let _ = tokio::time::timeout(CLOSE_TIMEOUT, writer.flush()).await;
                }
                let _ = session
                    .close(&handle, Err(anyhow!(CANCEL_ERROR)), cancel)
                    .await;
            })
            .await;
            Err(error)
        }
    };
    let bytes = result?;
    reporter.send(bytes);
    Ok(bytes)
}

async fn upload_cancellable(
    session: &TransferSession,
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
    let handle = interrupt(
        cancel,
        session.raw.open(
            remote_path,
            OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE,
            FileAttributes::default(),
        ),
    )
    .await??
    .handle;
    let mut reporter = Reporter::new(progress, total);
    let result = async {
        let bytes = upload_via_raw(session, &handle, &mut local, &mut reporter, cancel).await?;
        if session.fsync {
            interrupt(cancel, session.raw.fsync(&handle)).await??;
        }
        Ok(bytes)
    }
    .await;
    let bytes = session.close(&handle, result, cancel).await?;
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
    let sftp = TransferSession::new(channel.into_stream(), cancel).await?;
    if upload {
        upload_cancellable(&sftp, local_path, remote_path, progress, cancel).await
    } else {
        download_cancellable(&sftp, remote_path, local_path, progress, cancel).await
    }
}

#[cfg(test)]
mod tests;
