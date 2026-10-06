# skd Visual Baseline

Updated 2026-10-06 against the current workspace, shared styles, and dialogs. This document records the implemented UI for future changes. Use [globals.css](../src/styles/globals.css) and the linked components as the source of exact tokens and behavior.

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

System is the default palette and receives the macOS accent through the appearance bridge. Graphite, Midnight, Nordic, and Cupertino retain their fixed accents. Light/Dark/Auto is a separate setting. Preferences preview appearance changes; Cancel restores the original mode and palette.

Terminal presets, ANSI colors, and fonts remain separately configurable. Default/recommended terminal backgrounds can harmonize with the workspace palette; preserve explicitly selected presets.

## Materials and Surface Hierarchy

- The main window has AppKit sidebar material behind its transparent webview. Sidebar and titlebar share the effective `--sidebar-tint`; the right inspector uses opaque sidebar color.
- Enable native translucency only with `data-native-material="true"`. Browser previews, bridge failures, Reduce Transparency, and Increase Contrast use opaque chrome. Inactive windows use quieter selection and controls.
- Terminal backgrounds are opaque by default. Optional transparency affects the background rather than text opacity and uses the canvas renderer. Bottom tools and the inspector remain solid.
- Menus, popovers, tooltips, and toasts use `.glass-menu` with an opaque fallback. Sheets use `.macos-sheet` without backdrop blur; settings and connection dialogs override it with opaque `--popover`.

See [appearance bridge](../src/lib/use-window-appearance.ts), [terminal appearance](../src/lib/terminal-config.ts), and [window configuration](../src-tauri/tauri.conf.json).

## Dialogs and Interaction

Settings uses vertical category navigation, grouped fields, a scrollable content area, and fixed Reset/Cancel/Save actions. Connection setup uses Connection/Advanced tabs, a 680px maximum width, bounded height, and fixed actions. Use viewport-safe Tauri positioning and explicit heights for scrolling flex children. Preserve the light scrim and restrained shadows.

Keep tab portal hosts stable during dragging and panel changes. Preserve terminal mounts, IME input, directory-following, filter clearing, transfer feedback, and keyboard focus. Icon actions need accessible names; state feedback includes text or icons alongside color. Respect reduced motion and increased contrast.

## Review Checklist

For UI changes, inspect `bun run tauri dev` at normal and minimum window sizes:

- Check Light/Dark/Auto, relevant palettes, inactive windows, and opaque accessibility fallbacks.
- Exercise single/split pages, sidebar and tool toggles, long names/paths, and dialog scrolling/footer access.
- Check keyboard focus, IME input, empty/disconnected/error states, and transfer progress.
- Verify rendered contrast where colors or materials change; token calculations alone do not establish visual acceptance.

This revision inspected the source browser preview's workspace, settings, and connection dialog. Native material, live SSH/SFTP, VoiceOver, and full palette/minimum-size review were not verified in this documentation pass. Prior test totals and historical review gates are omitted; implementation history remains in Git.
