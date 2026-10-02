use super::*;
use std::io;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll};
use tokio::io::ReadBuf;

#[derive(Default)]
struct Counts {
    read: usize,
    written: usize,
    max_read: usize,
}

struct GeneratedReader {
    total: usize,
    limit: usize,
    fail_after: Option<usize>,
    counts: Arc<Mutex<Counts>>,
}

impl AsyncRead for GeneratedReader {
    fn poll_read(
        self: Pin<&mut Self>,
        _: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let mut counts = self.counts.lock().unwrap();
        if self.fail_after.is_some_and(|limit| counts.read >= limit) {
            return Poll::Ready(Err(io::Error::other("read failed")));
        }
        let n = (self.total - counts.read)
            .min(self.limit)
            .min(buf.remaining());
        buf.initialize_unfilled()[..n].fill(0xa5);
        buf.advance(n);
        counts.read += n;
        counts.max_read = counts.max_read.max(n);
        assert!(
            counts.read - counts.written <= BUFFER_BYTES,
            "whole file was buffered"
        );
        Poll::Ready(Ok(()))
    }
}

struct CountingWriter {
    limit: usize,
    fail_after: Option<usize>,
    fail_flush: bool,
    counts: Arc<Mutex<Counts>>,
}

impl AsyncWrite for CountingWriter {
    fn poll_write(
        self: Pin<&mut Self>,
        _: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        let mut counts = self.counts.lock().unwrap();
        if self.fail_after.is_some_and(|limit| counts.written >= limit) {
            return Poll::Ready(Err(io::Error::other("write failed")));
        }
        let n = buf.len().min(self.limit);
        assert!(buf[..n].iter().all(|byte| *byte == 0xa5));
        counts.written += n;
        Poll::Ready(Ok(n))
    }
    fn poll_flush(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<io::Result<()>> {
        Poll::Ready(if self.fail_flush {
            Err(io::Error::other("flush failed"))
        } else {
            Ok(())
        })
    }
    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        self.poll_flush(cx)
    }
}

fn streams(total: usize, short: bool) -> (GeneratedReader, CountingWriter, Arc<Mutex<Counts>>) {
    let counts = Arc::new(Mutex::new(Counts::default()));
    (
        GeneratedReader {
            total,
            limit: if short { 333 } else { usize::MAX },
            fail_after: None,
            counts: counts.clone(),
        },
        CountingWriter {
            limit: if short { 17 } else { usize::MAX },
            fail_after: None,
            fail_flush: false,
            counts: counts.clone(),
        },
        counts,
    )
}

#[tokio::test]
async fn large_generated_file_is_written_before_eof_with_bounded_memory() {
    let total = 64 * 1024 * 1024 + 7;
    let (mut reader, mut writer, counts) = streams(total, false);
    assert_eq!(
        copy_stream(
            &mut reader,
            &mut writer,
            &mut Reporter::new(None, Some(total as u64))
        )
        .await
        .unwrap(),
        total as u64
    );
    let counts = counts.lock().unwrap();
    assert_eq!(counts.written, total);
    assert_eq!(counts.max_read, BUFFER_BYTES);
}

#[tokio::test]
async fn empty_and_short_reads_and_writes_are_supported() {
    for total in [0, 1, BUFFER_BYTES * 3 + 13] {
        let (mut reader, mut writer, counts) = streams(total, true);
        assert_eq!(
            copy_stream(&mut reader, &mut writer, &mut Reporter::new(None, None))
                .await
                .unwrap(),
            total as u64
        );
        assert_eq!(counts.lock().unwrap().written, total);
    }
}

#[tokio::test]
async fn copy_propagates_read_write_and_flush_errors() {
    for fault in ["read", "write", "flush"] {
        let (mut reader, mut writer, _) = streams(BUFFER_BYTES * 4, false);
        match fault {
            "read" => reader.fail_after = Some(BUFFER_BYTES),
            "write" => writer.fail_after = Some(BUFFER_BYTES),
            _ => writer.fail_flush = true,
        }
        let error = copy_stream(&mut reader, &mut writer, &mut Reporter::new(None, None))
            .await
            .unwrap_err();
        assert!(error.to_string().contains(fault));
    }
}

#[test]
fn reports_initial_throttled_and_final_snapshots_with_unknown_size() {
    let events = Arc::new(Mutex::new(Vec::new()));
    let captured = events.clone();
    let callback = move |event| captured.lock().unwrap().push(event);
    let mut reporter = Reporter::new(Some(&callback), None);
    let start = reporter.last_report;
    reporter.update(10, start + Duration::from_millis(99));
    reporter.update(20, start + Duration::from_millis(100));
    reporter.update(30, start + Duration::from_millis(199));
    reporter.update(40, start + Duration::from_millis(200));
    reporter.send(45);
    let events = events.lock().unwrap();
    assert_eq!(
        events
            .iter()
            .map(|event| event.bytes_transferred)
            .collect::<Vec<_>>(),
        vec![0, 20, 40, 45]
    );
    assert!(events.iter().all(|event| event.total_bytes.is_none()));
}

// Real SFTP packets over a bounded in-memory transport, without SSH credentials.
use russh_sftp::protocol::{Attrs, Data, FileAttributes, Handle, OpenFlags, Status, StatusCode};
use russh_sftp::server::Handler;

#[derive(Default)]
struct Fixture {
    data: Vec<u8>,
    closed: usize,
    unknown_size: bool,
    fail_read: bool,
    fail_write: bool,
    fail_close: bool,
}

struct Server(Arc<Mutex<Fixture>>);

fn ok_status(id: u32) -> Status {
    Status {
        id,
        status_code: StatusCode::Ok,
        error_message: String::new(),
        language_tag: String::new(),
    }
}

impl Handler for Server {
    type Error = StatusCode;
    fn unimplemented(&self) -> StatusCode {
        StatusCode::OpUnsupported
    }
    async fn open(
        &mut self,
        id: u32,
        filename: String,
        flags: OpenFlags,
        _: FileAttributes,
    ) -> Result<Handle, StatusCode> {
        if filename == "missing" {
            return Err(StatusCode::NoSuchFile);
        }
        if flags.contains(OpenFlags::TRUNCATE) {
            self.0.lock().unwrap().data.clear();
        }
        Ok(Handle {
            id,
            handle: "file".to_string(),
        })
    }
    async fn fstat(&mut self, id: u32, _: String) -> Result<Attrs, StatusCode> {
        let state = self.0.lock().unwrap();
        if state.unknown_size {
            return Err(StatusCode::OpUnsupported);
        }
        let mut attrs = FileAttributes::empty();
        attrs.size = Some(state.data.len() as u64);
        Ok(Attrs { id, attrs })
    }
    async fn read(
        &mut self,
        id: u32,
        _: String,
        offset: u64,
        len: u32,
    ) -> Result<Data, StatusCode> {
        let state = self.0.lock().unwrap();
        let start = offset as usize;
        if state.fail_read && start >= 16 * 1024 {
            return Err(StatusCode::PermissionDenied);
        }
        if start >= state.data.len() {
            return Err(StatusCode::Eof);
        }
        let end = (start + len.min(16 * 1024) as usize).min(state.data.len());
        Ok(Data {
            id,
            data: state.data[start..end].to_vec(),
        })
    }
    async fn write(
        &mut self,
        id: u32,
        _: String,
        offset: u64,
        data: Vec<u8>,
    ) -> Result<Status, StatusCode> {
        let mut state = self.0.lock().unwrap();
        if state.fail_write {
            return Err(StatusCode::PermissionDenied);
        }
        let start = offset as usize;
        state.data.resize(start + data.len(), 0);
        state.data[start..].copy_from_slice(&data);
        Ok(ok_status(id))
    }
    async fn close(&mut self, id: u32, _: String) -> Result<Status, StatusCode> {
        let mut state = self.0.lock().unwrap();
        state.closed += 1;
        if state.fail_close {
            Err(StatusCode::Failure)
        } else {
            Ok(ok_status(id))
        }
    }
}

async fn session(state: Arc<Mutex<Fixture>>) -> SftpSession {
    let (client, server) = tokio::io::duplex(BUFFER_BYTES);
    tokio::spawn(russh_sftp::server::run(server, Server(state)));
    SftpSession::new(client).await.unwrap()
}

#[tokio::test]
async fn protocol_round_trip_empty_and_multiblock_without_progress_is_compatible() {
    for total in [0, BUFFER_BYTES * 3 + 11] {
        let fixture = Arc::new(Mutex::new(Fixture::default()));
        let sftp = session(fixture.clone()).await;
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("source");
        let dest = dir.path().join("target");
        let data: Vec<u8> = (0..total).map(|n| (n % 251) as u8).collect();
        tokio::fs::write(&src, &data).await.unwrap();
        assert_eq!(
            upload(&sftp, src.to_str().unwrap(), "target", None)
                .await
                .unwrap(),
            total as u64
        );
        assert_eq!(
            download(&sftp, "target", dest.to_str().unwrap(), None)
                .await
                .unwrap(),
            total as u64
        );
        assert_eq!(tokio::fs::read(&dest).await.unwrap(), data);
        assert_eq!(fixture.lock().unwrap().closed, 2);
        sftp.close().await.unwrap();
    }
}

#[tokio::test]
async fn protocol_unknown_metadata_does_not_block_transfer_and_final_is_exact() {
    let fixture = Arc::new(Mutex::new(Fixture {
        data: vec![42; BUFFER_BYTES + 1],
        unknown_size: true,
        ..Fixture::default()
    }));
    let sftp = session(fixture.clone()).await;
    let dest = tempfile::NamedTempFile::new().unwrap();
    let events = Arc::new(Mutex::new(Vec::new()));
    let captured = events.clone();
    let callback = move |event| captured.lock().unwrap().push(event);
    let bytes = download(
        &sftp,
        "file",
        dest.path().to_str().unwrap(),
        Some(&callback),
    )
    .await
    .unwrap();
    assert_eq!(bytes, BUFFER_BYTES as u64 + 1);
    let events = events.lock().unwrap();
    assert_eq!(events.first().unwrap().bytes_transferred, 0);
    assert_eq!(events.last().unwrap().bytes_transferred, bytes);
    assert!(events.iter().all(|event| event.total_bytes.is_none()));
    assert_eq!(fixture.lock().unwrap().closed, 1);
}

#[tokio::test]
async fn download_failure_leaves_partial_file_and_preserves_original_error() {
    let fixture = Arc::new(Mutex::new(Fixture {
        data: vec![42; BUFFER_BYTES],
        fail_read: true,
        fail_close: true,
        ..Fixture::default()
    }));
    let sftp = session(fixture.clone()).await;
    let dest = tempfile::NamedTempFile::new().unwrap();
    tokio::fs::write(dest.path(), b"old destination")
        .await
        .unwrap();
    let error = download(&sftp, "file", dest.path().to_str().unwrap(), None)
        .await
        .unwrap_err();
    assert!(error.to_string().contains("Permission denied"));
    assert_eq!(
        tokio::fs::read(dest.path()).await.unwrap(),
        vec![42; 16 * 1024]
    );
    assert!(fixture.lock().unwrap().closed >= 1);
}

#[tokio::test]
async fn missing_sources_do_not_truncate_destinations_and_local_errors_close_handles() {
    let fixture = Arc::new(Mutex::new(Fixture {
        data: b"existing remote".to_vec(),
        ..Fixture::default()
    }));
    let sftp = session(fixture.clone()).await;
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("target");
    tokio::fs::write(&dest, b"existing local").await.unwrap();
    assert!(download(&sftp, "missing", dest.to_str().unwrap(), None)
        .await
        .is_err());
    assert_eq!(tokio::fs::read(&dest).await.unwrap(), b"existing local");
    assert!(upload(
        &sftp,
        dir.path().join("missing").to_str().unwrap(),
        "file",
        None
    )
    .await
    .is_err());
    assert_eq!(fixture.lock().unwrap().data, b"existing remote");
    assert!(download(&sftp, "file", dir.path().to_str().unwrap(), None)
        .await
        .is_err());
    assert_eq!(fixture.lock().unwrap().closed, 1);
}

#[tokio::test]
async fn remote_write_and_close_failures_do_not_report_success() {
    for write_failure in [true, false] {
        let fixture = Arc::new(Mutex::new(Fixture {
            fail_write: write_failure,
            fail_close: !write_failure,
            ..Fixture::default()
        }));
        let sftp = session(fixture.clone()).await;
        let src = tempfile::NamedTempFile::new().unwrap();
        tokio::fs::write(src.path(), vec![42; BUFFER_BYTES])
            .await
            .unwrap();
        let events = Arc::new(Mutex::new(Vec::new()));
        let captured = events.clone();
        let observed_fixture = fixture.clone();
        let callback = move |event| {
            captured
                .lock()
                .unwrap()
                .push((event, observed_fixture.lock().unwrap().closed));
        };
        assert!(
            upload(&sftp, src.path().to_str().unwrap(), "file", Some(&callback))
                .await
                .is_err()
        );
        assert!(fixture.lock().unwrap().closed >= 1);
        // Intermediate snapshots are allowed; no final event follows failed close.
        assert!(events
            .lock()
            .unwrap()
            .iter()
            .all(|(_, closed)| *closed == 0));
    }
}
