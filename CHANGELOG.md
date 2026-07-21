# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.1] - 2026-07-21

### Added

- **Terminal CWD Tracking**: Added support for shell working directory synchronization via OSC 7 / OSC 633 / OSC 1337 sequences, allowing the integrated file browser to automatically follow terminal navigation.
- **Connection Attempt & Diagnostic Tracking**: Added real-time connection progress tracking and diagnostic reporting modal for SSH connection attempts.

### Changed

- **UI Component Pruning**: Removed unused UI primitives, redundant components, and obsolete dependencies to clean up codebase footprint.

### Fixed

- **Terminal Layout Instance Persistence**: Fixed terminal instances being re-created or losing active state during grid splits and panel layout transitions.
- **Drop Zone Overlay Preview**: Adjusted tab drag drop zone overlay geometry to accurately match half-pane split boundaries.


## [0.2.0] - 2026-07-13

### Added

- **SSH Port Forwarding & Bookmark Management**: Added local SSH port forwarding, bookmark management, health checks, and active connection diagnostics.
- **Theme Palettes & Custom Styling**: Added configurable application color palettes with live preview and persisted settings.
- **Granular Keychain Access**: Added credential-specific storage and recovery for SSH passwords and private-key passphrases.
- **Global Tab Drag-and-Drop State**: Refactored tab drag-and-drop state for smoother tab movement and group splitting.

### Changed

- **Terminal Session Buffer Limit**: Increased the active session output limit from 2 MB to 32 MB.

### Fixed

- Improved WebSocket reconnect reliability, SFTP file-operation errors, and connection lifecycle diagnostics.

## [0.1.2] - 2026-07-07

### Added

- macOS Keychain integration for SSH passwords and private-key passphrases.
- SSH private-key authentication and interactive host-key verification.
- Asynchronous, cancellable SSH connection attempts with progress reporting.
- A local file browser alongside the remote SFTP browser.
- Modular CPU, memory, disk, network, and process monitoring panels.
- A terminal compose pane for drafting and sending commands.
- Automatic connection naming, window-size persistence, and release DMG workflows.

### Changed

- Removed obsolete session-restoration and security-note UI code.
- Replaced file-browser selection polling with callback-based tracking.
- Hid panel actions that do not apply to local shell sessions.

## [0.1.0] - 2026-06-28

### Changed

- Rebranded the application from R-Shell to **skd**.
- Reset the project version to `0.1.0`.
- Rewrote the README for the SSH/SFTP/local-shell product focus.
- Standardized local storage keys on the `skd-*` prefix without migrating old keys.
- Disabled the auto-updater until a project-specific release feed and signing keys are configured.
- Preserved upstream attribution in [LICENSE](LICENSE) and [NOTICE](NOTICE).
