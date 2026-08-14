use crate::pty_session::PtySession;
use crate::shell_integration;
use anyhow::Result;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{Read, Write};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

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
    // When launched from a terminal (`pnpm tauri dev`), LANG is inherited and
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
    let (resize_tx, mut resize_rx) = mpsc::channel::<(u32, u32)>(16);
    let cancel = CancellationToken::new();

    // Input: frontend → local PTY
    let writer_input = writer.clone();
    let cancel_input = cancel.clone();
    tokio::spawn(async move {
        while let Some(data) = input_rx.recv().await {
            if cancel_input.is_cancelled() {
                break;
            }
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
    let reader = {
        let m = master
            .lock()
            .map_err(|e| anyhow::anyhow!("PTY lock poisoned: {}", e))?;
        m.try_clone_reader().map_err(|e| anyhow::anyhow!("{}", e))?
    };
    let reader = Arc::new(std::sync::Mutex::new(reader));

    let cancel_read = cancel.clone();
    tokio::spawn(async move {
        while !cancel_read.is_cancelled() {
            let reader = reader.clone();
            let read_result = tokio::task::spawn_blocking(move || {
                let mut reader = reader
                    .lock()
                    .map_err(|e| std::io::Error::other(e.to_string()))?;
                let mut buf = vec![0u8; 4096];
                match reader.read(&mut buf) {
                    Ok(0) => Ok(None),
                    Ok(n) => {
                        buf.truncate(n);
                        Ok(Some(buf))
                    }
                    Err(e) => Err(e),
                }
            })
            .await;

            match read_result {
                Ok(Ok(Some(data))) if !data.is_empty() => {
                    if output_tx.send(data).await.is_err() {
                        break;
                    }
                }
                Ok(Ok(None)) => break,
                Ok(Ok(Some(_))) => {}
                Ok(Err(e)) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    tokio::time::sleep(Duration::from_millis(1)).await;
                }
                Ok(Err(_)) | Err(_) => break,
            }
        }
    });

    // Resize + cancellation
    let master_resize = master.clone();
    let child_kill = child.clone();
    let cancel_resize = cancel.clone();
    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = cancel_resize.cancelled() => {
                    if let Ok(mut c) = child_kill.lock() {
                        let _ = c.kill();
                    }
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
        output_rx: Arc::new(tokio::sync::Mutex::new(output_rx)),
        resize_tx,
        cancel,
        _shell_integration_dir: shell_integration.map(|integration| integration.temp_dir),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

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
        let session = create_local_pty_session(80, 24).expect("failed to create local PTY");

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
        let session = create_local_pty_session_with_shell(shell.to_string(), 80, 24)
            .expect("failed to create integrated local PTY");

        let initial = collect_until(&session, "\x1b]633;P;Cwd=", Duration::from_secs(5)).await;
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
        let output = collect_until(&session, &expected, Duration::from_secs(5)).await;
        assert!(
            output.contains(&expected),
            "expected cwd report {expected:?} from {shell}, got: {output:?}"
        );

        session
            .input_tx
            .send(b"cd -- '/definitely/missing/skd-cwd-test'\n".to_vec())
            .await
            .expect("failed to send failing cd command");
        let failed_cd_output = collect_until(&session, &expected, Duration::from_secs(5)).await;
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
        let session = create_local_pty_session_with_shell(shell.to_string(), 80, 24)
            .expect("failed to create integrated local PTY");

        let initial = collect_until(&session, "\x1b]633;P;Cwd=", Duration::from_secs(5)).await;
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
        let mut output = collect_until(&session, started, Duration::from_secs(5)).await;
        assert!(
            output.contains(started),
            "expected command-start OSC 633;C from {shell}, got: {output:?}"
        );

        if !output.contains("\x1b]633;D") && !output.contains("\x1b]633;A\x07") {
            output.push_str(&collect_until(&session, "\x1b]633;D", Duration::from_secs(5)).await);
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
}
