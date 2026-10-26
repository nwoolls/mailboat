//! The app as the default email reader: `mailto:` links from other apps
//! (and clicked inside emails) open a new message here.
//!
//! The bundle's Info.plist claims the `mailto` scheme (`Info.plist`, and
//! `scripts/dev-run.sh` for dev builds), and macOS delivers the links as
//! Tauri's `RunEvent::Opened`. A link can arrive before the window is
//! listening (it launched the app), so links wait in a queue the window
//! drains: at start and on each `MailtoEvent`.
//!
//! On Windows the installer registers the app as an email app
//! (`windows/installer.nsh`: the `the app.mailto` ProgID and Default apps
//! entry), Windows starts the app with the link as an argument, and a copy
//! started while the app is open hands its link to the running one
//! (single-instance plugin, `lib.rs`). Windows doesn't let an app make
//! itself the default: Settings opens Windows' Default apps page instead.

use std::sync::Mutex;

use mail_core::mail::mailto::{self, Mailto};
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

/// Opens any `mailto:` link among a launch's arguments (Windows).
#[cfg_attr(not(windows), allow(dead_code))]
pub fn open_args(app: &AppHandle, args: impl IntoIterator<Item = String>) {
    for arg in args {
        open(app, &arg);
    }
}

/// The program in a registry command line: `"C:\…\app.exe" "%1"` gives
/// `C:\…\app.exe`.
#[cfg_attr(not(windows), allow(dead_code))]
fn program_in_command(command: &str) -> Option<&str> {
    let command = command.trim();
    match command.strip_prefix('"') {
        Some(rest) => rest.split('"').next(),
        None => command.split_whitespace().next(),
    }
    .filter(|p| !p.is_empty())
}

/// Which app opens `mailto:` links.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum DefaultMailApp {
    /// This copy of the app.
    This,
    /// The app, but macOS sends links to another copy, at `path`. The
    /// default is kept by bundle ID, which the dev build and the installed
    /// app share, so macOS picks the copy (usually the one in
    /// /Applications); no button here can change that.
    OtherCopy { path: String },
    /// Another app, by name (Mail, say).
    Other { name: String },
    /// Nothing claims mailto links.
    None,
    /// This copy isn't registered as an email app (Windows: a build run
    /// without its installer), so Windows can't offer it.
    NotInstalled,
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

/// The ProgID the installer registers for `mailto:` (`windows/installer.nsh`:
/// `${MAINBINARYNAME}.mailto`). Registry names ignore case, so compare
/// without it.
#[cfg(windows)]
fn prog_id() -> String {
    format!("{}.mailto", mail_core::brand::SHORT_NAME)
}

#[cfg(windows)]
pub fn default_app() -> DefaultMailApp {
    use windows_registry::{CLASSES_ROOT, CURRENT_USER};

    let read = |key: &windows_registry::Key, path: &str, name: &str| {
        key.open(path).and_then(|k| k.get_string(name)).ok()
    };
    // Which copy of the app the registration starts.
    let Some(registered) = read(
        CURRENT_USER,
        &format!(r"Software\Classes\{}\shell\open\command", prog_id()),
        "",
    ) else {
        return DefaultMailApp::NotInstalled;
    };
    let associations = r"Software\Microsoft\Windows\Shell\Associations\UrlAssociations\mailto";
    // Newer Windows 11 builds keep the choice in `UserChoiceLatest`.
    let chosen = read(
        CURRENT_USER,
        &format!(r"{associations}\UserChoiceLatest"),
        "ProgId",
    )
    .or_else(|| {
        read(
            CURRENT_USER,
            &format!(r"{associations}\UserChoice"),
            "ProgId",
        )
    });
    let Some(chosen) = chosen.filter(|p| !p.is_empty()) else {
        return DefaultMailApp::None;
    };
    if chosen.eq_ignore_ascii_case(&prog_id()) {
        let ours = std::env::current_exe().ok();
        let theirs = program_in_command(&registered).map(std::path::PathBuf::from);
        let same = match (&ours, &theirs) {
            (Some(a), Some(b)) => a
                .to_string_lossy()
                .eq_ignore_ascii_case(&b.to_string_lossy()),
            _ => true,
        };
        return if same {
            DefaultMailApp::This
        } else {
            DefaultMailApp::OtherCopy {
                path: theirs.map(|p| p.display().to_string()).unwrap_or_default(),
            }
        };
    }
    // Another app's name, where its registration gives a readable one
    // (Store apps give a resource reference, starting "@").
    let name = read(
        CLASSES_ROOT,
        &format!(r"{chosen}\Application"),
        "ApplicationName",
    )
    .or_else(|| read(CLASSES_ROOT, &chosen, ""))
    .filter(|n| !n.is_empty() && !n.starts_with('@'))
    .unwrap_or_else(|| "Another app".into());
    DefaultMailApp::Other { name }
}

#[cfg(not(any(target_os = "macos", windows)))]
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

/// Windows doesn't let an app make itself the default: this opens
/// Settings → Default apps at the app's entry, where the owner picks it.
#[cfg(windows)]
pub async fn make_default(_app: &AppHandle) -> Result<(), String> {
    open::that_detached(format!(
        "ms-settings:defaultapps?registeredAppUser={}",
        mail_core::brand::NAME
    ))
    .map_err(|e| format!("couldn't open Windows Settings: {e}"))
}

#[cfg(not(any(target_os = "macos", windows)))]
pub async fn make_default(_app: &AppHandle) -> Result<(), String> {
    Err("Not available on this platform yet".into())
}

#[cfg(test)]
mod tests {
    use super::program_in_command;

    #[test]
    fn reads_the_program_out_of_a_registry_command() {
        assert_eq!(
            program_in_command(r#""C:\Users\me\AppData\Local\App\app.exe" "%1""#),
            Some(r"C:\Users\me\AppData\Local\App\app.exe")
        );
        assert_eq!(program_in_command(r"C:\app.exe %1"), Some(r"C:\app.exe"));
        assert_eq!(program_in_command("  "), None);
    }
}
