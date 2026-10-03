use serde::Serialize;

#[derive(Clone, Copy, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowAccessibility {
    pub reduce_transparency: bool,
}

/// Called on the AppKit main thread, both by the query and the notification.
pub fn accessibility() -> WindowAccessibility {
    #[cfg(target_os = "macos")]
    {
        WindowAccessibility {
            reduce_transparency: objc2_app_kit::NSWorkspace::sharedWorkspace()
                .accessibilityDisplayShouldReduceTransparency(),
        }
    }
    #[cfg(not(target_os = "macos"))]
    WindowAccessibility::default()
}

pub fn observe_accessibility(app: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    {
        use block2::RcBlock;
        use objc2::{rc::Retained, runtime::ProtocolObject};
        use objc2_app_kit::{
            NSWorkspace, NSWorkspaceAccessibilityDisplayOptionsDidChangeNotification,
        };
        use objc2_foundation::{NSNotification, NSObjectProtocol, NSOperationQueue};
        use std::{cell::RefCell, ptr::NonNull};
        use tauri::Emitter;

        thread_local! {
            // The notification center retains the block; retain its token for
            // the lifetime of the application's main thread.
            static OBSERVER: RefCell<Option<Retained<ProtocolObject<dyn NSObjectProtocol>>>> = const { RefCell::new(None) };
        }

        let app = app.clone();
        let block = RcBlock::new(move |_: NonNull<NSNotification>| {
            if let Err(error) = app.emit_to("main", "window-accessibility-changed", accessibility())
            {
                tracing::warn!("Failed to emit window accessibility change: {error}");
            }
        });
        let center = NSWorkspace::sharedWorkspace().notificationCenter();
        let observer = unsafe {
            center.addObserverForName_object_queue_usingBlock(
                Some(NSWorkspaceAccessibilityDisplayOptionsDidChangeNotification),
                None,
                Some(&NSOperationQueue::mainQueue()),
                &block,
            )
        };
        OBSERVER.with(|slot| *slot.borrow_mut() = Some(observer));
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}
