//! Opening the system's print dialog for the window (`window_print`).
//!
//! On macOS, Tauri's `print()` uses Wry's default options, whose margins are
//! zero: the page was laid out to the paper's edge, and printers cut off the
//! text there. So the app opens the print sheet itself, as Wry does, on a
//! copy of the system's print settings with margins of its own (leaving the
//! shared settings alone). Windows' web view prints with its own margins.

/// Each page's margin, in points: half an inch.
#[cfg(target_os = "macos")]
const MARGIN: f64 = 36.0;

/// Opens the print sheet. It answers once the sheet is up (or couldn't be),
/// not when it closes; a missing web view or window is an error, so the
/// app can say printing didn't start.
#[cfg(target_os = "macos")]
pub async fn print(window: &tauri::WebviewWindow) -> Result<(), String> {
    use objc2::rc::Retained;
    use objc2_app_kit::NSPrintInfo;
    use objc2_foundation::NSCopying;
    use objc2_web_kit::WKWebView;

    let (done, opened) = tokio::sync::oneshot::channel::<Result<(), String>>();
    window
        .with_webview(move |webview| {
            let view = webview.inner().cast::<WKWebView>();
            if view.is_null() {
                let _ = done.send(Err("no web view".into()));
                return;
            }
            // SAFETY: `inner` is the window's live WKWebView (Wry's subclass),
            // and `with_webview` runs this on the main thread.
            let view: &WKWebView = unsafe { &*view };
            let Some(sheet_on) = view.window() else {
                let _ = done.send(Err("no window".into()));
                return;
            };
            let info: Retained<NSPrintInfo> = NSPrintInfo::sharedPrintInfo().copy();
            info.setTopMargin(MARGIN);
            info.setBottomMargin(MARGIN);
            info.setLeftMargin(MARGIN);
            info.setRightMargin(MARGIN);
            // SAFETY: as above.
            let operation = unsafe { view.printOperationWithPrintInfo(&info) };
            // The sheet doesn't hold up the app while it is open.
            operation.setCanSpawnSeparateThread(true);
            // SAFETY: no delegate, so no selector or context is called back.
            unsafe {
                operation.runOperationModalForWindow_delegate_didRunSelector_contextInfo(
                    &sheet_on,
                    None,
                    None,
                    std::ptr::null_mut(),
                );
            }
            let _ = done.send(Ok(()));
        })
        .map_err(|e| e.to_string())?;
    opened.await.map_err(|_| "the window closed".to_string())?
}

#[cfg(not(target_os = "macos"))]
pub async fn print(window: &tauri::WebviewWindow) -> Result<(), String> {
    window.print().map_err(|e| e.to_string())
}
