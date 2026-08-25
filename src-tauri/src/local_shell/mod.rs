use crate::pty_session::PtySession;
use crate::shell_integration;
use anyhow::Result;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{ErrorKind, Read, Write};
use std::os::fd::{AsRawFd, BorrowedFd, OwnedFd};
use std::os::unix::net::UnixStream;
use std::sync::Arc;
use std::thread::JoinHandle;
use tokio::sync::{mpsc, oneshot};
use tokio_util::sync::CancellationToken;

const LOCAL_PTY_READ_BUFFER_BYTES: usize = 16 * 1024;

struct LocalPtyReader {
    quit_writer: UnixStream,
    finished: oneshot::Receiver<()>,
    join_handle: JoinHandle<()>,
}

impl LocalPtyReader {
    fn spawn(
        mut reader: Box<dyn Read + Send>,
        readiness_fd: OwnedFd,
        output_tx: mpsc::Sender<Vec<u8>>,
    ) -> Result<Self> {
        let (quit_reader, quit_writer) = UnixStream::pair()?;
        quit_writer.set_nonblocking(true)?;
        let (finished_tx, finished) = oneshot::channel();

        let join_handle = std::thread::Builder::new()
            .name("skd-local-pty-reader".to_string())
            .spawn(move || {
                let mut buffer = vec![0; LOCAL_PTY_READ_BUFFER_BYTES];

                loop {
                    let mut poll_fds = [
                        libc::pollfd {
                            fd: readiness_fd.as_raw_fd(),
                            events: libc::POLLIN,
                            revents: 0,
                        },
                        libc::pollfd {
                            fd: quit_reader.as_raw_fd(),
                            events: libc::POLLIN,
                            revents: 0,
                        },
                    ];

                    // SAFETY: both descriptors are owned by this thread and remain alive
                    // for the complete poll call; poll_fds points to a valid fixed array.
                    let poll_result = unsafe {
                        libc::poll(poll_fds.as_mut_ptr(), poll_fds.len() as libc::nfds_t, -1)
                    };

                    if poll_result < 0 {
                        let error = std::io::Error::last_os_error();
                        if error.kind() == ErrorKind::Interrupted {
                            continue;
                        }
                        tracing::warn!("Local PTY readiness wait failed: {error}");
                        break;
                    }

                    let quit_events = poll_fds[1].revents;
                    if quit_events & (libc::POLLIN | libc::POLLHUP | libc::POLLERR) != 0 {
                        break;
                    }

                    let pty_events = poll_fds[0].revents;
                    let mut delivered_data = false;
                    if pty_events & libc::POLLIN != 0 {
                        match reader.read(&mut buffer) {
                            Ok(0) => break,
                            Ok(size) => {
                                delivered_data = true;
                                if output_tx.blocking_send(buffer[..size].to_vec()).is_err() {
                                    break;
                                }
                            }
                            Err(error) if error.kind() == ErrorKind::Interrupted => continue,
                            Err(error) if error.kind() == ErrorKind::WouldBlock => {}
                            Err(error) => {
                                tracing::debug!("Local PTY reader stopped: {error}");
                                break;
                            }
                        }
                    }

                    if !delivered_data
                        && pty_events & (libc::POLLHUP | libc::POLLERR | libc::POLLNVAL) != 0
                    {
                        break;
                    }
                }

                let _ = finished_tx.send(());
            })?;

        Ok(Self {
            quit_writer,
            finished,
            join_handle,
        })
    }

    async fn supervise(
        self,
        session_cancel: CancellationToken,
        local_io_cancel: CancellationToken,
        child: Arc<std::sync::Mutex<Box<dyn portable_pty::Child + Send + Sync>>>,
        output_rx: Arc<tokio::sync::Mutex<mpsc::Receiver<Vec<u8>>>>,
    ) {
        let Self {
            mut quit_writer,
            mut finished,
            join_handle,
        } = self;

        let cancelled = tokio::select! {
            _ = session_cancel.cancelled() => true,
            _ = &mut finished => false,
        };

        // EOF/read failure and explicit close both stop the local implementation.
        // Keep session_cancel distinct so channel EOF remains observable upstream.
        local_io_cancel.cancel();

        if cancelled {
            match quit_writer.write(&[1]) {
                Ok(_) => {}
                Err(error) if error.kind() == ErrorKind::BrokenPipe => {}
                Err(error) => tracing::warn!("Failed to wake local PTY reader: {error}"),
            }
        }
        // A bounded channel can have the reader blocked in blocking_send.
        // Closing the receiver releases that backpressure during shutdown.
        output_rx.lock().await.close();
        drop(quit_writer);

        let join_result = tokio::task::spawn_blocking(move || {
            if let Ok(mut child) = child.lock() {
                let child_is_running = child.try_wait().map_or(true, |status| status.is_none());
                if child_is_running {
                    if let Err(error) = child.kill() {
                        tracing::warn!("Failed to stop local PTY child: {error}");
                    }
                }
            }
            join_handle.join()
        })
        .await;

        match join_result {
            Ok(Ok(())) => {}
            Ok(Err(_)) => tracing::warn!("Local PTY reader thread panicked"),
            Err(error) => tracing::warn!("Local PTY reader join task failed: {error}"),
        }
    }
}

/// Resolve the user's default shell on macOS.
pub fn default_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
}

/// Spawn a local interactive shell in a PTY and return a session handle
/// compatible with the existing WebSocket PTY pipeline.
pub fn create_local_pty_session(cols: u32, rows: u32) -> Result<PtySession> {
    create_local_pty_session_with_shell(default_shell(), cols, rows)
}

fn create_local_pty_session_with_shell(shell: String, cols: u32, rows: u32) -> Result<PtySession> {
    spawn_local_pty_session(shell, cols, rows, &[])
}

fn spawn_local_pty_session(
    shell: String,
    cols: u32,
    rows: u32,
    extra_env: &[(String, String)],
) -> Result<PtySession> {
    let pty_system = native_pty_system();
    let pair = pty_system.openpty(PtySize {
        rows: rows as u16,
        cols: cols as u16,
        pixel_width: 0,
        pixel_height: 0,
    })?;

    let mut cmd = CommandBuilder::new(&shell);
    let shell_integration = match shell_integration::prepare_local_shell(&shell) {
        Ok(integration) => integration,
        Err(error) => {
            tracing::warn!(
                "Local shell integration unavailable for {}: {}. Starting a normal login shell.",
                shell,
                error
            );
            None
        }
    };

    if let Some(integration) = shell_integration.as_ref() {
        cmd.args(&integration.args);
        for (name, value) in &integration.env {
            cmd.env(name, value);
        }
    } else {
        // Unsupported shells retain the original login-shell behavior and may
        // still report cwd through their own OSC integration.
        cmd.arg("-l");
    }

    if let Some(home) = dirs::home_dir() {
        cmd.cwd(home.clone());
        cmd.env("HOME", home.to_string_lossy().to_string());
    }
    if let Ok(user) = std::env::var("USER").or_else(|_| std::env::var("USERNAME")) {
        cmd.env("USER", user);
    }
    // GUI apps on macOS may inherit a minimal PATH — ensure standard locations.
    if std::env::var("PATH").is_err() {
        cmd.env(
            "PATH",
            "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
        );
    }

    // CRITICAL: GUI apps launched from Finder / Dock / Spotlight inherit a
    // minimal environment from launchd that does NOT include LANG or LC_*.
    // Without a UTF-8 locale, zsh's line editor (ZLE) treats multi-byte
    // characters (e.g. the ❯ in many prompts) as N separate 1-wide characters
    // instead of 1 character.  The resulting cursor-position mismatch causes
    // zsh-autosuggestions to write suggestion text at wrong offsets, producing
    // duplicated/swallowed characters (e.g. `cdcd …`, `grok` → `ok`).
    //
    // When launched from a terminal (`bun run tauri dev`), LANG is inherited and
    // everything works — this bug only manifests in production app bundles.
    if std::env::var("LANG").is_err() {
        let posix_locale = sys_locale::get_locale()
            .map(|l| {
                // sys-locale returns BCP-47 (e.g. "zh-CN"); convert to POSIX
                let base = l.replace('-', "_");
                if base.contains('.') {
                    base
                } else {
                    format!("{}.UTF-8", base)
                }
            })
            .unwrap_or_else(|| "en_US.UTF-8".to_string());
        cmd.env("LANG", &posix_locale);
    }
    // Safety net: even if LANG is set but LC_CTYPE is not, ensure character
    // width calculations use UTF-8.  macOS natively supports the bare
    // "UTF-8" value for LC_CTYPE (Terminal.app uses the same convention).
    if std::env::var("LC_CTYPE").is_err() {
        cmd.env("LC_CTYPE", "UTF-8");
    }

    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    for (name, value) in extra_env {
        cmd.env(name, value);
    }

    let child = pair.slave.spawn_command(cmd)?;
    drop(pair.slave);

    let master = Arc::new(std::sync::Mutex::new(pair.master));
    let child = Arc::new(std::sync::Mutex::new(child));
    let writer = {
        let master = master
            .lock()
            .map_err(|e| anyhow::anyhow!("PTY lock poisoned: {}", e))?;
        master.take_writer()?
    };
    let writer = Arc::new(std::sync::Mutex::new(writer));

    let (input_tx, mut input_rx) = mpsc::channel::<Vec<u8>>(1000);
    let (output_tx, output_rx) = mpsc::channel::<Vec<u8>>(128);
    let output_rx = Arc::new(tokio::sync::Mutex::new(output_rx));
    let (resize_tx, mut resize_rx) = mpsc::channel::<(u32, u32)>(16);
    let cancel = CancellationToken::new();
    let local_io_cancel = CancellationToken::new();

    // Input: frontend → local PTY
    let writer_input = writer.clone();
    let cancel_input = local_io_cancel.clone();
    tokio::spawn(async move {
        loop {
            let data = tokio::select! {
                _ = cancel_input.cancelled() => break,
                data = input_rx.recv() => match data {
                    Some(data) => data,
                    None => break,
                },
            };
            let writer_input = writer_input.clone();
            let write_result = tokio::task::spawn_blocking(move || {
                let mut w = writer_input
                    .lock()
                    .map_err(|e| std::io::Error::other(e.to_string()))?;
                w.write_all(&data)?;
                w.flush()
            })
            .await;

            if write_result.is_err() || write_result.unwrap().is_err() {
                break;
            }
        }
    });

    // Output: local PTY → frontend
    //
    // IMPORTANT: Obtain the reader *once* before entering the loop.
    // Previously `try_clone_reader()` was called on every iteration, which:
    //   1. Created and destroyed a dup()'d FD per read — the dup/close churn
    //      could fragment zsh escape sequences (especially autosuggestion
    //      redraws) across reads, confusing xterm.js's parser.
    //   2. Required holding the master Mutex during the blocking `read()`,
    //      which prevented `resize()` from executing until the next read
    //      returned. Stale dimensions caused zsh to miscalculate cursor
    //      positions for autosuggestion text.
    let (reader, readiness_fd) = {
        let m = master
            .lock()
            .map_err(|e| anyhow::anyhow!("PTY lock poisoned: {}", e))?;
        let reader = m.try_clone_reader().map_err(|e| anyhow::anyhow!("{}", e))?;
        let raw_fd = m.as_raw_fd().ok_or_else(|| {
            anyhow::anyhow!("Local PTY does not expose a readable file descriptor")
        })?;
        // SAFETY: the master PTY owns raw_fd while the lock is held. The duplicated
        // descriptor returned here has an independent owned lifetime.
        let readiness_fd = unsafe { BorrowedFd::borrow_raw(raw_fd) }.try_clone_to_owned()?;
        (reader, readiness_fd)
    };
    let local_reader = LocalPtyReader::spawn(reader, readiness_fd, output_tx)?;

    let cancel_reader = cancel.clone();
    let cancel_local_io = local_io_cancel.clone();
    let child_reader = child.clone();
    let output_rx_reader = output_rx.clone();
    tokio::spawn(local_reader.supervise(
        cancel_reader,
        cancel_local_io,
        child_reader,
        output_rx_reader,
    ));

    // Resize + cancellation
    let master_resize = master.clone();
    let cancel_resize = local_io_cancel;
    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = cancel_resize.cancelled() => {
                    break;
                }
                resize = resize_rx.recv() => {
                    match resize {
                        Some((cols, rows)) => {
                            let master_resize = master_resize.clone();
                            let _ = tokio::task::spawn_blocking(move || {
                                if let Ok(master) = master_resize.lock() {
                                    let _ = master.resize(PtySize {
                                        rows: rows as u16,
                                        cols: cols as u16,
                                        pixel_width: 0,
                                        pixel_height: 0,
                                    });
                                }
                            })
                            .await;
                        }
                        None => break,
                    }
                }
            }
        }
    });

    Ok(PtySession {
        input_tx,
        output_rx,
        resize_tx,
        cancel,
        _shell_integration_dir: shell_integration.map(|integration| integration.temp_dir),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::Duration;

    struct IsolatedPty {
        session: PtySession,
        histfile: PathBuf,
        _dir: tempfile::TempDir,
    }

    fn isolated_local_pty(shell: &str) -> IsolatedPty {
        let dir = tempfile::tempdir().expect("isolated hist dir");
        let histfile = dir.path().join(".zsh_history");
        std::fs::write(&histfile, "").expect("isolated histfile");
        let hist = histfile.to_string_lossy().to_string();
        let session = spawn_local_pty_session(
            shell.to_string(),
            80,
            24,
            &[
                ("HISTFILE".to_string(), hist.clone()),
                ("SKD_USER_HISTFILE".to_string(), hist),
            ],
        )
        .expect("failed to create isolated local PTY");
        IsolatedPty {
            session,
            histfile,
            _dir: dir,
        }
    }

    async fn collect_until(session: &PtySession, expected: &str, timeout: Duration) -> String {
        let deadline = tokio::time::Instant::now() + timeout;
        let mut output = String::new();
        while tokio::time::Instant::now() < deadline {
            let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
            let data = {
                let mut rx = session.output_rx.lock().await;
                tokio::time::timeout(remaining, rx.recv()).await
            };
            match data {
                Ok(Some(bytes)) => {
                    output.push_str(&String::from_utf8_lossy(&bytes));
                    if output.contains(expected) {
                        break;
                    }
                }
                _ => break,
            }
        }
        output
    }

    #[test]
    fn default_shell_returns_non_empty() {
        let shell = default_shell();
        assert!(!shell.is_empty());
    }

    #[tokio::test]
    async fn create_local_pty_session_produces_output() {
        let isolated = isolated_local_pty(&default_shell());
        let session = &isolated.session;

        // Give the shell a moment to start
        tokio::time::sleep(Duration::from_millis(200)).await;

        session
            .input_tx
            .send(b"echo LOCAL_PTY_TEST\n".to_vec())
            .await
            .expect("failed to send input");

        let mut output = String::new();
        let deadline = tokio::time::Instant::now() + Duration::from_secs(3);
        while tokio::time::Instant::now() < deadline {
            let data = {
                let mut rx = session.output_rx.lock().await;
                rx.recv().await
            };
            if let Some(bytes) = data {
                output.push_str(&String::from_utf8_lossy(&bytes));
                if output.contains("LOCAL_PTY_TEST") {
                    session.cancel.cancel();
                    return;
                }
            } else {
                break;
            }
        }

        session.cancel.cancel();
        panic!("expected shell to echo LOCAL_PTY_TEST, got: {output}");
    }

    #[tokio::test]
    async fn cancelling_local_pty_session_closes_output_channel() {
        let isolated = isolated_local_pty(&default_shell());
        let session = &isolated.session;

        session.cancel.cancel();
        let closed = tokio::time::timeout(Duration::from_secs(1), async {
            let mut output_rx = session.output_rx.lock().await;
            while output_rx.recv().await.is_some() {}
        })
        .await;

        assert!(
            closed.is_ok(),
            "local PTY reader did not exit after session cancellation"
        );
    }

    #[tokio::test]
    async fn local_pty_reader_recovers_from_output_backpressure() {
        const OUTPUT_BYTES: usize = 3 * 1024 * 1024;

        let isolated = isolated_local_pty(&default_shell());
        let session = &isolated.session;
        session
            .input_tx
            .send(format!("yes x | head -c {OUTPUT_BYTES}\n").into_bytes())
            .await
            .expect("failed to start bulk-output command");

        // Let the bounded output channel fill before consuming it. The reader
        // must resume once capacity becomes available instead of losing bytes.
        tokio::time::sleep(Duration::from_millis(100)).await;
        let received = tokio::time::timeout(Duration::from_secs(5), async {
            let mut received = 0;
            let mut output_rx = session.output_rx.lock().await;
            while received < OUTPUT_BYTES {
                let data = output_rx
                    .recv()
                    .await
                    .expect("local PTY output closed early");
                received += data.len();
            }
            received
        })
        .await
        .expect("local PTY reader stalled after bounded-channel backpressure");

        session.cancel.cancel();
        assert!(received >= OUTPUT_BYTES);
    }

    #[tokio::test]
    async fn cancelling_local_pty_reader_releases_output_backpressure() {
        const OUTPUT_BYTES: usize = 3 * 1024 * 1024;

        let isolated = isolated_local_pty(&default_shell());
        let session = &isolated.session;
        session
            .input_tx
            .send(format!("yes x | head -c {OUTPUT_BYTES}\n").into_bytes())
            .await
            .expect("failed to start bulk-output command");

        // The 128 × 16 KiB queue fills before this command completes, leaving
        // the reader blocked in blocking_send until cancellation closes it.
        tokio::time::sleep(Duration::from_millis(100)).await;
        session.cancel.cancel();

        let closed = tokio::time::timeout(Duration::from_secs(1), async {
            let mut output_rx = session.output_rx.lock().await;
            while output_rx.recv().await.is_some() {}
        })
        .await;

        assert!(
            closed.is_ok(),
            "local PTY reader remained blocked by a full output channel"
        );
    }

    #[tokio::test]
    async fn exiting_local_shell_closes_output_without_masking_eof() {
        let isolated = isolated_local_pty(&default_shell());
        let session = &isolated.session;
        session
            .input_tx
            .send(b"exit\n".to_vec())
            .await
            .expect("failed to exit local shell");

        tokio::time::timeout(Duration::from_secs(1), async {
            let mut output_rx = session.output_rx.lock().await;
            while output_rx.recv().await.is_some() {}
        })
        .await
        .expect("local shell exit did not close its output channel");

        assert!(
            !session.cancel.is_cancelled(),
            "natural EOF must remain distinguishable from an explicit session close"
        );
    }

    async fn assert_shell_reports_changed_cwd(shell: &str) {
        if !std::path::Path::new(shell).exists() {
            return;
        }
        let target = tempfile::Builder::new()
            .prefix("skd cwd 100%;项目.")
            .tempdir()
            .expect("failed to create cwd test directory");
        let target_path = target.path().to_string_lossy().to_string();
        let escaped_target = target_path.replace('\\', "\\\\").replace(';', "\\x3b");
        let expected = format!("\x1b]633;P;Cwd={escaped_target}\x07");
        let isolated = isolated_local_pty(shell);
        let session = &isolated.session;

        let initial = collect_until(session, "\x1b]633;P;Cwd=", Duration::from_secs(5)).await;
        assert!(
            initial.contains("\x1b]633;P;Cwd="),
            "expected initial cwd report from {shell}, got: {initial:?}"
        );

        let quoted = target_path.replace('\'', "'\\''");
        session
            .input_tx
            .send(format!("cd -- '{quoted}'\n").into_bytes())
            .await
            .expect("failed to send cd command");
        let output = collect_until(session, &expected, Duration::from_secs(5)).await;
        assert!(
            output.contains(&expected),
            "expected cwd report {expected:?} from {shell}, got: {output:?}"
        );

        session
            .input_tx
            .send(b"cd -- '/definitely/missing/skd-cwd-test'\n".to_vec())
            .await
            .expect("failed to send failing cd command");
        let failed_cd_output = collect_until(session, &expected, Duration::from_secs(5)).await;
        session.cancel.cancel();
        assert!(
            failed_cd_output.contains(&expected),
            "failed cd should keep the previous cwd in {shell}, got: {failed_cd_output:?}"
        );
    }

    #[tokio::test]
    async fn bash_shell_integration_reports_changed_cwd() {
        assert_shell_reports_changed_cwd("/bin/bash").await;
    }

    #[tokio::test]
    async fn zsh_shell_integration_reports_changed_cwd() {
        assert_shell_reports_changed_cwd("/bin/zsh").await;
    }

    async fn assert_shell_reports_command_lifecycle(shell: &str) {
        if !std::path::Path::new(shell).exists() {
            return;
        }
        let isolated = isolated_local_pty(shell);
        let session = &isolated.session;

        let initial = collect_until(session, "\x1b]633;P;Cwd=", Duration::from_secs(5)).await;
        assert!(
            initial.contains("\x1b]633;P;Cwd="),
            "expected initial cwd report from {shell}, got: {initial:?}"
        );

        session
            .input_tx
            .send(b"true\n".to_vec())
            .await
            .expect("failed to send true command");

        let started = "\x1b]633;C\x07";
        let mut output = collect_until(session, started, Duration::from_secs(5)).await;
        assert!(
            output.contains(started),
            "expected command-start OSC 633;C from {shell}, got: {output:?}"
        );

        if !output.contains("\x1b]633;D") && !output.contains("\x1b]633;A\x07") {
            output.push_str(&collect_until(session, "\x1b]633;D", Duration::from_secs(5)).await);
        }
        session.cancel.cancel();
        assert!(
            output.contains("\x1b]633;D") || output.contains("\x1b]633;A\x07"),
            "expected command-finish OSC 633;D or 633;A from {shell}, got: {output:?}"
        );
    }

    #[tokio::test]
    async fn bash_shell_integration_reports_command_lifecycle() {
        assert_shell_reports_command_lifecycle("/bin/bash").await;
    }

    #[tokio::test]
    async fn zsh_shell_integration_reports_command_lifecycle() {
        assert_shell_reports_command_lifecycle("/bin/zsh").await;
    }

    #[tokio::test]
    async fn zsh_pty_histfile_is_not_integration_dir() {
        if !std::path::Path::new("/bin/zsh").exists() {
            return;
        }
        let isolated = isolated_local_pty("/bin/zsh");
        let expected_histfile = isolated.histfile.to_string_lossy().to_string();
        let session = &isolated.session;
        let _ = collect_until(session, "\x1b]633;P;Cwd=", Duration::from_secs(5)).await;
        session
            .input_tx
            .send(b"print -r -- \"$HISTFILE\"\n".to_vec())
            .await
            .unwrap();
        let output = collect_until(session, ".zsh_history", Duration::from_secs(5)).await;
        session.cancel.cancel();
        assert!(
            output.contains(&expected_histfile),
            "expected HISTFILE {expected_histfile}, got: {output:?}"
        );
        assert!(
            !output.contains("skd-shell."),
            "HISTFILE must not be inside the integration temp dir, got: {output:?}"
        );
    }
}
