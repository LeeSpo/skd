/// Write text directly to the macOS pasteboard without WebKit user-activation
/// restrictions. The caller dispatches this operation to the AppKit main thread.
#[cfg(target_os = "macos")]
pub fn write_text(text: &str) -> anyhow::Result<()> {
    write_to_pasteboard(&objc2_app_kit::NSPasteboard::generalPasteboard(), text)
}

#[cfg(target_os = "macos")]
fn write_to_pasteboard(pasteboard: &objc2_app_kit::NSPasteboard, text: &str) -> anyhow::Result<()> {
    use objc2_app_kit::NSPasteboardTypeString;
    use objc2_foundation::NSString;

    let text = NSString::from_str(text);
    pasteboard.clearContents();
    // SAFETY: AppKit provides this immutable, process-lifetime string constant.
    let text_type = unsafe { NSPasteboardTypeString };
    anyhow::ensure!(
        pasteboard.setString_forType(&text, text_type),
        "Failed to write text to the system clipboard"
    );
    Ok(())
}

/// Read text for an explicit user paste without WebKit's confirmation popover.
/// The caller dispatches this operation to the AppKit main thread.
#[cfg(target_os = "macos")]
pub fn read_text() -> anyhow::Result<String> {
    Ok(read_from_pasteboard(
        &objc2_app_kit::NSPasteboard::generalPasteboard(),
    ))
}

#[cfg(target_os = "macos")]
fn read_from_pasteboard(pasteboard: &objc2_app_kit::NSPasteboard) -> String {
    // SAFETY: AppKit provides this immutable, process-lifetime string constant.
    let text_type = unsafe { objc2_app_kit::NSPasteboardTypeString };
    pasteboard
        .stringForType(text_type)
        .map(|value| value.to_string())
        .unwrap_or_default()
}

#[cfg(not(target_os = "macos"))]
pub fn read_text() -> anyhow::Result<String> {
    anyhow::bail!("Native clipboard reading is only supported on macOS")
}

#[cfg(not(target_os = "macos"))]
pub fn write_text(_text: &str) -> anyhow::Result<()> {
    anyhow::bail!("Native clipboard writing is only supported on macOS")
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::{read_from_pasteboard, write_to_pasteboard};
    use objc2_app_kit::NSPasteboard;

    #[test]
    fn writes_unicode_and_replaces_previous_pasteboard_contents() {
        // Exercise the real pasteboard service without changing the user's clipboard.
        let pasteboard = NSPasteboard::pasteboardWithUniqueName();
        for text in ["old contents", "Codex response\n远端复制 🦀", ""] {
            write_to_pasteboard(&pasteboard, text).expect("pasteboard write should succeed");
            assert_eq!(read_from_pasteboard(&pasteboard), text);
        }
        pasteboard.clearContents();
        assert_eq!(read_from_pasteboard(&pasteboard), "");
    }
}
