# skd

skd is a macOS lightweight terminal workspace focused on SSH, local shells, SFTP file management, and host profiles.

## Features

- **SSH terminal sessions** — Interactive PTY terminals over SSH with password and public-key authentication
- **Local shell sessions** — Open a local terminal tab alongside remote sessions
- **Multi-tab terminal workspace** — Tab groups with split panes (up, down, left, right) and smooth global drag-and-drop tab management
- **SFTP file manager** — Dual-panel local/remote browser with upload, download, rename, delete, and transfer queue
- **Host profiles** — Save connections in a tree-view sidebar with folders
- **Private key authentication** — RSA, Ed25519, and ECDSA key support (file path or pasted key content)
- **Host key verification** — Interactive trust prompts against a local known_hosts store
- **macOS Keychain** — Secure, granular storage for connection passwords and private-key passphrases using native macOS Keychain
- **SSH local port forwarding** — Local SSH port forwarding with bookmark management, automated health checks, and active connection diagnostic tracking
- **Theme Palettes** — Multiple configurable application color palettes with real-time live preview in settings
- **Remote file editor** — Edit remote files with CodeMirror 6
- **System monitor** — Optional CPU, memory, disk, network, and process panels for remote hosts
- **FTP / FTPS** — Legacy protocol support remains available (not the primary focus)

## Tech Stack

- **Tauri 2** — Desktop shell using the OS native webview
- **Rust** — SSH/SFTP backend (`russh`, `russh-sftp`, `portable-pty`, `tokio`)
- **React 19** — UI with TypeScript and Tailwind CSS
- **xterm.js** — Terminal emulation (Canvas by default; optional WebGL renderer)
- **CodeMirror 6** — Remote file editor
- **react-i18next** — English user-facing strings

## Requirements

- macOS (Apple Silicon or Intel)
- Node.js + pnpm
- Rust toolchain

## Development

```bash
pnpm install
pnpm tauri dev
```

Other useful commands:

```bash
pnpm dev          # Frontend only (Vite on port 1420)
pnpm test         # Frontend unit tests (Vitest)
pnpm lint         # ESLint
cd src-tauri && cargo test   # Rust unit tests
```

## Build

Produces a macOS `.app` bundle and `.dmg` installer:

```bash
pnpm build && pnpm tauri build
```

Local build without updater artifacts:

```bash
pnpm tauri:build:local
```

## Acknowledgements

This project started as a fork of [R-Shell](https://github.com/GOODBOY008/r-shell) by GOODBOY008, licensed under the MIT License.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for the full text.

Original R-Shell copyright is retained. See [NOTICE](NOTICE) for attribution details.
