use serde::Serialize;

/// Native appearance inputs the web chrome cannot read on its own.
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowAppearance {
    pub reduce_transparency: bool,
    pub increase_contrast: bool,
    /// The user's macOS accent colour as `#rrggbb` (sRGB), when resolvable.
    pub accent_color: Option<String>,
}

/// Formats sRGB components in `0.0..=1.0` as a CSS hex colour.
fn to_hex(red: f64, green: f64, blue: f64) -> String {
    let channel = |value: f64| (value.clamp(0.0, 1.0) * 255.0).round() as u8;
    format!("#{:02x}{:02x}{:02x}", channel(red), channel(green), channel(blue))
}

#[cfg(target_os = "macos")]
fn accent_color() -> Option<String> {
    use objc2_app_kit::{NSColor, NSColorSpace};
    let color = NSColor::controlAccentColor().colorUsingColorSpace(&NSColorSpace::sRGBColorSpace())?;
    Some(to_hex(
        color.redComponent() as f64,
        color.greenComponent() as f64,
        color.blueComponent() as f64,
    ))
}

/// Called on the AppKit main thread, both by the query and the notifications.
pub fn appearance() -> WindowAppearance {
    #[cfg(target_os = "macos")]
    {
        let workspace = objc2_app_kit::NSWorkspace::sharedWorkspace();
        WindowAppearance {
            reduce_transparency: workspace.accessibilityDisplayShouldReduceTransparency(),
            increase_contrast: workspace.accessibilityDisplayShouldIncreaseContrast(),
            accent_color: accent_color(),
        }
    }
    #[cfg(not(target_os = "macos"))]
    WindowAppearance::default()
}

/// Emits `window-appearance-changed` when accessibility display options or
/// system colours (including the accent colour) change.
pub fn observe_appearance(app: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    {
        use block2::RcBlock;
        use objc2::{rc::Retained, runtime::ProtocolObject};
        use objc2_app_kit::{
            NSSystemColorsDidChangeNotification, NSWorkspace,
            NSWorkspaceAccessibilityDisplayOptionsDidChangeNotification,
        };
        use objc2_foundation::{
            NSNotification, NSNotificationCenter, NSObjectProtocol, NSOperationQueue,
        };
        use std::{cell::RefCell, ptr::NonNull};
        use tauri::Emitter;

        thread_local! {
            // The notification centers retain the block; retain the tokens for
            // the lifetime of the application's main thread.
            static OBSERVERS: RefCell<Vec<Retained<ProtocolObject<dyn NSObjectProtocol>>>> = const { RefCell::new(Vec::new()) };
        }

        let app = app.clone();
        let block = RcBlock::new(move |_: NonNull<NSNotification>| {
            if let Err(error) = app.emit_to("main", "window-appearance-changed", appearance()) {
                tracing::warn!("Failed to emit window appearance change: {error}");
            }
        });
        let queue = NSOperationQueue::mainQueue();
        let workspace_center = NSWorkspace::sharedWorkspace().notificationCenter();
        let default_center = NSNotificationCenter::defaultCenter();
        let observers = unsafe {
            [
                workspace_center.addObserverForName_object_queue_usingBlock(
                    Some(NSWorkspaceAccessibilityDisplayOptionsDidChangeNotification),
                    None,
                    Some(&queue),
                    &block,
                ),
                default_center.addObserverForName_object_queue_usingBlock(
                    Some(NSSystemColorsDidChangeNotification),
                    None,
                    Some(&queue),
                    &block,
                ),
            ]
        };
        OBSERVERS.with(|slot| slot.borrow_mut().extend(observers));
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

#[cfg(test)]
mod tests {
    use super::to_hex;

    #[test]
    fn formats_srgb_components_as_hex() {
        assert_eq!(to_hex(0.0, 0.478_431, 1.0), "#007aff");
        assert_eq!(to_hex(1.2, -0.1, 0.5), "#ff0080");
    }
}
