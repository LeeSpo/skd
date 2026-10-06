# Repository Guidelines

skd is a macOS-only SSH/SFTP terminal workspace using React 19, TypeScript, Tauri 2, and Rust. Use Bun for frontend tooling.

## Project Structure & Module Organization

- `src/App.tsx`: application entry and layout; `src/components/`: features, terminal UI, and shared primitives; `src/lib/`: state, storage, and services.
- `src/locales/en.json`: English UI strings; `src/index.css` and `src/styles/`: styles.
- `src-tauri/src/`: SSH, SFTP, local shells, and WebSocket streaming. Define IPC commands in `commands.rs` and register them in `lib.rs`.
- `src-tauri/icons/`: app icons; `docs/images/`: documentation screenshots.

## Build, Test, and Development Commands

- `bun install`: install dependencies.
- `bun run tauri dev`: run the desktop app; `bun run dev`: browser frontend only, without native bridges.
- `bun run build`: type-check and build frontend; `bun run tauri build`: package macOS bundles.
- `bun run lint` / `bun run lint:fix`: check / fix ESLint issues.
- `bun run test`: run frontend tests.
- From `src-tauri/`, run `cargo test`, `cargo fmt --check`, and `cargo clippy -- -D warnings` for Rust validation.

## Coding Style & Naming Conventions

Follow surrounding formatting: two-space TypeScript indentation, single quotes, and semicolons; four-space Rust indentation with rustfmt. Use PascalCase components/types, kebab-case frontend filenames, snake_case Rust modules/functions, and `@/` imports. Style with Tailwind and `cn()`.

Use `useTranslation()` and `en.json` for UI text; preserve backend option values. Prefix storage keys with `skd-`. Use `anyhow::Result` internally and `Result<T, String>` at IPC boundaries.

## Testing Guidelines

Frontend tests use Vitest, jsdom, Testing Library, and fast-check. Name tests `*.test.ts` or `*.test.tsx` under `src/**/__tests__/`. Rust tests live alongside modules. Cover changed behavior and regressions; no numeric coverage threshold is configured. Run applicable checks before submitting.

## Commit & Pull Request Guidelines

Use Conventional Commits, matching history: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`. Target `main`; describe motivation, behavior, and validation, link relevant issues, and include screenshots for UI changes. Keep credentials out of commits and reports. See `CONTRIBUTING.md` for release procedures.

## Agent-Specific Guardrails

- Terminal changes: preserve IME filtering in `src/lib/terminal-ime.ts`, composition passthrough, textarea input, and allocation/log-free `onData` handlers.
- Session changes: retrieve the dynamic WebSocket port, preserve PTY generation checks, and clean up cancellations.
- UI changes: keep tab portal hosts stable, exclude controls from drag regions, gate translucency on native-material support, and keep large sheets blur-free. Center tall dialogs with `!inset-0 !m-auto`; give `flex-1` children explicit parent height.
- Issues, triage, and domain work: read the corresponding `docs/agents/issue-tracker.md`, `triage-labels.md`, or `domain.md`.
