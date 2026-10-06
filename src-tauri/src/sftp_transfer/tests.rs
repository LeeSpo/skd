use super::*;
use std::sync::{Arc, Mutex};

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
use russh_sftp::protocol::{
    Attrs, Data, FileAttributes, Handle, OpenFlags, Packet, Status, StatusCode, Version,
};
use russh_sftp::server::Handler;

#[derive(Default)]
struct Fixture {
    data: Vec<u8>,
    closed: usize,
    unknown_size: bool,
    fail_read: bool,
    fail_write: bool,
    fail_close: bool,
    fail_fsync: bool,
    limits: bool,
    size_hint: Option<u64>,
    writes: Vec<(u64, usize)>,
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
    async fn init(
        &mut self,
        _: u32,
        _: std::collections::HashMap<String, String>,
    ) -> Result<Version, StatusCode> {
        let mut version = Version::new();
        if self.0.lock().unwrap().limits {
            version
                .extensions
                .insert("limits@openssh.com".into(), "1".into());
            version
                .extensions
                .insert("fsync@openssh.com".into(), "1".into());
        }
        Ok(version)
    }
    async fn extended(
        &mut self,
        id: u32,
        request: String,
        _: Vec<u8>,
    ) -> Result<Packet, StatusCode> {
        match request.as_str() {
            "limits@openssh.com" => Ok(russh_sftp::protocol::ExtendedReply {
                id,
                data: [1024u64, 4096, 4096, 0]
                    .into_iter()
                    .flat_map(u64::to_be_bytes)
                    .collect(),
            }
            .into()),
            "fsync@openssh.com" if self.0.lock().unwrap().fail_fsync => {
                Err(StatusCode::PermissionDenied)
            }
            "fsync@openssh.com" => Ok(ok_status(id).into()),
            _ => Err(StatusCode::OpUnsupported),
        }
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
        attrs.size = Some(state.size_hint.unwrap_or(state.data.len() as u64));
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
        if state.limits {
            assert!(data.len() + 25 + "file".len() <= 1024);
        }
        state.writes.push((offset, data.len()));
        let start = offset as usize;
        let end = start + data.len();
        let size = state.data.len().max(end);
        state.data.resize(size, 0);
        state.data[start..end].copy_from_slice(&data);
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

#[tokio::test]
async fn negotiated_limits_zero_size_hint_and_fsync_failure_preserve_completion_semantics() {
    let fixture = Arc::new(Mutex::new(Fixture {
        limits: true,
        size_hint: Some(0),
        ..Fixture::default()
    }));
    let sftp = session(fixture.clone()).await;
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("source");
    let target = dir.path().join("target");
    let data: Vec<u8> = (0..65_537).map(|n| (n % 251) as u8).collect();
    tokio::fs::write(&source, &data).await.unwrap();
    assert_eq!(
        upload(&sftp, source.to_str().unwrap(), "file", None)
            .await
            .unwrap(),
        data.len() as u64
    );
    assert_eq!(
        download(&sftp, "file", target.to_str().unwrap(), None)
            .await
            .unwrap(),
        data.len() as u64
    );
    assert_eq!(tokio::fs::read(&target).await.unwrap(), data);
    let mut writes = fixture.lock().unwrap().writes.clone();
    writes.sort_unstable_by_key(|&(offset, _)| offset);
    assert!(writes.windows(2).all(|p| p[0].0 + p[0].1 as u64 == p[1].0));
    fixture.lock().unwrap().fail_fsync = true;
    fixture.lock().unwrap().fail_close = true;
    let error = upload(&sftp, source.to_str().unwrap(), "file", None)
        .await
        .unwrap_err();
    assert!(error.to_string().contains("Permission denied"));
}

async fn session(state: Arc<Mutex<Fixture>>) -> TransferSession {
    let (client, server) = tokio::io::duplex(64 * 1024);
    tokio::spawn(russh_sftp::server::run(server, Server(state)));
    TransferSession::new(client, &CancellationToken::new())
        .await
        .unwrap()
}

#[tokio::test]
async fn protocol_round_trip_empty_and_multiblock_without_progress_is_compatible() {
    for total in [0, 64 * 1024 * 3 + 11] {
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
        sftp.raw.close_session().unwrap();
    }
}

#[tokio::test]
async fn protocol_unknown_metadata_does_not_block_transfer_and_final_is_exact() {
    let fixture = Arc::new(Mutex::new(Fixture {
        data: vec![42; 64 * 1024 + 1],
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
    assert_eq!(bytes, 64 * 1024 + 1);
    let events = events.lock().unwrap();
    assert_eq!(events.first().unwrap().bytes_transferred, 0);
    assert_eq!(events.last().unwrap().bytes_transferred, bytes);
    assert!(events.iter().all(|event| event.total_bytes.is_none()));
    assert_eq!(fixture.lock().unwrap().closed, 1);
}

#[tokio::test]
async fn download_failure_leaves_partial_file_and_preserves_original_error() {
    let fixture = Arc::new(Mutex::new(Fixture {
        data: vec![42; 64 * 1024],
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
        tokio::fs::write(src.path(), vec![42; 64 * 1024])
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

async fn download(
    session: &TransferSession,
    remote: &str,
    local: &str,
    progress: Option<&ProgressCallback>,
) -> Result<u64> {
    download_cancellable(session, remote, local, progress, &CancellationToken::new()).await
}
async fn upload(
    session: &TransferSession,
    local: &str,
    remote: &str,
    progress: Option<&ProgressCallback>,
) -> Result<u64> {
    upload_cancellable(session, local, remote, progress, &CancellationToken::new()).await
}
