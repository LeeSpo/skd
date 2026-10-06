<p align="center">
  <img src="icon.png" width="96" alt="skd icon" />
</p>

<h1 align="center">skd</h1>

<p align="center">
  A lightweight macOS workspace for SSH terminals, local shells, and remote file work.
</p>

<p align="center">
  <a href="https://github.com/LeeSpo/skd/actions/workflows/ci.yml"><img src="https://github.com/LeeSpo/skd/actions/workflows/ci.yml/badge.svg" alt="CI status" /></a>
  <a href="https://github.com/LeeSpo/skd/releases/latest"><img src="https://img.shields.io/github/v/release/LeeSpo/skd?display_name=tag&sort=semver" alt="Latest release" /></a>
  <img src="https://img.shields.io/badge/platform-macOS-black?logo=apple" alt="macOS only" />
  <a href="LICENSE"><img src="https://img.shields.io/github/license/LeeSpo/skd" alt="MIT License" /></a>
</p>

> [!WARNING]
> skd is built for macOS only; it can connect to SSH hosts running any operating system. The application interface is currently English-only.

## Overview

skd brings interactive SSH sessions, local shells, SFTP file management, and saved connection profiles into a single desktop workspace. It is intended for people who regularly move between terminal work and remote files and prefer a lightweight native macOS application over a browser-based console.

![skd welcome workspace](docs/images/workspace-light.png#gh-light-mode-only)
![skd welcome workspace](docs/images/workspace-dark.png#gh-dark-mode-only)

## Highlights

- **Terminal workspace** — Run local shells and interactive SSH PTY sessions in tab groups. Split panes, move tabs between groups, search terminal output, and drag files or folders into a terminal with POSIX-safe path escaping.
- **SSH connections** — Connect with passwords, private keys, or keyboard-interactive authentication, with configurable keepalive and connection timeouts. Connections go directly to the target host.
- **Host-key verification** — Unknown SSH host keys are presented for an explicit trust decision and are saved in skd's own `known_hosts` store.
- **File work** — Browse local and remote directories side by side, transfer files or directories through a streaming transfer queue, move local files to native macOS Trash, rename and delete entries, and track progress. The file panel automatically follows supported shell working-directory updates (OSC 7).
- **Connection organization** — Keep non-secret connection profiles in a folder-based sidebar. Passwords, private-key content, and passphrases are stored through the macOS Keychain.
- **Port forwarding** — Create OpenSSH-style local forwards, save bookmarks, test remote targets, and see listener/target health.
- **Useful extras** — Edit supported remote text files with CodeMirror, choose terminal and application themes, and add optional remote system-monitor panels.
- **Compatibility** — Standalone SFTP is supported. FTP and FTPS remain available for compatibility, but they are not the primary focus of the project.

### Key shortcuts

| Shortcut | Action |
| --- | --- |
| `⌃B` (`Ctrl+B`) | Toggle connection manager sidebar when focus is outside terminal input and text fields |
| `⌃J` (`Ctrl+J`) | Toggle integrated file browser panel when focus is outside terminal input and text fields |
| `⌃M` (`Ctrl+M`) | Toggle remote system monitor panel when focus is outside terminal input and text fields |
| `⌃Z` (`Ctrl+Z`) | Toggle Zen mode (hide all sidebars and panels) when focus is outside terminal input and text fields |
| `⌃\` / `⌃⇧\` | Split terminal pane right / down when the terminal has focus |
| `⌘W` | Close active terminal tab or split pane |
| `⌥ Drag` | Option-drag text selection (bypasses mouse reporting in `htop`, `tmux`, etc.) |

With focus outside terminal input and text fields, `Ctrl+\` and `Ctrl+Shift+\` currently toggle the connection manager sidebar because that binding takes precedence over the split shortcuts.

## Download and install

Download the appropriate DMG from the [latest GitHub Release](https://github.com/LeeSpo/skd/releases/latest):

| Your Mac                 | Release asset                 |
| ------------------------ | ----------------------------- |
| Apple Silicon (M-series) | `skd_<version>_aarch64.dmg` |
| Intel                    | `skd_<version>_x64.dmg`     |

1. Open the DMG and move `skd.app` to `/Applications`.
2. Open the app from `/Applications`.
3. Each release includes `SHA256SUMS`; verify the checksum when you need to validate a download.

> [!NOTE]
> Release builds are ad-hoc signed and are **not currently notarized by Apple**. macOS may block the first launch. After attempting to open the app, use **System Settings → Privacy & Security → Open Anyway** for a DMG obtained from this repository's official Release page.
>
> If macOS warns that the app is damaged or cannot verify the developer, you can clear the quarantine attribute via Terminal:
> ```bash
> xattr -cr /Applications/skd.app
> ```
> Do not bypass a security warning for an unverified download.

## Security and data handling

- Connection profiles and layout preferences stay on the local machine. Secret fields are kept separately in the macOS Keychain rather than exported with connection profiles.
- The local WebSocket PTY bridge is strictly bound to `127.0.0.1` and secured with in-memory authentication tokens and Origin validation to prevent unauthorized local processes or browser tabs from accessing terminal sessions.
- skd maintains its own application-specific `known_hosts` store; it does not use `~/.ssh/known_hosts`. Verify a new host fingerprint through an independent channel before trusting it.
- Local file deletions move items to the native macOS Trash rather than permanently deleting them immediately.
- skd is not a replacement for a managed credential vault, endpoint security controls, or an audited enterprise SSH solution. Review the code and release checksums before using it with sensitive infrastructure.
- Never include passwords, private keys, passphrases, hostnames, or other secrets in GitHub issues or pull requests.

## Development

### Requirements

- macOS (Apple Silicon or Intel)
- Node.js 22.13+ within the 22.x series, or 24+
- Bun
- Current stable Rust (at least 1.89, as required by the locked dependencies)
- Tauri 2 dependencies for macOS

```bash
git clone https://github.com/LeeSpo/skd.git
cd skd
bun install --frozen-lockfile
bun run tauri dev
```

`bun run tauri dev` runs the complete desktop application. `bun run dev` starts only the Vite frontend at `http://localhost:1420`; it does not provide Tauri commands, the macOS menu bar, Keychain access, local PTYs, or SSH/SFTP connections.

### Validate and build

```bash
# Frontend
bun run lint
bunx tsc --noEmit
bun run test
bun run build

# Rust backend
cd src-tauri && cargo test
cargo clippy -- -D warnings
cargo fmt --check

# macOS .app and .dmg bundle
bun run tauri build
```

GitHub Actions builds release DMGs for both Apple Silicon and Intel and publishes their checksums when a `v*` tag is pushed. See the [changelog](CHANGELOG.md) for release history.

## Built with

- [Tauri 2](https://tauri.app/), [Rust](https://www.rust-lang.org/), and [Tokio](https://tokio.rs/)
- [React](https://react.dev/), TypeScript, and Tailwind CSS
- [xterm.js](https://xtermjs.org/) for terminal emulation
- [`russh`](https://github.com/Eugeny/russh) and `russh-sftp` for SSH and SFTP
- [CodeMirror](https://codemirror.net/) for the remote text editor

## Contributing

Bug reports, feature requests, and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) for setup, validation, coding conventions, and reporting guidance. Before filing an issue, remove all credentials and sensitive host details.

## Acknowledgements

skd began as a fork of [R-Shell](https://github.com/GOODBOY008/r-shell) by GOODBOY008. The upstream project is MIT licensed; its copyright and attribution are retained in [NOTICE](NOTICE).

## License

skd is released under the [MIT License](LICENSE).
