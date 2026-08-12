use crate::connection_manager::ConnectionManager;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::AppHandle;

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeDragItem {
    pub mode: String,
    pub connection_id: Option<String>,
    pub name: String,
    pub path: String,
    pub is_directory: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeDragResponse {
    pub started_count: usize,
    pub skipped_directories: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeDragErrorPayload {
    name: String,
    error: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct NativeDragPlan {
    exportable: Vec<NativeDragItem>,
    skipped_directories: Vec<String>,
}

fn build_native_drag_plan(items: Vec<NativeDragItem>) -> Result<NativeDragPlan, String> {
    if items.is_empty() {
        return Err("At least one drag item is required".to_string());
    }

    let mut exportable = Vec::new();
    let mut skipped_directories = Vec::new();
    for item in items {
        if item.name.is_empty() || item.name == "." || item.name == ".." {
            return Err(
                "Drag item names must be non-empty and cannot be navigation entries".to_string(),
            );
        }
        if item.path.is_empty() {
            return Err(format!("Drag item '{}' has an empty path", item.name));
        }
        match item.mode.as_str() {
            "local" => exportable.push(item),
            "remote" if item.is_directory => skipped_directories.push(item.name),
            "remote" => {
                if item.connection_id.as_deref().unwrap_or_default().is_empty() {
                    return Err(format!(
                        "Remote drag item '{}' requires a connection ID",
                        item.name
                    ));
                }
                exportable.push(item);
            }
            _ => return Err(format!("Unsupported drag mode '{}'", item.mode)),
        }
    }

    if exportable.is_empty() {
        return Err("Remote directories cannot be exported to Finder".to_string());
    }

    Ok(NativeDragPlan {
        exportable,
        skipped_directories,
    })
}

fn promised_destination(directory: &Path, name: &str) -> Result<PathBuf, String> {
    if name.is_empty() || name == "." || name == ".." || name.contains('/') || name.contains('\\') {
        return Err("Invalid promised file name".to_string());
    }
    Ok(directory.join(name))
}

async fn write_remote_promise_with<F, Fut>(
    directory: &Path,
    item: &NativeDragItem,
    downloader: F,
) -> Result<PathBuf, String>
where
    F: FnOnce(String, String, PathBuf) -> Fut,
    Fut: std::future::Future<Output = Result<(), String>>,
{
    let destination = promised_destination(directory, &item.name)?;
    let connection_id = item
        .connection_id
        .clone()
        .ok_or_else(|| "Remote drag item requires a connection ID".to_string())?;
    downloader(connection_id, item.path.clone(), destination.clone()).await?;
    Ok(destination)
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use block2::DynBlock;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, ProtocolObject};
    use objc2::{define_class, msg_send, AnyThread, DefinedClass, MainThreadOnly};
    use objc2_app_kit::{
        NSApplication, NSDragOperation, NSDraggingContext, NSDraggingItem, NSDraggingSession,
        NSDraggingSource, NSFilePromiseProvider, NSFilePromiseProviderDelegate,
        NSPasteboardWriting, NSView, NSWindow, NSWorkspace,
    };
    use objc2_foundation::{
        MainThreadMarker, NSArray, NSError, NSObject, NSObjectProtocol, NSOperationQueue, NSPoint,
        NSRect, NSSize, NSString, NSURL,
    };
    use std::cell::RefCell;
    use tauri::{Emitter, WebviewWindow};

    struct PromiseContext {
        item: NativeDragItem,
        manager: Arc<ConnectionManager>,
        app: AppHandle,
    }

    struct PromiseDelegateIvars {
        context: Arc<PromiseContext>,
        queue: Retained<NSOperationQueue>,
    }

    define_class!(
        #[unsafe(super = NSObject)]
        #[ivars = PromiseDelegateIvars]
        struct PromiseDelegate;

        unsafe impl NSObjectProtocol for PromiseDelegate {}

        unsafe impl NSFilePromiseProviderDelegate for PromiseDelegate {
            #[unsafe(method_id(filePromiseProvider:fileNameForType:))]
            fn file_name(
                &self,
                _provider: &NSFilePromiseProvider,
                _file_type: &NSString,
            ) -> Retained<NSString> {
                NSString::from_str(&self.ivars().context.item.name)
            }

            #[unsafe(method(filePromiseProvider:writePromiseToURL:completionHandler:))]
            fn write_promise(
                &self,
                _provider: &NSFilePromiseProvider,
                directory_url: &NSURL,
                completion: &DynBlock<dyn Fn(*mut NSError)>,
            ) {
                let context = Arc::clone(&self.ivars().context);
                let directory = directory_url
                    .path()
                    .map(|path| PathBuf::from(path.to_string()));
                let result = directory
                    .ok_or_else(|| "Finder did not provide a local destination".to_string())
                    .and_then(|directory| {
                        tauri::async_runtime::block_on(write_remote_promise_with(
                            &directory,
                            &context.item,
                            |connection_id, remote_path, destination| {
                                let manager = Arc::clone(&context.manager);
                                async move {
                                    let connection = manager
                                        .get_connection(&connection_id)
                                        .await
                                        .ok_or_else(|| {
                                        format!("Connection '{}' is unavailable", connection_id)
                                    })?;
                                    let client = connection.read().await;
                                    client
                                        .download_file(
                                            &remote_path,
                                            destination.to_string_lossy().as_ref(),
                                        )
                                        .await
                                        .map(|_| ())
                                        .map_err(|error| error.to_string())
                                }
                            },
                        ))
                    });

                match result {
                    Ok(_) => completion.call((std::ptr::null_mut(),)),
                    Err(error) => {
                        let _ = context.app.emit(
                            "native-file-drag-error",
                            NativeDragErrorPayload {
                                name: context.item.name.clone(),
                                error: error.clone(),
                            },
                        );
                        let domain = NSString::from_str("com.spo.skd.file-promise");
                        let cocoa_error =
                            unsafe { NSError::errorWithDomain_code_userInfo(&domain, 1, None) };
                        completion.call((Retained::as_ptr(&cocoa_error) as *mut NSError,));
                    }
                }
            }

            #[unsafe(method_id(operationQueueForFilePromiseProvider:))]
            fn operation_queue(
                &self,
                _provider: &NSFilePromiseProvider,
            ) -> Retained<NSOperationQueue> {
                self.ivars().queue.clone()
            }
        }
    );

    impl PromiseDelegate {
        fn new(context: PromiseContext) -> Retained<Self> {
            let this = Self::alloc().set_ivars(PromiseDelegateIvars {
                context: Arc::new(context),
                queue: NSOperationQueue::new(),
            });
            unsafe { msg_send![super(this), init] }
        }
    }

    struct DragSourceIvars {
        _promise_delegates: Vec<Retained<PromiseDelegate>>,
    }

    define_class!(
        #[unsafe(super = NSObject)]
        #[thread_kind = MainThreadOnly]
        #[ivars = DragSourceIvars]
        struct DragSource;

        unsafe impl NSObjectProtocol for DragSource {}

        unsafe impl NSDraggingSource for DragSource {
            #[unsafe(method(draggingSession:sourceOperationMaskForDraggingContext:))]
            fn operation_mask(
                &self,
                _session: &NSDraggingSession,
                _context: NSDraggingContext,
            ) -> NSDragOperation {
                NSDragOperation::Copy
            }

            #[unsafe(method(draggingSession:endedAtPoint:operation:))]
            fn drag_ended(
                &self,
                _session: &NSDraggingSession,
                _screen_point: NSPoint,
                _operation: NSDragOperation,
            ) {
                let source = self as *const Self;
                ACTIVE_DRAG_SOURCES.with(|sources| {
                    sources
                        .borrow_mut()
                        .retain(|candidate| Retained::as_ptr(candidate) != source.cast_mut());
                });
            }
        }
    );

    thread_local! {
        static ACTIVE_DRAG_SOURCES: RefCell<Vec<Retained<DragSource>>> = const { RefCell::new(Vec::new()) };
    }

    impl DragSource {
        fn new(delegates: Vec<Retained<PromiseDelegate>>, mtm: MainThreadMarker) -> Retained<Self> {
            let this = Self::alloc(mtm).set_ivars(DragSourceIvars {
                _promise_delegates: delegates,
            });
            unsafe { msg_send![super(this), init] }
        }
    }

    pub fn start(
        window: WebviewWindow,
        items: Vec<NativeDragItem>,
        manager: Arc<ConnectionManager>,
        app: AppHandle,
    ) -> Result<NativeDragResponse, String> {
        let plan = build_native_drag_plan(items)?;
        let mtm = MainThreadMarker::new()
            .ok_or_else(|| "Native file drag must start on the macOS main thread".to_string())?;
        let ns_window_ptr = window.ns_window().map_err(|error| error.to_string())?;
        let ns_window = unsafe { &*(ns_window_ptr as *const NSWindow) };
        let view: Retained<NSView> = ns_window
            .contentView()
            .ok_or_else(|| "The app window has no content view".to_string())?;
        let event = NSApplication::sharedApplication(mtm)
            .currentEvent()
            .ok_or_else(|| "No active pointer event is available for dragging".to_string())?;
        let point = view.convertPoint_fromView(event.locationInWindow(), None);
        let frame = NSRect::new(
            NSPoint::new(point.x - 16.0, point.y - 16.0),
            NSSize::new(32.0, 32.0),
        );
        let workspace = NSWorkspace::sharedWorkspace();

        let mut dragging_items: Vec<Retained<NSDraggingItem>> = Vec::new();
        let mut promise_delegates = Vec::new();
        for item in &plan.exportable {
            if item.mode == "local" {
                let path = NSString::from_str(&item.path);
                let url = NSURL::fileURLWithPath_isDirectory(&path, item.is_directory);
                let writer = ProtocolObject::<dyn NSPasteboardWriting>::from_ref(&*url);
                let dragging_item =
                    NSDraggingItem::initWithPasteboardWriter(NSDraggingItem::alloc(), writer);
                let icon = workspace.iconForFile(&path);
                unsafe {
                    dragging_item.setDraggingFrame_contents(frame, Some(&*icon as &AnyObject));
                }
                dragging_items.push(dragging_item);
            } else {
                let delegate = PromiseDelegate::new(PromiseContext {
                    item: item.clone(),
                    manager: Arc::clone(&manager),
                    app: app.clone(),
                });
                let delegate_protocol =
                    ProtocolObject::<dyn NSFilePromiseProviderDelegate>::from_ref(&*delegate);
                let file_type = NSString::from_str("public.data");
                let provider = NSFilePromiseProvider::initWithFileType_delegate(
                    NSFilePromiseProvider::alloc(),
                    &file_type,
                    delegate_protocol,
                );
                let writer = ProtocolObject::<dyn NSPasteboardWriting>::from_ref(&*provider);
                let dragging_item =
                    NSDraggingItem::initWithPasteboardWriter(NSDraggingItem::alloc(), writer);
                #[allow(deprecated)]
                let icon = workspace.iconForFileType(&file_type);
                unsafe {
                    dragging_item.setDraggingFrame_contents(frame, Some(&*icon as &AnyObject));
                }
                dragging_items.push(dragging_item);
                promise_delegates.push(delegate);
            }
        }

        let source = DragSource::new(promise_delegates, mtm);
        let array = NSArray::from_retained_slice(&dragging_items);
        view.beginDraggingSessionWithItems_event_source(
            &array,
            &event,
            ProtocolObject::<dyn NSDraggingSource>::from_ref(&*source),
        );
        ACTIVE_DRAG_SOURCES.with(|sources| sources.borrow_mut().push(source));

        Ok(NativeDragResponse {
            started_count: plan.exportable.len(),
            skipped_directories: plan.skipped_directories,
        })
    }
}

#[cfg(target_os = "macos")]
pub use platform::start;

#[cfg(not(target_os = "macos"))]
pub fn start(
    _window: tauri::WebviewWindow,
    _items: Vec<NativeDragItem>,
    _manager: Arc<ConnectionManager>,
    _app: AppHandle,
) -> Result<NativeDragResponse, String> {
    Err("Native file drag is only available on macOS".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(mode: &str, name: &str, is_directory: bool) -> NativeDragItem {
        NativeDragItem {
            mode: mode.to_string(),
            connection_id: (mode == "remote").then(|| "ssh-1".to_string()),
            name: name.to_string(),
            path: format!("/source/{name}"),
            is_directory,
        }
    }

    #[test]
    fn maps_each_file_to_an_independent_promise_and_skips_remote_directories() {
        let plan = build_native_drag_plan(vec![
            item("remote", "alpha.txt", false),
            item("remote", "folder", true),
            item("remote", "bravo.txt", false),
        ])
        .unwrap();

        assert_eq!(
            plan.exportable
                .iter()
                .map(|item| item.name.as_str())
                .collect::<Vec<_>>(),
            vec!["alpha.txt", "bravo.txt"]
        );
        assert_eq!(plan.skipped_directories, vec!["folder"]);
    }

    #[tokio::test]
    async fn propagates_remote_download_errors_to_the_file_promise() {
        let temp = tempfile::tempdir().unwrap();
        let result = write_remote_promise_with(
            temp.path(),
            &item("remote", "alpha.txt", false),
            |_connection_id, _remote_path, _destination| async {
                Err("connection dropped".to_string())
            },
        )
        .await;

        assert_eq!(result.unwrap_err(), "connection dropped");
    }
}
