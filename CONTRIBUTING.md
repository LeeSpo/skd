# Contributing to skd

Thank you for your interest in contributing to **skd**! skd is a macOS-only lightweight terminal workspace built with React 19 + TypeScript (frontend) and Tauri 2 + Rust (backend), focusing on SSH, local shells, SFTP file management, and host profiles.

---

## Development Setup

### Prerequisites

- **macOS** (Apple Silicon `aarch64` or Intel `x86_64`)
- **Node.js** 22 or newer
- **pnpm** 9 (`v9.15.4` or matching version specified in `package.json`)
- **Rust** stable toolchain (2021 edition)
- **Tauri 2** platform dependencies for macOS

### Setup & Launch

1. Clone your fork:
   ```bash
   git clone https://github.com/<your-username>/skd-shell.git
   cd skd-shell
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Launch the desktop application in development mode (with Hot Module Replacement):
   ```bash
   pnpm tauri dev
   ```

> [!NOTE]
> Running `pnpm dev` launches the Vite dev server for the browser frontend only on port `1420`. It lacks Tauri IPC commands, native macOS menu bar integration, and macOS Keychain bridge. Use `pnpm tauri dev` for full application development.

---

## Validation & Code Quality

Before submitting a pull request, ensure all linting, type-checking, formatting, and unit tests pass locally.

### Frontend Validation

```bash
# Check code style and rules
pnpm lint

# Auto-fix fixable ESLint issues
pnpm lint:fix

# Run TypeScript type check without emitting code
pnpm exec tsc --noEmit

# Run unit tests (Vitest)
pnpm test

# Build production frontend bundle
pnpm build
```

### Rust Backend Validation

```bash
cd src-tauri

# Run Rust unit tests
cargo test

# Check code formatting
cargo fmt --check

# Check Clippy lints
cargo clippy -- -D warnings
```

> [!NOTE]
> There is currently no automated end-to-end (E2E) test suite requiring remote SSH/SFTP servers. Unit tests cover frontend serialization, terminal tab reducer logic, and Rust SSH/connection management.

---

## Technical & Coding Conventions

### TypeScript & React Frontend

- **Component & File Naming**: Use PascalCase for components (`PtyTerminal.tsx`, `GridRenderer.tsx`) and kebab-case for filenames (`pty-terminal.tsx`, `grid-renderer.tsx`).
- **Path Alias**: Always use `@/` for imports relative to `src/` (e.g. `import { cn } from '@/lib/utils'`).
- **Styling**: Tailwind CSS with Radix UI primitives (`@radix-ui/*`) and the `cn()` class-merging helper.
- **Internationalization (i18n)**:
  - All user-facing strings must use `react-i18next` (`useTranslation()`).
  - Source strings are maintained in `src/locales/en.json`.
  - **Never hardcode user-facing strings** in JSX, dialog titles, toast messages, tooltips, or placeholders.
  - Do not translate protocol names (`"SSH"`, `"SFTP"`), layout preset identifiers, or Rust error details.
- **Terminal (xterm.js) Input Guidelines**:
  - IME / Input Method: `attachCustomKeyEventHandler` must early-return `true` when `event.isComposing || event.keyCode === 229` to avoid swallowing or duplicating candidate selections (e.g. CJK typing).
  - React Event Handling: Never call `e.preventDefault()` on keydown events that target xterm's hidden `<textarea>`.
  - Performance: Avoid allocations (e.g. `new TextEncoder()`) and `console.log()` calls inside hot `onData` handlers.
- **Tauri Window & Dialog Centering**:
  - Standard shadcn `top-[50%] translate-y-[-50%]` centering can push tall dialogs outside the Tauri webview bounds. Override tall or dynamic dialogs with `!inset-0 !m-auto`.
  - Avoid `h-fit` on flex containers with `flex-1` children, as it collapses children height to zero.

### Rust Backend

- **Structure**:
  - Tauri commands: `src-tauri/src/commands.rs` (registered in `src-tauri/src/lib.rs`).
  - SSH subsystem: `src-tauri/src/ssh/`.
  - Local shell subsystem: `src-tauri/src/local_shell/`.
  - Connection lifecycle & state: `src-tauri/src/connection_manager.rs`.
  - PTY WebSocket streaming: `src-tauri/src/websocket_server.rs`.
- **Error Handling**: Use `anyhow::Result` internally, and convert to `Result<T, String>` at the `#[tauri::command]` IPC interface. Avoid `unwrap()` or `expect()` in production paths.
- **Concurrency & State**:
  - Thread-safe state uses `Arc<RwLock<HashMap<...>>>`.
  - PTY sessions stream bidirectional data over WebSocket (ports 9001–9010) using tagged `WsMessage` enums with generation counters (`StartPty`, `Input`, `Output`, `Resize`, `Close`) to prevent stale close races.
  - Support `CancellationToken` for pending SSH connection cancellations.

---

## Version Bumping & Release Process

Version numbers are synchronized across `package.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json`.

### Version Bumping

Use the automated script to bump versions:

```bash
# Bump patch version: 0.2.0 -> 0.2.1
pnpm run version:patch

# Bump minor version: 0.2.0 -> 0.3.0
pnpm run version:minor

# Bump major version: 0.2.0 -> 1.0.0
pnpm run version:major
```

This script automatically:
1. Updates `package.json`, `Cargo.toml`, `Cargo.lock`, and `tauri.conf.json`.
2. Adds a new section stub to `CHANGELOG.md`.
3. Creates a git commit: `chore: bump version to X.Y.Z`.

Before pushing, edit `CHANGELOG.md` to document the actual changes, then amend the commit (`git commit --amend`).

### Triggering Releases (CI/CD)

1. Create and push a version tag:
   ```bash
   git tag v0.2.0
   git push origin main --tags
   ```

2. GitHub Actions (`release.yml`) will:
   - Validate that tag version matches `package.json`, `Cargo.toml`, and `tauri.conf.json`.
   - Build macOS `.dmg` bundles for both Apple Silicon (`aarch64`) and Intel (`x64`).
   - Generate SHA256 checksums (`SHA256SUMS`).
   - Publish a new GitHub Release with attached `.dmg` assets.

---

## Pull Request Process

1. Fork the repository and create a feature branch off `main`:
   ```bash
   git checkout -b feat/my-new-feature
   ```
2. Make your changes following the coding conventions above.
3. Write or update unit tests to cover your changes.
4. Run all local validation checks (linting, type checks, Vitest, Rust cargo tests/clippy/fmt).
5. Format your commit messages using Conventional Commits (e.g. `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`).
6. Push to your fork and submit a Pull Request to `main`.
7. Provide a clear summary of your changes, motivation, user-visible impact, and verification steps in the PR description.

---

## Reporting Issues

When reporting bugs or requesting features, please open an issue on GitHub and include:

- A concise title and description.
- Reproduction steps.
- Expected vs. actual behavior.
- Your macOS version and CPU architecture (Apple Silicon vs Intel).
- Relevant console logs or Rust terminal outputs.

> [!CAUTION]
> **Security Warning**: NEVER attach private SSH keys, passwords, passphrases, API secrets, or sensitive host information in issue reports or pull requests.

---

## License & Attribution

Contributions are submitted under the project's [MIT License](LICENSE). Upstream R-Shell copyright and attribution details are retained in [NOTICE](NOTICE).
