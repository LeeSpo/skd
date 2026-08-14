# Dependency audit

**Date:** 2026-08-13  
**Scope:** every direct dependency in `package.json` and `src-tauri/Cargo.toml`, checked against source imports and mount paths.  
**Method:** grep/read of `src/` and `src-tauri/src/`, production `dist/` chunk sizes, `cargo tree`, official crate/package feature docs.

Verdicts:

| Verdict | Meaning |
|---------|---------|
| **keep** | Used by a core, mounted product path |
| **remove** | Declared but unused, or used only as a no-op |
| **optional-remove** | Used, but only by a documented non-primary feature; deleting it requires a product decision |
| **slim** | Keep the crate/package, cut features or replace with a thinner API |

---

## Executive summary

Almost every declared dependency is imported. The tree is not full of dead packages. 0.2.1 already removed unused UI primitives ([CHANGELOG.md](../CHANGELOG.md)). The remaining cuts are small safe removals, feature slimming, and a few **product** decisions — not a hidden pile of unused libraries.

**Can remove now (no product change):**

1. `@testing-library/jest-dom` — never imported, never registered in Vitest setup.
2. `next-themes` — `useTheme()` is called, but there is no `ThemeProvider` anywhere. Theme already lives in `src/lib/utils.ts`.

**Can slim now (no product change):**

3. `tokio` `features = ["full"]` → list only `macros`, `rt-multi-thread`, `net`, `time`, `io-util`, `sync`, `fs`. No `tokio::process` or `tokio::signal` usage.
4. If FTP stays: upgrade `suppaftp` 6 → 8 with its `tokio` backend and drop `async-std`. Today FTP pulls a second async runtime.

**Largest reductions, but they are product decisions:**

5. Drop FTP/FTPS compatibility → delete `suppaftp` + `async-std` and a lot of protocol wiring. README already calls FTP non-primary.
6. Drop remote system-monitor charts → delete `recharts` and ~383 KB of lazy JS.
7. Drop the in-app CodeMirror editor → delete 12 `@codemirror/*` packages and ~342 KB of lazy JS.

**Do not remove:** `@xterm/*`, `@radix-ui/*` (every primitive is mounted), `russh` + `rsa` + `ring`, `lucide-react` (tree-shaken), `react-resizable-panels`, `sonner`, `i18next` (string catalog, not leftover locales), the test stack.

Install size (`node_modules` 294 MB, pnpm content-addressed) is dominated by `lucide-react` source (45 MB of unused icons on disk) and tooling (`jsdom`, `vitest`, `typescript`). The **shipped** frontend is ~3.0 MB of `dist/`, already code-split. The release Rust binary is 10.0 MB.

---

## High-impact reductions

| Action | Kind | Estimated saving | Risk |
|--------|------|------------------|------|
| Remove `@testing-library/jest-dom` | remove | ~412 KB install; 0 runtime | None |
| Remove `next-themes`; pass theme from `getSavedTheme()` | remove | ~44 KB install; a few bytes in `sonner` chunk | None — provider is already missing |
| Narrow `tokio` features | slim | Compile time; little release-binary change (LTO + strip already on) | Low — list the features the code already uses |
| Upgrade `suppaftp` to tokio backend; drop `async-std` | slim | One less async runtime (`async-std` + executor/io/tls stack) | Medium — rewrite `ftp_client.rs` against suppaftp 8 |
| Drop FTP product surface | optional-remove | `suppaftp` + `async-std` + `native-tls`; simpler `connection_manager` / commands / dialog | High for anyone still using FTP |
| Drop system-monitor charts (`recharts`) | optional-remove | `dist/assets/chart-colors-*.js` **382.7 KB**; 5.2 MB install | High if monitor charts stay |
| Drop in-app editor (`@codemirror/*`) | optional-remove | `file-editor-view-*.js` **341.5 KB** + language chunks | High if remote file edit stays |
| Replace `i18next`/`react-i18next` with a 20-line `t()` | replace | ~1.6 MB install; tens of KB in the vendor chunk | High churn, no user-facing win |
| Trim unused `lucide-react` icons | already done | Disk 45 MB is the full icon set; Vite emits 0.1–0.3 KB per used icon | Do not replace |

`dist/` largest chunks (production build already on disk):

| Chunk | Size | Contents |
|-------|------|----------|
| `pty-terminal-*.js` | 512.9 KB | xterm.js + addons |
| `chart-colors-*.js` | 382.7 KB | recharts (lazy, right-sidebar monitor) |
| `file-editor-view-*.js` | 341.5 KB | CodeMirror core (lazy) |
| `index-BzaKmhjx.js` | 299.7 KB | shared React vendor |
| `App-*.js` | 273.2 KB | main workspace |

---

## Frontend runtime dependencies

Source: [package.json](../package.json) `dependencies`.

| Package | Used? | Used by | Verdict |
|---------|-------|---------|---------|
| `@codemirror/commands` | yes | `src/components/code-editor.tsx:4` | keep (editor) |
| `@codemirror/lang-cpp` | yes, lazy | `code-editor.tsx:64` | optional-remove (trim language) |
| `@codemirror/lang-css` | yes, lazy | `code-editor.tsx:42` | keep if editor stays |
| `@codemirror/lang-html` | yes, lazy | `code-editor.tsx:38` | keep if editor stays |
| `@codemirror/lang-java` | yes, lazy | `code-editor.tsx:68` | optional-remove (trim language) |
| `@codemirror/lang-javascript` | yes, lazy | `code-editor.tsx:19–27` | keep if editor stays |
| `@codemirror/lang-json` | yes, lazy | `code-editor.tsx:30` | keep if editor stays |
| `@codemirror/lang-markdown` | yes, lazy | `code-editor.tsx:46` | keep if editor stays |
| `@codemirror/lang-php` | yes, lazy | `code-editor.tsx:72` | optional-remove (trim language) |
| `@codemirror/lang-python` | yes, lazy | `code-editor.tsx:33` | keep if editor stays |
| `@codemirror/lang-rust` | yes, lazy | `code-editor.tsx:56` | optional-remove (trim language) |
| `@codemirror/lang-sql` | yes, lazy | `code-editor.tsx:70` | optional-remove (trim language) |
| `@codemirror/lang-xml` | yes, lazy | `code-editor.tsx:51` | keep if editor stays |
| `@codemirror/lang-yaml` | yes, lazy | `code-editor.tsx:54` | keep if editor stays |
| `@codemirror/language` | yes | `code-editor.tsx:5` | keep (editor) |
| `@codemirror/search` | yes | `code-editor.tsx:6` | keep (editor) |
| `@codemirror/state` | yes | `code-editor.tsx:3` | keep (editor) |
| `@codemirror/theme-one-dark` | yes | `code-editor.tsx:7` | keep (editor) |
| `@codemirror/view` | yes | `code-editor.tsx:2` | keep (editor) |
| `@radix-ui/react-alert-dialog` | yes | `src/components/ui/alert-dialog.tsx` → host-key, connection-manager, file-browser, update-checker, processes | keep |
| `@radix-ui/react-checkbox` | yes | `ui/checkbox.tsx` → port-forward-dialog, sync-dialog | keep |
| `@radix-ui/react-collapsible` | yes | `ui/collapsible.tsx` → transfer-queue.tsx | keep |
| `@radix-ui/react-context-menu` | yes | `ui/context-menu.tsx` → terminal-context-menu, file-panel | keep |
| `@radix-ui/react-dialog` | yes | `ui/dialog.tsx` → connection dialog, settings, many modals | keep |
| `@radix-ui/react-dropdown-menu` | yes | `ui/dropdown-menu.tsx` → menu-bar, connection-manager | keep |
| `@radix-ui/react-label` | yes | `ui/label.tsx` → keyboard-interactive-context, forms | keep |
| `@radix-ui/react-popover` | yes | `ui/popover.tsx` → new-tab-menu, log-monitor | keep |
| `@radix-ui/react-progress` | yes | `ui/progress.tsx` → transfers, monitor | keep |
| `@radix-ui/react-scroll-area` | yes | `ui/scroll-area.tsx` → file browser, transfer queue, monitor | keep |
| `@radix-ui/react-select` | yes | `ui/select.tsx` → connection-dialog, settings, monitor | keep |
| `@radix-ui/react-separator` | yes | `ui/separator.tsx` → menu-bar, connection-dialog, settings | keep |
| `@radix-ui/react-slider` | yes | `ui/slider.tsx` → settings-modal.tsx:485+ | keep |
| `@radix-ui/react-slot` | yes | `ui/button.tsx`, `ui/badge.tsx` | keep |
| `@radix-ui/react-switch` | yes | `ui/switch.tsx` → settings, connection-dialog, compose-pane | keep |
| `@radix-ui/react-tabs` | yes | `ui/tabs.tsx` → App.tsx right sidebar | keep |
| `@radix-ui/react-toggle` | yes | `ui/toggle.tsx` → log-monitor, monitor-panel-picker | keep |
| `@radix-ui/react-tooltip` | yes | `ui/tooltip.tsx` → menu-bar, connection-manager, new-tab-menu | keep |
| `@tauri-apps/api` | yes | App, invoke/listen/webview throughout `src/` | keep |
| `@tauri-apps/plugin-dialog` | yes | `connection-dialog.tsx:4`, `integrated-file-browser.tsx:5` | keep |
| `@xterm/addon-clipboard` | yes | `pty-terminal.tsx:9,217` | keep |
| `@xterm/addon-fit` | yes | `pty-terminal.tsx:4,210` | keep |
| `@xterm/addon-search` | yes | `pty-terminal.tsx:8` + `terminal-search-bar.tsx` | keep |
| `@xterm/addon-unicode11` | yes | `pty-terminal.tsx:7,221–223` | keep |
| `@xterm/addon-web-links` | yes | `pty-terminal.tsx:5,211` | keep |
| `@xterm/addon-webgl` | yes | `pty-terminal.tsx:6,255` (opt-in renderer) | keep |
| `@xterm/xterm` | yes | `pty-terminal.tsx:3` | keep |
| `class-variance-authority` | yes | button, badge, dialog, tabs, toggle, panel-chrome | keep |
| `clsx` | yes | `src/lib/utils.ts:1` (`cn()`) | keep |
| `i18next` | yes | `src/lib/i18n.ts:1`; English-only catalog | keep (architecture, not unused) |
| `lucide-react` | yes | 37 files; Vite splits icons to ~0.1–0.3 KB each | keep |
| `next-themes` | imported, **no provider** | `src/components/ui/sonner.tsx:4`; `ThemeProvider` grep is empty; app theme is `initializeTheme()` in `src/main.tsx:9` + `src/lib/utils.ts:86` | **remove** |
| `react` / `react-dom` | yes | app | keep |
| `react-i18next` | yes | `useTranslation()` across components | keep |
| `react-resizable-panels` | yes | `ui/resizable.tsx` → App layout, grid-renderer, file browsers | keep |
| `recharts` | yes, lazy | gpu / network-usage / network-latency panels | optional-remove (monitor) |
| `sonner` | yes | toasts + `ui/sonner.tsx` | keep |
| `tailwind-merge` | yes | `src/lib/utils.ts:2` | keep |

### Notes on “looks unused but is not”

- **CodeMirror language packs** are all dynamically imported (`code-editor.tsx:12–86`). They are not in the initial bundle. The editor itself is lazy-loaded from `terminal-group-view.tsx:33` and `FileViewerWindow.tsx:2`. README still lists “Edit supported remote text files with CodeMirror” as a product extra.
- **Radix packages** each back one shadcn wrapper under `src/components/ui/`, and every wrapper is imported by a feature component (not only tests).
- **i18next** is English-only (`src/lib/i18n.ts:40–46`, `src/locales/en.json`). It is the string catalog and native-menu sync path (`i18n.ts:26–38`), not leftover multi-locale support. Replacing it does not change the user-visible product.
- **recharts** is only pulled when the right-sidebar monitor tab loads (`App.tsx:78–80, 1617–1626`). Documented as an extra in README and as “legacy UI still mounted” in AGENTS.md.

---

## Frontend devDependencies

Source: [package.json](../package.json) `devDependencies`.

| Package | Used? | Used by | Verdict |
|---------|-------|---------|---------|
| `@eslint/js` | yes | `eslint.config.js:1` | keep |
| `@tauri-apps/cli` | yes | `pnpm tauri` | keep |
| `@testing-library/jest-dom` | **no** | Not imported. Not in `vitest.config.ts` `setupFiles` (only `src/__tests__/i18n-setup.ts`). No `toBeInTheDocument` / `toHaveClass` matchers in the suite | **remove** |
| `@testing-library/react` | yes | 20+ `src/__tests__/*.tsx` files | keep |
| `@types/node` | yes | Vite / `tsconfig.node.json` | keep |
| `@types/react` / `@types/react-dom` | yes | TypeScript | keep |
| `@vitejs/plugin-react` | yes | `vite.config.ts` | keep |
| `autoprefixer` | yes | `postcss.config.js:4` | keep (optional slim: WKWebView-only target) |
| `eslint` | yes | `pnpm lint` | keep |
| `eslint-plugin-react-hooks` | yes | `eslint.config.js:3` | keep |
| `eslint-plugin-react-refresh` | yes | `eslint.config.js:4` | keep |
| `fast-check` | yes | 13 `*.property.test.ts` files | keep |
| `globals` | yes | `eslint.config.js:5,18` | keep |
| `jsdom` | yes | `vitest.config.ts:11` | keep |
| `postcss` | yes | Tailwind pipeline | keep |
| `tailwindcss` | yes | `tailwind.config.js`, `src/styles/globals.css` | keep |
| `typescript` | yes | `pnpm build` (`tsc && vite build`) | keep |
| `typescript-eslint` | yes | `eslint.config.js:2` | keep |
| `vite` | yes | `pnpm dev` / build | keep |
| `vitest` | yes | `pnpm test` | keep |

---

## Rust crates

Source: [src-tauri/Cargo.toml](../src-tauri/Cargo.toml).

| Crate | Used? | Used by | Verdict |
|-------|-------|---------|---------|
| `tauri` | yes | `lib.rs`, commands, menu | keep |
| `tauri-build` | yes | `build.rs` | keep |
| `tauri-plugin-dialog` | yes | `lib.rs:238` | keep |
| `tauri-plugin-window-state` | yes | `lib.rs:237` (desktop target) | keep |
| `serde` / `serde_json` | yes | all IPC types | keep |
| `tokio` (`full`) | yes, over-enabled | net/time/io/sync/fs/spawn/select/test macros. **No** `tokio::process` or `tokio::signal` in `src-tauri/src/` | **slim** features |
| `russh` | yes | `ssh/mod.rs`, `sftp_client.rs`, tests | keep |
| `russh` feature `ring` | yes | crypto backend (`Cargo.toml:27`; default `aws-lc-rs` is off) | keep |
| `russh` feature `rsa` | yes | `PREFERRED_HOST_KEY_ALGOS` includes RSA + legacy `ssh-rsa` (`ssh/mod.rs:38–55`); CHANGELOG 0.2.3 | keep |
| `russh` feature `flate2` | enabled, no app-level use | russh default feature for zlib compression ([docs.rs/russh/0.62.3/features](https://docs.rs/crate/russh/0.62.3/features)). No `compress`/`flate`/`zlib` in our code | slim only if we accept no SSH compression |
| `russh` feature `legacy-ed25519-pkcs8-parser` | enabled, no direct call | old OpenSSH Ed25519 PKCS#8 keys | keep (user-key compat) |
| `russh-sftp` | yes | `ssh/mod.rs:21`, `sftp_client.rs:4` | keep |
| `anyhow` | yes | throughout backend | keep |
| `tracing` | yes | ssh, ws, commands, ftp | keep |
| `tracing-subscriber` | yes | `lib.rs:231` | keep |
| `tokio-tungstenite` | yes | `websocket_server.rs:14` | keep |
| `futures` | yes | `websocket_server.rs:5` (`SinkExt`/`StreamExt`) | keep (or slim to `futures-util`) |
| `tokio-util` | yes | `CancellationToken` in ssh, pty, port-forward, local_shell | keep |
| `suppaftp` | yes, FTP only | `ftp_client.rs:21–22, 62, 91` | optional-remove **or** slim to tokio backend |
| `async-std` | yes, FTP only | `ftp_client.rs:2, 60, 89, 217` | optional-remove (or drop after tokio-suppaftp) |
| `dirs` | yes | home/data dirs: key_loader, known_hosts, local_shell, commands | keep |
| `open` | yes | `commands.rs:3107, 3116` | keep |
| `portable-pty` | yes | `local_shell/mod.rs:4` | keep |
| `base64` | yes | `commands.rs:1, 994` (`read_remote_file_base64`) | keep |
| `sys-locale` | yes | `local_shell/mod.rs:81` (sets `LANG` for production bundles) | keep |
| `keyring` | yes | `credential_store.rs:1–2`; mock builder in `dev-dependencies` | keep |
| `tempfile` | yes (prod + tests) | `shell_integration.rs:4,184`, `pty_session.rs:14`, `local_shell/mod.rs:317`, tests | keep (not a test-only crate) |
| `trash` | yes | `commands.rs:3085` | keep |
| `block2` / `objc2` / `objc2-app-kit` / `objc2-foundation` | yes, macOS | `native_file_drag.rs:107–116` | keep |

`cargo tree` reports ~391 unique crates / 1276 nodes. `async-std` is a second runtime (async-global-executor, async-io, polling) used only because `suppaftp` 6 is configured with `async-native-tls`. Current suppaftp (v8) documents first-class `tokio` / `tokio-async-native-tls` features ([veeso/suppaftp README](https://github.com/veeso/suppaftp)).

---

## Already gone (stale docs)

These appear in [AGENTS.md](../AGENTS.md) but are **not** in `package.json`:

- `react-hook-form` — listed as a frontend dependency; no import, not declared.
- `@xterm/addon-image` — listed in the xterm addon set; not declared.

0.2.1 already pruned unused UI primitives ([CHANGELOG.md](../CHANGELOG.md)). This audit did not find another layer of unused Radix wrappers.

---

## Do not remove

| Dependency | Why |
|------------|-----|
| `@xterm/xterm` + six addons | Core product. Fit/search/clipboard/unicode/web-links are always loaded; WebGL is a user setting (`pty-terminal.tsx:250–278`). |
| Every `@radix-ui/*` listed above | Each backs a mounted control. There is no leftover shadcn wrapper. |
| `russh` + `rsa` + `ring` | SSH is the product. RSA/legacy `ssh-rsa` is an explicit compatibility goal (CHANGELOG 0.2.3, `ssh/mod.rs:33–55`). |
| `lucide-react` | Used in 37 files. On-disk size is the full icon set; the bundle is per-icon. |
| `react-resizable-panels` | Main workspace, split terminals, file browsers. |
| `sonner` | Project-wide toast API. |
| `i18next` / `react-i18next` | Centralized strings + native macOS menu labels. English-only ≠ unused. |
| `clsx` + `tailwind-merge` + `cva` | `cn()` and shadcn variants. Tiny. |
| `fast-check` + Vitest + Testing Library | Active test suite; `fast-check` is not decorative. |
| `tempfile` | Production: session-scoped shell-integration dirs. |
| macOS `objc2*` | Native file drag (`native_file_drag.rs`). |

---

## Recommended sequence

1. **Now, no behavior change:** delete `@testing-library/jest-dom`; delete `next-themes` and pass `theme` into `<Toaster>` from `getSavedTheme()` / `isDarkTheme()`.
2. **Now, compile-time only:** replace `tokio` `full` with `{ version = "1", features = ["macros", "rt-multi-thread", "net", "time", "io-util", "sync", "fs"] }`.
3. **If FTP stays:** plan a `suppaftp` 8 + tokio migration and drop `async-std`.
4. **If FTP is retired:** remove protocol UI, `ftp_client.rs`, manager maps, and both crates. README already frames this as compatibility-only.
5. **If monitor charts are retired:** remove `recharts` and the three chart panels. Keep process/disk/overview if they stay CSS-only.
6. **If the in-app editor is retired:** remove the 17 `@codemirror/*` packages. Do not trim languages first unless install-time package count is the actual goal — they are already lazy.

Do not chase `lucide-react` disk size or `i18next` English-only-ness. Those are not the expensive parts of what users download.

---

## Sources

- [package.json](../package.json), [src-tauri/Cargo.toml](../src-tauri/Cargo.toml)
- [src/main.tsx](../src/main.tsx), [src/lib/utils.ts](../src/lib/utils.ts), [src/lib/i18n.ts](../src/lib/i18n.ts)
- [src/components/ui/sonner.tsx](../src/components/ui/sonner.tsx), [src/components/code-editor.tsx](../src/components/code-editor.tsx), [src/components/pty-terminal.tsx](../src/components/pty-terminal.tsx)
- [src/App.tsx](../src/App.tsx) (lazy `SystemMonitor` / `LogMonitor`, right sidebar)
- [src-tauri/src/ftp_client.rs](../src-tauri/src/ftp_client.rs), [src-tauri/src/ssh/mod.rs](../src-tauri/src/ssh/mod.rs), [src-tauri/src/lib.rs](../src-tauri/src/lib.rs)
- [src/__tests__/i18n-setup.ts](../src/__tests__/i18n-setup.ts), [vitest.config.ts](../vitest.config.ts)
- [README.md](../README.md) (FTP compatibility, CodeMirror extra, monitor extra)
- [CHANGELOG.md](../CHANGELOG.md) 0.2.1 UI pruning; 0.2.3 russh/RSA
- [docs.rs russh 0.62.3 features](https://docs.rs/crate/russh/0.62.3/features)
- [suppaftp README — tokio / smol backends](https://github.com/veeso/suppaftp)
- Measured: `du -sh node_modules` (294 MB), `du -shL` per package, `find dist/assets -name '*.js'`, `ls src-tauri/target/release/skd` (10.0 MB), `cargo tree`
