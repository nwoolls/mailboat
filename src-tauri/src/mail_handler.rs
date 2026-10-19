//! Mailboat as the default email reader: `mailto:` links from other apps
//! (and clicked inside emails) open a new message here.
//!
//! The bundle's Info.plist claims the `mailto` scheme (`Info.plist`, and
//! `scripts/dev-run.sh` for dev builds), and macOS delivers the links as
//! Tauri's `RunEvent::Opened`. A link can arrive before the window is
//! listening (it launched the app), so links wait in a queue the window
//! drains: at start and on each `MailtoEvent`.

use std::sync::Mutex;

use mailboat_core::mail::mailto::{self, Mailto};
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Manager};
use tauri_specta::Event;

use crate::events::MailtoEvent;

/// `mailto:` links waiting for the window.
#[derive(Default)]
pub struct MailtoQueue(Mutex<Vec<Mailto>>);

impl MailtoQueue {
    pub fn take(&self) -> Vec<Mailto> {
        std::mem::take(&mut *self.0.lock().unwrap())
    }
}

/// Queues a `mailto:` link for the window and brings the window forward.
/// Returns false if `link` isn't one.
pub fn open(app: &AppHandle, link: &str) -> bool {
    let Some(parsed) = mailto::parse(link) else {
        return false;
    };
    app.state::<MailtoQueue>().0.lock().unwrap().push(parsed);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    let _ = MailtoEvent.emit(app);
    true
}

/// Which app opens `mailto:` links.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum DefaultMailApp {
    /// This copy of Mailboat.
    This,
    /// Mailboat, but macOS sends links to another copy, at `path`. The
    /// default is kept by bundle ID, which the dev build and the installed
    /// app share, so macOS picks the copy (usually the one in
    /// /Applications); no button here can change that.
    OtherCopy { path: String },
    /// Another app, by name (Mail, say).
    Other { name: String },
    /// Nothing claims mailto links.
    None,
    /// Not on this platform yet.
    Unsupported,
}

#[cfg(target_os = "macos")]
pub fn default_app() -> DefaultMailApp {
    use objc2_app_kit::NSWorkspace;
    use objc2_foundation::{NSBundle, NSString, NSURL};

    let Some(probe) = NSURL::URLWithString(&NSString::from_str("mailto:")) else {
        return DefaultMailApp::None;
    };
    let Some(handler) = NSWorkspace::sharedWorkspace().URLForApplicationToOpenURL(&probe) else {
        return DefaultMailApp::None;
    };
    let path_of = |url: &NSURL| {
        url.path()
            .map(|p| p.to_string().trim_end_matches('/').to_string())
    };
    let handler_path = path_of(&handler).unwrap_or_default();
    let ours = NSBundle::mainBundle();
    if path_of(&ours.bundleURL()).as_deref() == Some(handler_path.as_str()) {
        return DefaultMailApp::This;
    }
    let handler_id = NSBundle::bundleWithURL(&handler).and_then(|b| b.bundleIdentifier());
    if handler_id.is_some() && handler_id == ours.bundleIdentifier() {
        return DefaultMailApp::OtherCopy { path: handler_path };
    }
    let name = std::path::Path::new(&handler_path)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or(handler_path);
    DefaultMailApp::Other { name }
}

#[cfg(not(target_os = "macos"))]
pub fn default_app() -> DefaultMailApp {
    DefaultMailApp::Unsupported
}

/// Asks macOS to make this copy the default email reader. macOS asks the
/// user to confirm; resolves once they've answered. Errors if they said no
/// or this isn't running from a `.app`.
#[cfg(target_os = "macos")]
pub async fn make_default(app: &AppHandle) -> Result<(), String> {
    use block2::RcBlock;
    use objc2_app_kit::NSWorkspace;
    use objc2_foundation::{NSBundle, NSError, NSString};

    let (tx, rx) = tokio::sync::oneshot::channel::<Result<(), String>>();
    let tx = Mutex::new(Some(tx));
    app.run_on_main_thread(move || {
        let ours = NSBundle::mainBundle().bundleURL();
        let done = RcBlock::new(move |error: *mut NSError| {
            // SAFETY: AppKit passes either null or a valid NSError.
            let result = match unsafe { error.as_ref() } {
                None => Ok(()),
                Some(e) => Err(e.localizedDescription().to_string()),
            };
            if let Some(tx) = tx.lock().unwrap().take() {
                let _ = tx.send(result);
            }
        });
        NSWorkspace::sharedWorkspace()
            .setDefaultApplicationAtURL_toOpenURLsWithScheme_completionHandler(
                &ours,
                &NSString::from_str("mailto"),
                Some(&done),
            );
    })
    .map_err(|e| e.to_string())?;
    rx.await.map_err(|_| "macOS didn't answer".to_string())?
}

#[cfg(not(target_os = "macos"))]
pub async fn make_default(_app: &AppHandle) -> Result<(), String> {
    Err("Not available on this platform yet".into())
}
