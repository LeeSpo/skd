# skd visual baseline

## Current direction — Sequoia native (2026-10)

The workspace targets the look of a macOS 15 Sequoia app (Finder, Safari compact tabs, System Settings). It stays React, Radix, and xterm.js inside the Tauri webview. There is no SwiftUI rewrite and no macOS 26 Liquid Glass.

| Layer | Decision |
| --- | --- |
| Window material | One AppKit `sidebar` `NSVisualEffectView` behind the whole webview. It follows the window active state. |
| Sidebar, titlebar, inspector chrome | Tinted with `--material-sidebar` / `--material-titlebar` / `--material-inspector` only when `data-native-material="true"`. |
| Terminal | Opaque by default. Optional background opacity mixes the opaque theme colour; text is never faded with CSS `opacity`. WebGL is replaced by the canvas renderer while that background is translucent. `data-terminal-translucent` makes only `.workspace-content-surface` transparent. The bottom panel and inspector body stay opaque. |
| Menus, popovers, tooltips, toasts | `.glass-menu` (`backdrop-filter`) with an opaque fallback. Menu highlight is the current palette `--primary` with white text. |
| Sheets | `--material-sheet` tint, 12px radius, `bg-black/15` scrim, no backdrop-filter. Tall dialogs stay `inset-0 m-auto`. |
| System palette | Default for users with no saved palette. `--primary` follows `--system-accent` from `NSColor.controlAccentColor`. Sidebar selection is a solid accent fill. The other palettes keep their own tokens and a 16% selection mix. |
| Chrome | One 44px titlebar. A single group's tabs live in that bar. Two or more groups put a 30px strip on each pane and a title plus subtitle in the titlebar. The bottom status bar is gone. Controls are 28px, compact controls 24px. |

The 2026-10-03 rule that only the sidebar may be translucent is superseded by the table above. Dense text (terminal, file lists, logs, form fields) still sits on an opaque or high-tint surface.

## Previous direction — macOS workspace (2026-10-03)

The workspace now uses a full-height host sidebar beside a solid terminal column. Native macOS sidebar material shows through the transparent main webview; controls remain React/Radix, and terminal rendering remains xterm.js. The layout draws on [Enso](https://github.com/amanfromsolan/enso) and the Apple toolbar/sidebar guidance linked below. It does not require a SwiftUI rewrite.

### Geometry and behavior

| Element | Current decision |
| --- | --- |
| Host sidebar | Full window height, 200–360 CSS px when resizing; native traffic lights have an 80px inset; search and compact 28px rows; preferences in the footer |
| Main column | Opaque terminal/content surfaces; 44px toolbar, 36px terminal tab strip with 28px inset tabs, 24px status bar |
| Toolbar | Session title, panel toggles, new-session menu and More Actions; layout presets, Zen mode and port forwarding remain available |
| Tools | Files and Compose below the terminal; monitor/logs in the right inspector; existing visibility, layout presets and stored sizes remain authoritative |
| Controls | System typography, 13px menu/form text, 32px default buttons/fields, restrained shadows and segmented controls; no enclosing cards around workspace panes |
| Dialogs | Settings categories beside independently scrolling content; connection form bounded to 680px width; both retain fixed action footers and viewport-safe centering |
| Files | Compact aligned rows, subtle alternating backgrounds, single navigation toolbar and existing filter/transfer behavior |

Graphite, Midnight, Nordic and Cupertino retain their palette tokens and light/dark support. Choosing an interface palette no longer changes the terminal theme. Existing ANSI colors, font preferences, connection records, shortcuts and session serialization are preserved. Layout toggles retain the mounted terminal subtree.

### Native material and fallback

- Tauri applies the AppKit `sidebar` window effect with `followsWindowActiveState`. Only the sidebar exposes the effect; the main content and floating menus/dialogs remain opaque.
- The main window uses Tauri's `macos-private-api` feature and `macOSPrivateApi` configuration for transparency. This implementation targets the existing macOS `.app`/`.dmg` distribution path; App Store compatibility is not part of this change.
- The native appearance follows explicit light/dark previews. Automatic mode clears the native override so macOS can continue following the system; cancellation restores the saved mode without rewriting preferences.
- AppKit's Reduce Transparency preference is queried on the main thread and observed live. Browser previews, native bridge failure and increased contrast use an opaque sidebar fallback. Inactive windows use quieter chrome and selection.
- The separate file-viewer window keeps its opaque root and does not initialize the sidebar appearance bridge.

### Verification

- Frontend tests cover terminal mount continuity through sidebar/inspector toggles, saved layout state, native appearance preview/cancellation, automatic mode, accessibility changes and subscription cleanup. Existing theme, connection, terminal, file-browser and control tests remain in the full suite.
- Native inspection before the user requested stopping Computer Use covered the source-built application at approximately 1280×800 and 960×600: settings and connection-form scrolling/footer reachability, all four dark palette previews, light Graphite/Cupertino previews, cancellation and the local file panel. Local terminal output survived resizing, panel toggles and appearance previews; pasted Chinese and spaces rendered correctly.
- The final 200px sidebar constraint was code-reviewed; the automatic-mode correction has regression tests. The final source was built after Computer Use stopped. Actual system preference changes, full-screen transitions, composed IME input, VoiceOver and live remote SSH/SFTP transfers were not manually verified in this pass. Native screenshots are not a complete rendered contrast audit.
- Final `bun run test`: 72 files and 634 tests passed. `bun run lint`: 0 errors, 180 existing warnings. `bun run tauri build --debug --bundles app`: TypeScript, Vite, Rust and macOS application bundling succeeded. `git diff --check`: clean. Existing jsdom canvas diagnostics and Vite's large-chunk advisory remain.
- Rust test results: 154 passed; three existing local-delete-to-Trash tests failed. All three failures were reproduced against the unmodified HEAD in a separate temporary source copy: `test_delete_local_file`, `test_delete_local_directory`, `test_delete_local_file_moves_to_trash`.
- Debug application bundle: `src-tauri/target/debug/bundle/macos/skd.app`. No release, upload or commit was created.

The sections below are historical. Their earlier geometry, test totals and review gates do not describe the current implementation; this section supersedes them for the areas changed above.

## Previous direction — macOS × Cursor (2026-09-18)

macOS-informed structure with a Cursor-inspired neutral palette. Graphite uses a dark content canvas, slightly lighter window chrome, and raised floating surfaces. Keep terminal content primary, with system typography, restrained blue actions, inset selected rows and tabs, and visible keyboard focus. Existing palettes, saved layout and terminal ANSI/font choices remain user-controlled.

This is a React/Radix/Tauri implementation informed by Apple guidance, not native AppKit, Liquid Glass, or an exact copy of a Cursor theme. Color values and geometry below are skd design decisions. The fixed app accent does not track the macOS system accent.

## Sources and scope

- [Apple Design Resources](https://developer.apple.com/design/resources/): official platform UI kits, font and symbol resources.
- [Designing for macOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-macos/): comfortable information density, resizable workspaces, menu integration, keyboard input and personalization.
- [Apple Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars/): logical groups, leading sidebar controls, view titles and frequent actions.
- [Apple Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars/): concise grouping, disclosure and navigation hierarchy.
- [Cursor Themes](https://docs.cursor.com/en/configuration/themes): light/dark theme support and customization. Graphite is an app-defined interpretation of Cursor's neutral editor aesthetic, not a published vendor color specification.
- [File browser research](file-browser-design-research.md): existing file-navigation design background.

The Apple and Cursor pages above were consulted for this pass. No proprietary UI kit assets or SF Symbols were copied into the repository; existing Lucide icons remain in use.

## Design rules

| Element | Decision |
| --- | --- |
| Graphite hierarchy | Content `#181818`, chrome/sidebar `#212121`, floating surface `#282828`; borders `#303030` / `#353535` |
| Accent and text | Blue `#8AB4F8`, primary text `#E6E6E6`, secondary text `#ABABAB`; selected `#343434`, hover `#2A2A2A` |
| Light appearance | Neutral white/gray surfaces, blue actions, stronger semantic text colors |
| Window chrome | 44px unified toolbar, native traffic-light clearance, leading sidebar toggle and session title; hide irrelevant panel toggles in the empty workspace |
| Tabs and sidebars | 40px terminal tab strip with 32px inset tabs; rounded connection rows; separate search/local-shell actions from the section heading |
| Type | SF Pro/system stack, 13px controls and form descriptions, 12px supporting copy; preserve terminal font preferences |
| Corners | 8px controls/rows, 10px menus, 14px dialogs; avoid enclosing every workspace pane in a card |
| Forms | Segmented connection navigation, `min(680px, 85vh)` height, independently scrollable content and fixed footer |
| Sliders and switches | Thin 4px slider track within a 28px hit region; visible inactive switch tracks; labels associated with actual controls |
| Focus and motion | Blue focus indicator, named keyboard-accessible controls; reduced-motion and increased-contrast media preferences |
| Feedback | Explicit empty/search states; preserve connection status and persistent failure feedback |

## Behavior and verification for this pass

- Connection search matches names, hosts and usernames through collapsed folders. Matching ancestors expand temporarily; clearing the search restores the underlying disclosure state. Escape respects IME composition.
- Saved connection rows support Tab focus, Space to select and Enter to connect, without changing terminal input handlers.
- Welcome actions open a remote connection, a local terminal, or preferences. No demonstration hosts or fake operational data were added.
- Settings categories remain vertical; palette cards use two columns. Cancelling a preview restores both the saved appearance mode and previous palette.
- Visual inspection covered the Graphite workspace, welcome screen, connection dialog, dark/light settings and native Cupertino workspace. Browser measurements at 960×600 confirmed the connection dialog stays within the viewport (760×510, 45px top margin). Native inspection used the development bundle built from this source, with real search, dialog and local-terminal input/output checks.
- Raw token tests cover all four dark palettes and the shared/Cupertino light palettes. These checks are not a full accessibility certification or a native screenshot audit of every palette.

### Final validation (2026-09-19)

- `bun run test`: 70 test files, 625 tests passed. jsdom reports its existing unimplemented canvas diagnostic; the test run exits successfully.
- `bun run lint`: 0 errors, 180 warnings (same count as the first lint run in this pass).
- `bun run tauri build --debug --bundles app`: TypeScript, Vite, Rust and macOS app bundling succeeded. Vite retains its large-chunk advisory.
- `git diff --check`: clean. The original uncommitted work was preserved; this pass does not create a commit.
- Development bundle: `src-tauri/target/debug/bundle/macos/skd.app`.

## Earlier implementation history

The notes below document previous passes and their then-current checks. Their color/geometry choices and outstanding-review statements are historical; the current direction and verification above supersede those for the areas changed in this pass.

## Implementation batches and acceptance

1. Midnight tokens, shared surfaces/controls, tooltip. Check workspace plus representative dialogs.
2. Connection dialog, settings navigation, welcome screen. Preserve callbacks, configuration and validation.
3. File browser, Compose, monitoring/logs. Preserve terminal, file and transfer behavior.
4. Notifications, keyboard/accessibility and edge states. Do not treat passing unit tests as visual acceptance.

Each batch requires tests/build/diff checks and separate visual review. Validate light and all dark palettes, minimum supported window size, long names, focus, disconnected/error/empty states and reduced motion. Rendered contrast includes opacity/compositing; checking raw token pairs alone is not full accessibility certification.

## Current evidence

- Midnight surface changes implemented in `src/styles/globals.css`; terminal tokens and other palettes unchanged.
- After the user's request for a more refined tone, Midnight uses cool ink surfaces: background `#10151e`, chrome `#181f2b`, floating surface `#232d3b`, selection `#2a3e59`, muted text `#a8b2c2`. Primary interaction blue and terminal tokens remain unchanged. Theme/contract/settings tests passed (13), including sampled muted-text contrast checks at 4.5:1 and luminance ordering. These raw-token checks are not a full contrast audit.
- Source Tauri development app was launched (`target/debug/skd`, Vite 1420, WebSocket 9001). Captured `/tmp/skd-design-source.png` and `/tmp/skd-design-popover-after.png`; these are local temporary artifacts, not checked-in baselines. The image tool could not expose image contents to this model, so neither the active palette nor visible popover state was verified. Human visual approval remains pending. An installed `/Applications/skd.app` is not proof of current source changes.
- Batch 1 shared primitives: menus/submenus use 8px corners and matching medium shadows; dialogs use 12px corners and the popover surface; inputs/selects/textareas use opaque input-background; buttons use semantic destructive foregrounds. UI controls target 13px; component-specific overrides remain for later batches.
- Tooltip has a 400ms default hover delay, honors the nearest shared provider, uses neutral surfaces and bounded wrapping, and retains focus/Escape interaction. Three real-Radix DOM/interaction tests pass (only ResizeObserver is stubbed for jsdom).
- Full suite after primitive changes: 698 passed / 7 skipped. Build passed; ESLint 0 errors / 180 warnings. Three additional control regressions then passed, covering opaque field styling/callbacks, disabled destructive actions and dialog close semantics. CSS class assertions do not demonstrate computed layout or rendered accessibility.

## Batch 1 human review gate

In the source development window, select dark Midnight without changing the terminal theme. Inspect a menu with submenu, preferences dialog, input fields and a long tooltip. Confirm compact readability, distinct floating surfaces, visible keyboard focus, hover timing, and unchanged terminal colors. Repeat in light, Graphite and Nordic. The user provisionally accepted the direction and requested a more refined tone. The resulting cool-ink refinement still needs visual confirmation.

## Batch 2 implementation and review gate

- Settings now uses seven vertical Radix tabs, keyboard arrow navigation, a stable 85vh dialog and independently scrolling content. Save/cancel behavior is unchanged; nested card frames and scroll-arrow gradients are removed.
- Connection form keeps Connection / Proxy / Advanced separation and existing authentication fields. Header and footer are quieter, descriptions are outside heading markup, and nested card frames are removed. Authentication logic is unchanged.
- Welcome screen provides two native-button actions (new connection and preferences), without the nonfunctional connection-manager card, duplicate primary action or decorative gradient.
- Compose failures remain visible inline; drafts survive failed sends and a successful retry clears the error. Composition events do not submit. Transfer arrival no longer forces disclosure open; failed counts remain visible while collapsed, error details wrap, and clear/disclosure buttons are separate.
- Verification: 706 tests passed / 7 skipped; production build passed; ESLint 0 errors / 180 warnings; `git diff --check` clean. jsdom canvas and bundle-size warnings remain. DOM tests are not rendered-layout verification.

The user accepted Batch 2 ("不错。继续"). This is not acceptance of the subsequent workspace changes.

## Batch 3 — workspace implementation

- Transfer queue supporting text is 12px; clear/retry/cancel/open controls are 24px high, icon actions have explicit accessible names, and summary counters wrap. Retry/cancel dispatch and retained failure details have DOM regression coverage.
- File browser separates path navigation from file actions/filtering into two toolbar rows. Path and filter use opaque input surfaces; action row can wrap. Existing upload, search, navigation and tree tests pass. No transfer or filesystem logic changed.
- Compose header wraps and uses the toolbar surface. Compose hints, monitoring empty state, editor status, new-tab hints and log metadata use 12px supporting text. Terminal font settings are untouched.
- Log filter chips use bounded color transitions and a keyboard focus ring; line numbers no longer reduce muted text opacity.

## Batch 4 — verification and remaining gaps

Final source verification: **707 passed / 7 skipped** (77 test files passed, 1 skipped); production build passed; ESLint **0 errors / 180 warnings**; `git diff --check` clean. Existing jsdom canvas and >500kB bundle warnings remain. No native release build or live remote-session test was performed.

Raw token audit (not composited/rendered contrast):

| Theme | Main text on background | Muted on popover | Muted on selected surface |
| --- | --- | --- | --- |
| Light | 17.85 | 4.76 | **4.15** |
| Graphite | 15.54 | 5.69 | **4.39** |
| Midnight | 15.69 | 6.50 | 5.08 |
| Nordic | 13.21 | 5.19 | **4.01** |

Known unresolved findings: light muted text on hover is 4.34; light destructive/success/warning on white are 3.76/2.28/2.15. These are below 4.5 for small text. Existing muted text on selected surfaces also needs a targeted follow-up in light/Graphite/Nordic. No accessibility conformance claim is made.

Code inspection also found follow-up gaps outside this frozen batch: the path editor is mouse-only to enter and lacks an explicit name/IME guard; several log inputs/icon actions need explicit accessible names and state labels. Reduced-motion coverage is partial (some spinners/overlay animations remain). DOM tests cover settings arrow navigation, Tooltip focus/Escape, Compose composition guard, file-filter composition/Escape, and queue actions—not all keyboard paths.

The source development app was not running at final verification. No new native screenshots or minimum-window layout measurements were captured. Final manual review remains pending:

1. Inspect the two file-browser toolbars with long paths/names and a narrow panel; confirm navigation, filtering and upload controls stay reachable.
2. Inspect queued/transferring/failed/completed states; expand/collapse, clear, retry and cancel.
3. Check Compose and log controls at narrow width, keyboard focus and disconnected/empty states.
4. Repeat representative surfaces in light, Midnight, Graphite and Nordic, and with reduced motion enabled.

Batch 3/4 delivery is awaiting this user confirmation. Source changes remain uncommitted; no user profiles, layouts or terminal ANSI palettes were rewritten.

## On-demand filter (post-review change)

Per the user's review feedback, the file-browser filter is no longer always visible. A Filter button toggles it: opening focuses the field, hiding clears the current term, and pressing the button again hides it. Escape first clears the term, then hides on a second press; the X button inside the field only clears the term and keeps focus. IME composition is still guarded and the collapsed list is never silently filtered.

Verification after this change: **708 passed / 7 skipped**; production build passed; ESLint 0 errors / 180 warnings; `git diff --check` clean. Filter interaction is covered by DOM tests (collapse-by-default, focus on open, clear-on-hide, Escape/composition); rendered behavior still needs visual review alongside the batch 3/4 checkpoints above.

Per follow-up review, the filter and upload actions were merged back into the single navigation toolbar (new folder, upload, filter, then the on-demand filter field and item counts). The second row was removed. The same DOM suite passes and the full suite stands at 708 passed / 7 skipped with build, lint (0 errors) and diff checks clean.

## HIG follow-up — implementation, not native conformance

See [Apple source notes and per-area checklist](hig-macos-audit-notes.md). HIG principles informed the changes; our CSS colors, pixel sizes and radii are product decisions, not universal Apple requirements. Fixed CSS colors do not follow the user's native accent setting, and opaque surfaces do not implement native vibrancy.

| Area | Code review disposition |
| --- | --- |
| Window/menu/tab chrome | Retain existing compact layout and native menu integration; do not add decorative tint or alter shortcuts. Minimum-window and long-tab layout still require native review. |
| Connections sidebar | Separate selected surface from hover. Use neutral protocol icons rather than success/warning colors for connection types; preserve connection-state dots and details. Section heading is 12px semibold. Disclosure is a named, focusable native button with `aria-expanded`, and selects/toggles once. Stable default active-connections reference prevents rerenders from resetting disclosure state. |
| File browser | Increase shared list text from 11px/16px to 13px/18px; keep chrome at 12px. Preserve on-demand filter, upload and selection behavior. Path editing now has a named, focusable edit button, composition guards and keyboard focus restoration (second pass below). Rename focus remains a follow-up. |
| Terminal/Compose | Preserve terminal tokens, ANSI/font preferences and input behavior. Existing inline failure feedback retained. Compose's suppressed textarea ring still needs a dedicated focus treatment review. |
| Dialogs/settings/welcome | Retain existing scrolling, vertical tab navigation and compact 13px controls. Shared field focus uses opaque semantic ring color; validation retains its border and `aria-invalid`. |
| Menus/popovers | Controls 5px, menus 8px, dialogs 6px; no global fake glass. |
| Transfers/status/monitoring/logs | Retain text/icon state descriptions and persistent failures. Light semantic colors strengthened. Log accessible naming and motion gaps are not resolved by this pass. |

### Color changes and measured evidence

Midnight surfaces and all terminal CSS tokens remain unchanged from the pre-HIG index. Graphite muted text is now `#98a2b2`; Nordic `#b2bcc9`; light `#566579`. Light success/warning/destructive now use `#197447` / `#946000` / `#c93430` with matching status tokens. Accent colors retain theme identity rather than copying system-color samples. Chart series were not recolored.

Raw opaque muted-text/selected-surface contrast: light **5.19**, Graphite **4.72**, Midnight **5.08**, Nordic **4.68**. Light supporting and semantic text passes 4.5:1 across sampled background/card/popover/selected/hover surfaces, and semantic filled-control foreground pairs pass too. These supersede the earlier light and muted-selection findings above, not all contrast findings.

First-pass findings (resolved by the second pass below): dark destructive text on selected surfaces was Graphite **4.26**, Midnight **3.80**, Nordic **3.14**; Nordic success on selection was **4.38**. Opacity overrides, compositing, actual focus-ring contrast, nontext borders and every chart series still need rendered assessment. No WCAG or HIG compliance claim.

### Verification and human review gate

- Full suite: **729 passed / 7 skipped** (78 passed files / 1 skipped); Connections disclosure/selection suite: **4 passed**.
- Production build passed; ESLint **0 errors / 180 warnings**; `git diff --check` clean. Existing jsdom canvas and bundle-size warnings remain.
- New coverage checks opaque semantic focus, preserved control sizes/callbacks, disclosure state and selection styling, file typography tokens, and sampled palette contrast. Native Enter/Space synthesis and VoiceOver are not proven by jsdom click tests.
- No commits created. Existing staged work preserved.

In `bun run tauri dev`, check light plus all three dark palettes: (1) focus input/select/destructive controls with Tab, (2) toggle Connections folders with Enter/Space and verify selection differs from hover, (3) inspect 13px file rows, long paths and toolbar overflow in a narrow pane, (4) check settings/dialog scroll and footer reachability, (5) compare terminal colors with prior appearance, (6) review status/error text and VoiceOver names. **Human visual acceptance remains pending.**

## HIG second pass — targeted remediation

No surface-palette redesign or further typography/layout changes. Frozen semantic adjustments: Graphite destructive `#f58289`, Midnight destructive `#f5989f`, Nordic destructive `#f6a5ab` and Nordic success `#61cfa2`. Dark connected/connecting/disconnected status tokens now reference success/warning/destructive respectively. Pending, terminal and chart colors are unchanged in this pass.

The palette contract now checks success/warning/destructive text against background, card, popover, selected and hover surfaces, plus their filled-control foreground pairs, at **≥4.5:1** for all three dark palettes. These are opaque token calculations, not rendered compositing measurements or a conformance claim.

Path editing retains breadcrumbs and pointer entry, and adds a translated **Edit path** button outside the scrolling breadcrumb area. The input has an accessible name; Enter submits once, Escape cancels, and either returns focus to the edit button. Composition Enter/Escape (including keyCode 229) is ignored. Blur retains the existing submit behavior without reclaiming focus. Three new DOM tests cover these behaviors; native Tab/Enter/Space synthesis and actual IME behavior still require WKWebView review. Inline rename was not changed.

Second-pass verification:
- Full suite: **735 passed / 7 skipped** (78 passed files / 1 skipped).
- Production frontend build passed; ESLint **0 errors / 180 warnings**. Existing canvas and >500 kB bundle warnings remain.
- Sidebar/list/typography targeted suite: **33 passed**; controls/sidebar/file-browser combined suite: **47 passed**.
- Keep 13px list text / 12px chrome and the first-pass sidebar selection/disclosure behavior; no further layout changes.

Additional manual gate: in light and all dark palettes, Tab to Edit path, activate it with Enter/Space, enter a path using IME, submit/cancel, and verify focus return; Tab away and verify focus is not stolen. Check a long path in a narrow pane, semantic text on selected rows, VoiceOver naming and the previously specified minimum-window sizes. Log-control naming, Compose focus treatment, rename focus, partial reduced-motion coverage, system-accent adaptation and native vibrancy remain outside this pass. No commit was created during this pass; **human visual acceptance is still pending**.
