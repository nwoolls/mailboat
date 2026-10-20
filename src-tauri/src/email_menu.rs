//! Mailboat's own right-click menu over images and links inside emails.
//!
//! An email sits in a sandboxed frame where nothing runs, not even the
//! app's own listeners, so the page never hears the right-click. The web
//! view then shows WebKit's menu, whose "Download Image" saved nothing
//! (WebKit hands downloads to the app, and Tauri doesn't take them). macOS
//! lets the app see that menu just before it opens (`willOpenMenu:
//! withEvent:`, the documented way to change a WKWebView's menu): when
//! WebKit built it for an image or a link, it's emptied (an empty menu
//! doesn't show) and the page is told where the click was, so it shows
//! Mailboat's menu instead. Over text the system menu stays (Copy, Look Up…).
//!
//! Also the clipboard, for the menu's Copy Image and Copy Link.

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::AppHandle;

/// A right-click on an image or link inside an email, at `x`, `y` in the
/// window's page coordinates. `image` / `link`: what WebKit found there.
#[derive(Debug, Clone, Serialize, Deserialize, Type, tauri_specta::Event)]
pub struct EmailMenuEvent {
    pub x: f64,
    pub y: f64,
    pub image: bool,
    pub link: bool,
}

#[cfg(target_os = "macos")]
mod mac {
    use std::sync::OnceLock;

    use objc2::ffi;
    use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
    use objc2::sel;
    use objc2_app_kit::{NSEvent, NSMenu, NSUserInterfaceItemIdentification, NSView};
    use tauri::{AppHandle, Manager};
    use tauri_specta::Event;

    use super::EmailMenuEvent;

    /// WebKit's names for its image and link menu items.
    const IMAGE_ITEMS: [&str; 3] = [
        "WKMenuItemIdentifierCopyImage",
        "WKMenuItemIdentifierDownloadImage",
        "WKMenuItemIdentifierOpenImageInNewWindow",
    ];
    const LINK_ITEMS: [&str; 4] = [
        "WKMenuItemIdentifierOpenLink",
        "WKMenuItemIdentifierOpenLinkInNewWindow",
        "WKMenuItemIdentifierCopyLink",
        "WKMenuItemIdentifierDownloadLinkedFile",
    ];

    static APP: OnceLock<AppHandle> = OnceLock::new();
    /// The web view's own `willOpenMenu:withEvent:`, called first.
    static ORIGINAL: OnceLock<Imp> = OnceLock::new();

    type WillOpenMenu = unsafe extern "C-unwind" fn(&AnyObject, Sel, &NSMenu, &NSEvent);

    unsafe extern "C-unwind" fn will_open_menu(
        this: &AnyObject,
        cmd: Sel,
        menu: &NSMenu,
        event: &NSEvent,
    ) {
        if let Some(original) = ORIGINAL.get() {
            // SAFETY: the method replaced had this signature (v@:@@).
            let original: WillOpenMenu = unsafe { std::mem::transmute(*original) };
            unsafe { original(this, cmd, menu, event) };
        }
        let ids: Vec<String> = menu
            .itemArray()
            .iter()
            .filter_map(|item| item.identifier().map(|id| id.to_string()))
            .collect();
        let image = ids.iter().any(|id| IMAGE_ITEMS.contains(&id.as_str()));
        let link = ids.iter().any(|id| LINK_ITEMS.contains(&id.as_str()));
        if !image && !link {
            return;
        }
        menu.removeAllItems();
        // SAFETY: the method was installed on the web view's class, an
        // NSView subclass.
        let view: &NSView = unsafe { &*(this as *const AnyObject).cast::<NSView>() };
        let point = view.convertPoint_fromView(event.locationInWindow(), None);
        let y = if view.isFlipped() {
            point.y
        } else {
            view.bounds().size.height - point.y
        };
        if let Some(app) = APP.get() {
            let _ = EmailMenuEvent {
                x: point.x,
                y,
                image,
                link,
            }
            .emit(app);
        }
    }

    pub fn install(app: &AppHandle) {
        let Some(window) = app.get_webview_window("main") else {
            return;
        };
        if APP.set(app.clone()).is_err() {
            return;
        }
        let _ = window.with_webview(|webview| {
            let object = webview.inner().cast::<AnyObject>();
            if object.is_null() {
                return;
            }
            // SAFETY: `inner` is the window's live WKWebView (Wry's
            // subclass), and this runs on the main thread.
            let class: &AnyClass = unsafe { &*object }.class();
            let sel = sel!(willOpenMenu:withEvent:);
            let Some(method) = class.instance_method(sel) else {
                return;
            };
            let _ = ORIGINAL.set(method.implementation());
            // SAFETY: an `Imp` is any function pointer; ours matches the
            // method's type encoding below.
            let ours: Imp = unsafe { std::mem::transmute(will_open_menu as WillOpenMenu) };
            let class_ptr = (class as *const AnyClass).cast_mut();
            // Added to Wry's subclass (overriding WKWebView's), or, if the
            // subclass already has its own, replacing that one.
            let added = unsafe { ffi::class_addMethod(class_ptr, sel, ours, c"v@:@@".as_ptr()) };
            if !added.as_bool() {
                unsafe { ffi::method_setImplementation(method, ours) };
            }
        });
    }

    pub fn copy_image(bytes: &[u8]) -> Result<(), String> {
        use objc2::rc::Retained;
        use objc2::runtime::ProtocolObject;
        use objc2::AllocAnyThread;
        use objc2_app_kit::{NSImage, NSPasteboard, NSPasteboardWriting};
        use objc2_foundation::{NSArray, NSData};

        let data = NSData::with_bytes(bytes);
        let image = NSImage::initWithData(NSImage::alloc(), &data)
            .ok_or_else(|| "macOS couldn't read that image".to_string())?;
        let writer: Retained<ProtocolObject<dyn NSPasteboardWriting>> =
            ProtocolObject::from_retained(image);
        let board = NSPasteboard::generalPasteboard();
        board.clearContents();
        if board.writeObjects(&NSArray::from_retained_slice(&[writer])) {
            Ok(())
        } else {
            Err("couldn't put the image on the clipboard".into())
        }
    }

    pub fn copy_text(text: &str) -> Result<(), String> {
        use objc2_app_kit::{NSPasteboard, NSPasteboardTypeString};
        use objc2_foundation::NSString;

        let board = NSPasteboard::generalPasteboard();
        board.clearContents();
        // SAFETY: a constant AppKit defines.
        let kind = unsafe { NSPasteboardTypeString };
        if board.setString_forType(&NSString::from_str(text), kind) {
            Ok(())
        } else {
            Err("couldn't put the text on the clipboard".into())
        }
    }
}

/// Starts watching the web view's menus (macOS). Elsewhere the web view's
/// own menu stays for now.
pub fn install(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    mac::install(app);
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

/// Puts an image (PNG, JPEG, GIF…) on the clipboard.
pub fn copy_image(bytes: &[u8]) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return mac::copy_image(bytes);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = bytes;
        Err("copying images isn't available on this system yet".into())
    }
}

/// Puts plain text on the clipboard.
pub fn copy_text(text: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return mac::copy_text(text);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = text;
        Err("copying isn't available on this system yet".into())
    }
}
