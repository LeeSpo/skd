use crate::pty_session::PtySession;
use anyhow::Result;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{Read, Write};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

/// Resolve the user's default shell, with platform-specific fallbacks.
pub fn default_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| {
        if cfg!(target_os = "windows") {
            "powershell.exe".to_string()
        } else if cfg!(target_os = "macos") {
            "/bin/zsh".to_string()
        } else {
            "/bin/bash".to_string()
        }
    })
}

/// Spawn a local interactive shell in a PTY and return a session handle
/// compatible with the existing WebSocket PTY pipeline.
pub fn create_local_pty_session(cols: u32, rows: u32) -> Result<PtySession> {
    let pty_system = native_pty_system();
    let pair = pty_system.openpty(PtySize {
        rows: rows as u16,
        cols: cols as u16,
        pixel_width: 0,
        pixel_height: 0,
    })?;

    let shell = default_shell();
    let mut cmd = CommandBuilder::new(&shell);

    // Login shell so GUI-launched apps still load the user's profile (macOS apps
    // often lack a full shell environment compared to Terminal.app).
    if !cfg!(target_os = "windows") {
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
        cmd.env("PATH", "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin");
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    let child = pair.slave.spawn_command(cmd)?;
    drop(pair.slave);

    let master = Arc::new(std::sync::Mutex::new(pair.master));
    let child = Arc::new(std::sync::Mutex::new(child));
    let writer = {
        let master = master.lock().map_err(|e| anyhow::anyhow!("PTY lock poisoned: {}", e))?;
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
    let master_read = master.clone();
    let cancel_read = cancel.clone();
    tokio::spawn(async move {
        while !cancel_read.is_cancelled() {
            let master_read = master_read.clone();
            let read_result = tokio::task::spawn_blocking(move || {
                let master = master_read
                    .lock()
                    .map_err(|e| std::io::Error::other(e.to_string()))?;
                let mut reader = master.try_clone_reader().map_err(std::io::Error::other)?;
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
    })
}

#[cfg(test)]
mod tests {
    use super::*;

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
}