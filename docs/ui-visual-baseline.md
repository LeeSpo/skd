# skd Visual Baseline

Updated 2026-10-08 against the current workspace, shared styles, and dialogs. This document records the implemented UI for future changes. Use [globals.css](../src/styles/globals.css) for the stylesheet import order and the files below for exact tokens and behavior.

## Stylesheet Ownership and Cascade

The application imports Tailwind first, then the app-owned stylesheet entry. App-owned rules remain unlayered: changing them to Tailwind layers would change their precedence. Keep the explicit import order in `globals.css`; shared defaults precede feature overrides, and accessibility overrides run last.

| Stylesheet | Responsibility |
| --- | --- |
| [tokens.css](../src/styles/tokens.css) | Default semantic colors, typography, geometry, shadows, and material tokens. |
| [palettes.css](../src/styles/palettes.css) | Existing light/dark palette overrides, including the system accent fallback. |
| [base.css](../src/styles/base.css) | Document defaults, existing animations and transitions, scrollbars, focus, selection, and CodeMirror sizing. |
| [controls.css](../src/styles/controls.css) | Shared control decoration, panel defaults, menus, sheets, resize cursors, shortcuts, and toasts. |
| [workspace.css](../src/styles/workspace.css) | Window chrome, sidebar, titlebar tabs, bottom panels, and active/material states. |
| [file-browser.css](../src/styles/file-browser.css) | File typography, toolbars, columns, rows, active panes, and file/transfer/compose footers. |
| [dialogs.css](../src/styles/dialogs.css) | Settings and connection dialog overrides. |
| [inspector.css](../src/styles/inspector.css) | Inspector controls, cards, tables, and Radix/Recharts width containment. |
| [motion.css](../src/styles/motion.css) | Shared opacity-only entry/exit animations for dialogs and floating controls. |
| [accessibility.css](../src/styles/accessibility.css) | Reduced-motion and increased-contrast overrides. |
| [terminal.css](../src/styles/terminal.css) | xterm overrides, imported by `PtyTerminal` immediately after the vendor stylesheet. |

Keep ordinary geometry in Tailwind and shared primitive variants. Feature CSS should use the existing feature root classes to express contextual overrides. Runtime values such as column widths, split proportions, indentation, progress, and user backgrounds stay in inline styles. The shared 13px/11px/22px font-size classes use existing tokens without adding line-height changes.

Terminal scrollbar and image states belong to each container's `data-scrollable` and `data-background-image` attributes. `:where()` preserves the specificity of the former instance-scoping class. No per-instance `<style>` elements are needed. Keep the image overrides for xterm's inline backgrounds, including its IME textarea.

The stylesheet cleanup preserved effective rendering and removed unused tokens, obsolete status classes, undefined font-size references, unused animation definitions, and candidates confirmed to generate no CSS under Tailwind 3. Floating-surface animations were added separately as described below; menu height limits remain unchanged. Existing ambiguous `focus-visible:shadow-[var(--focus-ring)]` classes remain because their generated custom properties can still affect rendering; correcting them is a separate behavior change.

## Workspace Layout

| Area | Current baseline |
| --- | --- |
| Window | Default 1280×800; minimum 960×600. Native traffic lights retain an 80px clearance in the titlebar. |
| Titlebar | One 44px toolbar. Workspace pages appear as 28px rounded tab capsules, with a new-session menu and panel, Zen, port-forwarding, and settings controls. Blank space remains draggable; controls are excluded. |
| Split sessions | A split page shows its visible session names within one titlebar capsule. Selecting a name focuses that pane; selecting another page restores its layout. Pane tab bars stay hidden while the titlebar slot exists. |
| Connections | Full-height sidebar, resizable between 200–360px. Compact header actions, search, local-terminal entry, folders, connection rows, and collapsible connection details. Selected rows use a neutral wash distinct from hover. |
| Tools | Files and Compose occupy the resizable bottom panel with a 40px header. Monitor and Logs occupy a solid right inspector, sized for 280–420px with narrow-window percentage limits. There is no global bottom status bar. |
| Files | One 40px navigation/action toolbar, optional filter row, 28px column headers and file rows, and a local item-count footer. Column visibility is user-controlled. Dual-pane file views identify the active panel with an accent line and label. |
| Welcome | App icon, name/version, connection and local-terminal actions, preferences shortcut, and recent connections when available. |

Implementation: [workspace layout](../src/components/workspace-layout.tsx), [titlebar tabs](../src/components/terminal/workspace-tab-bar.tsx), [app panels](../src/App.tsx), and [file browser](../src/components/integrated-file-browser.tsx).

## Typography, Controls, and Palettes

Use the system sans-serif stack for chrome and the user's selected fonts for terminal/editor content. Shared controls use 13px text, generally 28px height; compact buttons use 24px. File chrome uses 12px/16px, file-list text 13px/18px. Reuse shared primitives, semantic colors, focus styles, and radius/shadow tokens.

Command menu items share `.command-menu-item` styles in `controls.css`. Radix's `data-highlighted` state and an open submenu trigger use `--primary` with `--primary-foreground`; icons, checkmarks, arrows, and shortcuts follow the item's foreground. Disabled items retain their 50% opacity and do not gain a highlight. Deletion and Move to Trash actions use `variant="destructive"`, with matching text/icons and a highlighted background mixing 10% destructive color in Light or 20% in Dark. Keep these colors in the shared styles rather than feature-level overrides; menu widths, text sizes, and padding remain unchanged.

System is the default palette and receives the macOS accent through the appearance bridge. Graphite, Midnight, Nordic, and Cupertino retain their fixed accents. Light/Dark/Auto is a separate setting. Preferences preview appearance changes; Cancel restores the original mode and palette.

Terminal presets, ANSI colors, and fonts remain separately configurable. Default/recommended terminal backgrounds can harmonize with the workspace palette; preserve explicitly selected presets.

## Materials and Surface Hierarchy

- The main window has AppKit sidebar material behind its transparent webview. Sidebar and titlebar share the effective `--sidebar-tint`; the right inspector uses opaque sidebar color.
- Enable native translucency only with `data-native-material="true"`. Browser previews, bridge failures, Reduce Transparency, and Increase Contrast use opaque chrome. Inactive windows use quieter selection and controls.
- Terminal backgrounds are opaque by default. Optional transparency affects the background rather than text opacity and uses the canvas renderer. Bottom tools and the inspector remain solid.
- Right-click command menus, button dropdown command menus, and both kinds of submenus use `.command-menu-surface`. Their separate `--material-command-menu` mixes 92% `--popover` with transparency and uses the shared `blur(24px) saturate(180%)` filter only when native material is enabled. Otherwise they use opaque `--popover` with no backdrop filter. The element's opacity stays unchanged so text remains readable.
- Selects, popovers (including the new-session search), tooltips, and toasts retain `.glass-menu` and its 72% material with an opaque fallback. Sheets use `.macos-sheet` without backdrop blur; settings and connection dialogs override it with opaque `--popover`.

See [appearance bridge](../src/lib/use-window-appearance.ts), [terminal appearance](../src/lib/terminal-config.ts), and [window configuration](../src-tauri/tauri.conf.json).

## Dialogs and Interaction

Settings uses vertical category navigation, grouped fields, a scrollable content area, and fixed Reset/Cancel/Save actions. Connection setup uses Connection/Advanced tabs, a 680px maximum width, bounded height, and fixed actions. Use viewport-safe Tauri positioning and explicit heights for scrolling flex children. Preserve the light scrim and restrained shadows.

Dialogs and their scrims fade in over 150ms and out over 100ms. Menus, submenus, popovers, selects, and tooltips fade in over 100ms and out over 75ms. These opacity-only animations preserve positioning and text scale and run only without Reduce Motion. Tooltip's 400ms hover delay is unchanged. Connection and port-forward dialogs stay mounted through Radix's exit/focus-restoration lifecycle, then unmount so the next opening starts with fresh form state. Terminal geometry, panel toggles, and existing tab/progress animations are unchanged.

Keep tab portal hosts stable during dragging and panel changes. Preserve terminal mounts, IME input, directory-following, filter clearing, transfer feedback, and keyboard focus. Icon actions need accessible names; state feedback includes text or icons alongside color. Respect reduced motion and increased contrast.

## Review Checklist

For UI changes, inspect `bun run tauri dev` at normal and minimum window sizes:

- Check Light/Dark/Auto, relevant palettes, inactive windows, and opaque accessibility fallbacks.
- Exercise single/split pages, sidebar and tool toggles, long names/paths, and dialog scrolling/footer access.
- Check keyboard focus, IME input, empty/disconnected/error states, and transfer progress.
- Verify rendered contrast where colors or materials change; token calculations alone do not establish visual acceptance.

The CSS cleanup compared 32 fixed-DOM before/after browser fixtures with identical computed styles and geometry. These cover five palettes in Light/Dark at 1280×800 and 960×600, terminal preferences and connection dialogs, native-material/inactive-window attributes, and forced reduced-motion/increased-contrast media blocks. Keyboard focus in the connection form also matched. Four xterm fixtures covered all combinations of scrollability and background images, including scrollbar pseudo-element styling and inline-background overrides.

All 640 frontend tests passed, including new regressions for per-terminal state isolation and session preservation. The frontend build passed; lint reported zero errors and the existing 175 warnings. Browser fixture checks simulate attributes and media rules; native AppKit material, operating-system accessibility preferences, live SSH/SFTP, VoiceOver, and populated remote file/monitor states were not exercised. Implementation history remains in Git.

The command-menu unification on 2026-10-08 checked 40 paired WebKit fixtures: five palettes × Light/Dark × native material/browser fallback/Reduce Transparency/Increase Contrast attributes. All four command menu surfaces matched their shared material and decoration; normal highlights, destructive highlights, icons, shortcuts, and disabled states matched their semantic colors. Geometry remained identical, and the select, popover, tooltip, and toast surface fixtures retained their previous computed styles. Each case included light, dark, blue, and gradient-image backdrops. Live Radix fixtures also exercised keyboard navigation past disabled items, checkbox/radio highlights, both kinds of submenu, command selection, Escape, and focus restoration. All 653 frontend tests and the build passed; lint reported zero errors and 173 warnings. Native appearance/accessibility flags were simulated; the actual AppKit material and operating-system preference changes were not exercised.
