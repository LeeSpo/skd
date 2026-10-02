// Protocol/lifecycle tests adapted from upstream PR #168's gated SFTP fixture.
// Exercise the public queue with real SSH and SFTP packets over a duplex stream.
use super::*;
use russh_sftp::{
    protocol::{
        Attrs, Data, FileAttributes, Handle, OpenFlags, Packet, Status as SftpStatus, StatusCode,
        Version,
    },
    server::Handler,
};
use tokio::sync::Semaphore;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Phase {
    Channel,
    Subsystem,
    Init,
    Open,
    Metadata,
    Read,
    Write,
    Flush,
    Close,
}
struct Fixture {
    data: Mutex<HashMap<String, Vec<u8>>>,
    phase: Option<Phase>,
    after: usize,
    gated: Mutex<bool>,
    entered: Semaphore,
    release: Semaphore,
    opened: Mutex<Vec<String>>,
    reads: Mutex<usize>,
    writes: Mutex<usize>,
}
impl Fixture {
    fn new(phase: Option<Phase>, after: usize) -> Arc<Self> {
        Arc::new(Self {
            data: Mutex::new(HashMap::from([(
                "file".into(),
                (0..256 * 1024).map(|i| (i % 251) as u8).collect(),
            )])),
            phase,
            after,
            gated: Mutex::new(false),
            entered: Semaphore::new(0),
            release: Semaphore::new(0),
            opened: Mutex::new(vec![]),
            reads: Mutex::new(0),
            writes: Mutex::new(0),
        })
    }
    async fn gate(&self, phase: Phase, position: usize) {
        let block = {
            let mut gated = self.gated.lock().unwrap();
            if self.phase == Some(phase) && position >= self.after && !*gated {
                *gated = true;
                true
            } else {
                false
            }
        };
        if block {
            self.entered.add_permits(1);
            self.release.acquire().await.unwrap().forget();
        }
    }
    async fn parked(&self) {
        tokio::time::timeout(Duration::from_secs(5), self.entered.acquire())
            .await
            .unwrap()
            .unwrap()
            .forget();
    }
}
struct SftpServer(Arc<Fixture>);
fn ok(id: u32) -> SftpStatus {
    SftpStatus {
        id,
        status_code: StatusCode::Ok,
        error_message: String::new(),
        language_tag: String::new(),
    }
}
impl Handler for SftpServer {
    type Error = StatusCode;
    fn unimplemented(&self) -> StatusCode {
        StatusCode::OpUnsupported
    }
    async fn init(&mut self, _: u32, _: HashMap<String, String>) -> Result<Version, StatusCode> {
        self.0.gate(Phase::Init, 0).await;
        let mut version = Version::new();
        version
            .extensions
            .insert("fsync@openssh.com".into(), "1".into());
        Ok(version)
    }
    async fn open(
        &mut self,
        id: u32,
        filename: String,
        flags: OpenFlags,
        _: FileAttributes,
    ) -> Result<Handle, StatusCode> {
        self.0.gate(Phase::Open, 0).await;
        if filename == "missing" {
            return Err(StatusCode::NoSuchFile);
        }
        self.0.opened.lock().unwrap().push(filename.clone());
        if flags.contains(OpenFlags::TRUNCATE) {
            self.0.data.lock().unwrap().insert(filename.clone(), vec![]);
        }
        Ok(Handle {
            id,
            handle: filename,
        })
    }
    async fn fstat(&mut self, id: u32, name: String) -> Result<Attrs, StatusCode> {
        self.0.gate(Phase::Metadata, 0).await;
        let mut attrs = FileAttributes::empty();
        attrs.size = Some(self.0.data.lock().unwrap().get(&name).unwrap().len() as u64);
        Ok(Attrs { id, attrs })
    }
    async fn read(
        &mut self,
        id: u32,
        name: String,
        offset: u64,
        len: u32,
    ) -> Result<Data, StatusCode> {
        *self.0.reads.lock().unwrap() += 1;
        self.0.gate(Phase::Read, offset as usize).await;
        let data = self.0.data.lock().unwrap();
        let data = data.get(&name).unwrap();
        let start = offset as usize;
        if start >= data.len() {
            return Err(StatusCode::Eof);
        }
        Ok(Data {
            id,
            data: data[start..(start + len.min(16 * 1024) as usize).min(data.len())].to_vec(),
        })
    }
    async fn write(
        &mut self,
        id: u32,
        name: String,
        offset: u64,
        data: Vec<u8>,
    ) -> Result<SftpStatus, StatusCode> {
        *self.0.writes.lock().unwrap() += 1;
        self.0.gate(Phase::Write, offset as usize).await;
        let mut files = self.0.data.lock().unwrap();
        let file = files.entry(name).or_default();
        let start = offset as usize;
        file.resize(start + data.len(), 0);
        file[start..].copy_from_slice(&data);
        Ok(ok(id))
    }
    async fn close(&mut self, id: u32, _: String) -> Result<SftpStatus, StatusCode> {
        self.0.gate(Phase::Close, 0).await;
        Ok(ok(id))
    }
    async fn extended(
        &mut self,
        id: u32,
        request: String,
        _: Vec<u8>,
    ) -> Result<Packet, StatusCode> {
        if request == "fsync@openssh.com" {
            self.0.gate(Phase::Flush, 0).await;
            Ok(ok(id).into())
        } else {
            Err(StatusCode::OpUnsupported)
        }
    }
}
struct SshServer {
    fixture: Arc<Fixture>,
    channels: HashMap<russh::ChannelId, russh::Channel<russh::server::Msg>>,
}
impl russh::server::Handler for SshServer {
    type Error = anyhow::Error;
    async fn auth_none(&mut self, _: &str) -> Result<russh::server::Auth> {
        Ok(russh::server::Auth::Accept)
    }
    async fn channel_open_session(
        &mut self,
        channel: russh::Channel<russh::server::Msg>,
        reply: russh::server::ChannelOpenHandle,
        _: &mut russh::server::Session,
    ) -> Result<()> {
        self.fixture.gate(Phase::Channel, 0).await;
        self.channels.insert(channel.id(), channel);
        reply.accept().await;
        Ok(())
    }
    async fn subsystem_request(
        &mut self,
        id: russh::ChannelId,
        _: &str,
        session: &mut russh::server::Session,
    ) -> Result<()> {
        self.fixture.gate(Phase::Subsystem, 0).await;
        session.channel_success(id)?;
        let stream = self.channels.remove(&id).unwrap().into_stream();
        tokio::spawn(russh_sftp::server::run(
            stream,
            SftpServer(self.fixture.clone()),
        ));
        Ok(())
    }
}
async fn transport(fixture: Arc<Fixture>) -> Session {
    let (client, server) = tokio::io::duplex(64 * 1024);
    let mut config = russh::server::Config {
        auth_rejection_time: Duration::ZERO,
        ..Default::default()
    };
    config.keys.push(
        russh::keys::PrivateKey::random(
            &mut russh::keys::key::safe_rng(),
            russh::keys::Algorithm::Ed25519,
        )
        .unwrap(),
    );
    tokio::spawn(async move {
        let _ = russh::server::run_stream(
            Arc::new(config),
            server,
            SshServer {
                fixture,
                channels: HashMap::new(),
            },
        )
        .await;
    });
    let mut handle = russh::client::connect_stream(
        Arc::new(russh::client::Config::default()),
        client,
        crate::ssh::SshHandler::new("fixture".into(), 22, false, None),
    )
    .await
    .unwrap();
    assert!(handle.authenticate_none("test").await.unwrap().success());
    Arc::new(handle)
}
fn download(connection: &str, path: &std::path::Path) -> Input {
    Input::path(
        connection.into(),
        Direction::Download,
        path.to_string_lossy().into_owned(),
        "file".into(),
        Source::Browser,
    )
}
async fn outcome(ticket: Ticket) -> Outcome {
    tokio::time::timeout(Duration::from_secs(5), ticket.done)
        .await
        .unwrap()
        .unwrap()
}

#[tokio::test]
async fn cancels_every_protocol_wait_and_preserves_partial_files() {
    for phase in [
        Phase::Channel,
        Phase::Subsystem,
        Phase::Init,
        Phase::Open,
        Phase::Metadata,
        Phase::Read,
        Phase::Write,
        Phase::Flush,
        Phase::Close,
    ] {
        let fixture = Fixture::new(
            Some(phase),
            if phase == Phase::Read { 16 * 1024 } else { 0 },
        );
        let queue = Arc::new(TransferQueue::default());
        queue.bind("one".into(), transport(fixture.clone()).await);
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("target");
        let upload = matches!(phase, Phase::Write | Phase::Flush);
        if upload {
            tokio::fs::write(&target, vec![7; 2 * 1024 * 1024])
                .await
                .unwrap();
        }
        let input = if upload {
            Input::path(
                "one".into(),
                Direction::Upload,
                target.to_string_lossy().into(),
                "uploaded".into(),
                Source::Editor,
            )
        } else {
            download("one", &target)
        };
        let ticket = queue
            .enqueue(vec![input], Some("file-viewer-test".into()), None, None)
            .unwrap()
            .remove(0);
        fixture.parked().await;
        let reads = *fixture.reads.lock().unwrap();
        let writes = *fixture.writes.lock().unwrap();
        let start = std::time::Instant::now();
        assert!(queue.cancel(&ticket.id));
        assert_eq!(outcome(ticket).await.status, Status::Cancelled);
        assert!(
            start.elapsed() < Duration::from_secs(2),
            "cancel stalled at {phase:?}"
        );
        assert!(queue.state.lock().unwrap().jobs.is_empty());
        if phase == Phase::Read {
            assert_eq!(
                tokio::fs::read(&target).await.unwrap(),
                fixture.data.lock().unwrap()["file"][..16 * 1024]
            );
        }
        if matches!(
            phase,
            Phase::Channel | Phase::Subsystem | Phase::Init | Phase::Open | Phase::Metadata
        ) {
            assert!(!target.exists());
        }
        fixture.release.add_permits(1);
        tokio::time::sleep(Duration::from_millis(30)).await;
        assert_eq!(
            *fixture.reads.lock().unwrap(),
            reads,
            "new READ after cancellation"
        );
        if phase == Phase::Write {
            assert!(*fixture.writes.lock().unwrap() <= 8 && writes == 1);
        }
        queue.unbind("one");
    }
}

#[tokio::test]
async fn native_and_window_jobs_share_fifo_and_cancelled_cleanup_blocks_next() {
    let fixture = Fixture::new(Some(Phase::Read), 16 * 1024);
    let queue = Arc::new(TransferQueue::default());
    let session = transport(fixture.clone()).await;
    queue.bind("one".into(), session.clone());
    queue.bind("two".into(), session);
    let dir = tempfile::tempdir().unwrap();
    let mut first = download("one", &dir.path().join("first"));
    first.source = Source::Editor;
    let mut second = download("two", &dir.path().join("finder"));
    second.source = Source::Finder;
    let mut tickets = queue
        .enqueue(
            vec![first, second],
            Some("file-viewer-test".into()),
            None,
            None,
        )
        .unwrap();
    let first = tickets.remove(0);
    let second = tickets.remove(0);
    fixture.parked().await;
    assert_eq!(fixture.opened.lock().unwrap().len(), 1);
    queue.cancel_window("file-viewer-test");
    assert_eq!(queue.snapshot().items[0].status, Status::Cancelling);
    assert_eq!(queue.snapshot().items[1].status, Status::Queued);
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(fixture.opened.lock().unwrap().len(), 1);
    assert_eq!(outcome(first).await.status, Status::Cancelled);
    assert_eq!(outcome(second).await.status, Status::Completed);
    assert_eq!(
        tokio::fs::read(dir.path().join("finder")).await.unwrap(),
        fixture.data.lock().unwrap()["file"]
    );
    fixture.release.add_permits(1);
    queue.unbind("one");
    queue.unbind("two");
}

#[tokio::test]
async fn queued_cancel_retry_failure_and_clear_keep_completion_receipts() {
    let fixture = Fixture::new(Some(Phase::Read), 0);
    let queue = Arc::new(TransferQueue::default());
    queue.bind("one".into(), transport(fixture.clone()).await);
    let dir = tempfile::tempdir().unwrap();
    let tickets = queue
        .enqueue(
            vec![
                download("one", &dir.path().join("first")),
                download("one", &dir.path().join("never")),
            ],
            None,
            None,
            None,
        )
        .unwrap();
    let mut tickets = tickets.into_iter();
    let first = tickets.next().unwrap();
    let queued = tickets.next().unwrap();
    fixture.parked().await;
    assert!(queue.cancel(&queued.id));
    let old_id = queued.id.clone();
    let retry_id = queue.retry(&old_id, None).unwrap();
    assert_ne!(old_id, retry_id);
    queue.clear_completed();
    assert_eq!(outcome(queued).await.status, Status::Cancelled);
    assert!(!dir.path().join("never").exists());
    let mut missing = download("one", &dir.path().join("missing"));
    missing.source_path = "missing".into();
    let missing = queue
        .enqueue(vec![missing], None, None, None)
        .unwrap()
        .remove(0);
    let last = queue
        .enqueue(
            vec![download("one", &dir.path().join("last"))],
            None,
            None,
            None,
        )
        .unwrap()
        .remove(0);
    queue.cancel(&first.id);
    assert_eq!(outcome(first).await.status, Status::Cancelled);
    assert_eq!(outcome(missing).await.status, Status::Failed);
    assert_eq!(outcome(last).await.status, Status::Completed);
    assert!(queue
        .snapshot()
        .items
        .iter()
        .any(|i| i.input.id == retry_id && i.status == Status::Completed));
    assert!(queue.state.lock().unwrap().jobs.is_empty());
    fixture.release.add_permits(1);
    queue.unbind("one");
}

#[tokio::test]
async fn replacement_and_transport_death_cancel_old_generation_only() {
    let old = Fixture::new(Some(Phase::Read), 0);
    let queue = Arc::new(TransferQueue::default());
    let session = transport(old.clone()).await;
    queue.bind("one".into(), session.clone());
    let dir = tempfile::tempdir().unwrap();
    let mut tickets = queue
        .enqueue(
            vec![
                download("one", &dir.path().join("old")),
                download("one", &dir.path().join("queued")),
            ],
            None,
            None,
            None,
        )
        .unwrap();
    let first = tickets.remove(0);
    let second = tickets.remove(0);
    old.parked().await;
    queue.bind("one".into(), transport(Fixture::new(None, 0)).await);
    let fresh = queue
        .enqueue(
            vec![download("one", &dir.path().join("fresh"))],
            None,
            None,
            None,
        )
        .unwrap()
        .remove(0);
    assert_eq!(outcome(first).await.status, Status::Cancelled);
    assert_eq!(outcome(second).await.status, Status::Cancelled);
    assert_eq!(outcome(fresh).await.status, Status::Completed);
    assert!(!dir.path().join("queued").exists());
    old.release.add_permits(1);
    let death = Fixture::new(Some(Phase::Read), 0);
    let dying_session = transport(death.clone()).await;
    queue.bind("dying".into(), dying_session.clone());
    let dying = queue
        .enqueue(
            vec![download("dying", &dir.path().join("dying"))],
            None,
            None,
            None,
        )
        .unwrap()
        .remove(0);
    death.parked().await;
    dying_session
        .disconnect(russh::Disconnect::ByApplication, "test", "")
        .await
        .unwrap();
    assert_eq!(outcome(dying).await.status, Status::Cancelled);
    death.release.add_permits(1);
    queue.unbind("one");
}

#[tokio::test]
async fn closed_editor_windows_reject_late_submissions_and_old_monitors_cannot_cancel_replacements()
{
    let queue = Arc::new(TransferQueue::default());
    let old = transport(Fixture::new(None, 0)).await;
    queue.bind("one".into(), old.clone());
    queue.cancel_window("file-viewer-gone");
    let dir = tempfile::tempdir().unwrap();
    let mut editor = download("one", &dir.path().join("editor"));
    editor.source = Source::Editor;
    assert!(queue
        .enqueue(vec![editor], Some("file-viewer-gone".into()), None, None)
        .is_err());
    assert!(!dir.path().join("editor").exists());
    queue.bind("one".into(), transport(Fixture::new(None, 0)).await);
    queue.unbind_matching("one", Some(&old));
    let ticket = queue
        .enqueue(
            vec![download("one", &dir.path().join("fresh"))],
            None,
            None,
            None,
        )
        .unwrap()
        .remove(0);
    assert_eq!(outcome(ticket).await.status, Status::Completed);
    queue.unbind("one");
}

#[tokio::test]
async fn legacy_path_commands_work_without_ids_or_progress_and_do_not_hold_client_locks() {
    let manager = Arc::new(crate::connection_manager::ConnectionManager::new());
    let fixture = Fixture::new(None, 0);
    manager
        .transfers
        .bind("one".into(), transport(fixture.clone()).await);
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("legacy");
    let response = crate::commands::queued_path_transfer(
        "one".into(),
        target.to_string_lossy().into(),
        "file".into(),
        Direction::Download,
        None,
        &manager,
        None,
    )
    .await
    .unwrap();
    assert!(response.success);
    assert_eq!(response.bytes_transferred, Some(256 * 1024));
    assert_eq!(
        tokio::fs::read(&target).await.unwrap(),
        fixture.data.lock().unwrap()["file"]
    );
    let response = crate::commands::queued_path_transfer(
        "one".into(),
        target.to_string_lossy().into(),
        "uploaded".into(),
        Direction::Upload,
        None,
        &manager,
        None,
    )
    .await
    .unwrap();
    assert!(response.success);
    {
        let data = fixture.data.lock().unwrap();
        assert_eq!(data["file"], data["uploaded"]);
    }
    manager.transfers.unbind("one");
}
