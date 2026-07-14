# Contributing to skd

Thank you for contributing to skd. The desktop application targets macOS and combines a React/TypeScript frontend with a Tauri/Rust backend.

## Development setup

Prerequisites:

- macOS
- Node.js 22 or newer
- pnpm 9
- The latest stable Rust toolchain
- The platform dependencies required by Tauri 2

Clone your fork, then install dependencies and start the desktop application:

```bash
git clone <your-fork-url>
cd skd-shell
pnpm install
pnpm tauri dev
```

`pnpm dev` starts only the browser frontend and does not provide native menus, Keychain access, or other Tauri integrations.

## Validation

Before opening a pull request, run:

```bash
pnpm lint
pnpm exec tsc --noEmit
pnpm test
pnpm build

cd src-tauri
cargo fmt --check
cargo test
```

There is currently no configured end-to-end test suite. Tests that require external SSH, SFTP, or FTP servers must remain ignored by default and document their environment requirements.

## Pull requests

1. Create a focused branch from `main`.
2. Add or update tests for changed behavior.
3. Keep user-facing strings in `src/locales/en.json` and access them through `react-i18next`.
4. Preserve macOS-only assumptions and Tauri command compatibility unless the change explicitly updates them.
5. Use a clear conventional commit prefix such as `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, or `chore:`.
6. Explain the motivation, user-visible impact, and validation performed in the pull request.

## Code style

### TypeScript and React

- Use functional components and hooks.
- Use the `@/` alias for imports from `src/`.
- Use existing shadcn/Radix primitives and Tailwind conventions.
- Do not hardcode user-facing text.
- Keep terminal input handlers free of per-keystroke logging and allocations.

### Rust

- Follow `rustfmt` output and address relevant Clippy findings.
- Use `anyhow::Result` internally and string errors at the Tauri IPC boundary.
- Avoid `unwrap` and `expect` in production paths.
- Preserve cancellation and cleanup behavior for connections and PTY sessions.

## Reporting issues

Include reproduction steps, expected and actual behavior, the macOS and hardware architecture versions, and relevant frontend or Rust logs. Do not include credentials, private keys, or server-sensitive data.

## License

Contributions are licensed under the project MIT License. Upstream R-Shell attribution is retained in [NOTICE](NOTICE).
