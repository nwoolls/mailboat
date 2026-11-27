//! The app as the default email reader: `mailto:` links from other apps
//! (and clicked inside emails) open a new message here.
//!
//! The bundle's Info.plist claims the `mailto` scheme (`Info.plist`, and
//! `scripts/dev-run.sh` for dev builds), and macOS delivers the links as
//! Tauri's `RunEvent::Opened`. A link can arrive before the window is
//! listening (it launched the app), so links wait in a queue the window
//! drains: at start and on each `MailtoEvent`.
//!
//! On Linux the `.deb` and `.rpm` install a desktop entry that claims the
//! scheme (`src-tauri/linux/app.desktop`), the desktop starts the app with
//! the link as an argument, a copy started while the app is open hands it
//! over (single-instance plugin), and Settings reads and sets the default
//! with `xdg-settings`.
//!
//! On Windows the installer registers the app as an email app
//! (`windows/installer.nsh`: the `the app.mailto` ProgID and Default apps
//! entry), Windows starts the app with the link as an argument, and a copy
//! started while the app is open hands its link to the running one
//! (single-instance plugin, `lib.rs`). Windows doesn't let an app make
//! itself the default: Settings opens Windows' Default apps page instead.

use std::sync::atomic::{AtomicBool, Ordering};
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
    bring_forward(app);
    // A second copy can hand a link over before setup has mounted the
    // events (the single-instance plugin listens from the first plugin
    // on), and emitting then panics. The link waits in the queue, which
    // the window drains when it starts.
    if EVENTS_READY.load(Ordering::Acquire) {
        let _ = MailtoEvent.emit(app);
    }
    true
}

/// Set once setup has mounted the typed events (`events_ready`).
static EVENTS_READY: AtomicBool = AtomicBool::new(false);

/// Lets `open` emit `MailtoEvent`: call right after the events are mounted.
pub fn events_ready() {
    EVENTS_READY.store(true, Ordering::Release);
}

/// Shows the main window and gives it the focus.
pub fn bring_forward(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Opens any `mailto:` link among a launch's arguments (Windows, Linux).
/// Returns whether one was opened.
#[cfg_attr(not(any(windows, target_os = "linux")), allow(dead_code))]
pub fn open_args(app: &AppHandle, args: impl IntoIterator<Item = String>) -> bool {
    let mut opened = false;
    for arg in args {
        opened |= open(app, &arg);
    }
    opened
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

/// Linux: what `xdg-settings` says opens `mailto:` links (a desktop entry's
/// file name), against the app's own entry, which the `.deb` and `.rpm`
/// install (`src-tauri/linux/app.desktop`, which claims the scheme). An
/// AppImage, or a build run from the repository, has no entry of its own,
/// so it can't be chosen.
#[cfg(target_os = "linux")]
pub fn default_app() -> DefaultMailApp {
    let ours = linux::our_entry();
    if std::env::var_os("APPIMAGE").is_some() || linux::entry_file(&ours).is_none() {
        return DefaultMailApp::NotInstalled;
    }
    let Some(handler) = linux::xdg_settings(&["get", "default-url-scheme-handler", "mailto"])
    else {
        return DefaultMailApp::Unsupported;
    };
    let handler = handler.trim();
    if handler.is_empty() {
        return DefaultMailApp::None;
    }
    if handler == ours {
        return DefaultMailApp::This;
    }
    let name = linux::entry_file(handler)
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|entry| linux::entry_name(&entry))
        .unwrap_or_else(|| handler.trim_end_matches(".desktop").to_string());
    DefaultMailApp::Other { name }
}

#[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
pub fn default_app() -> DefaultMailApp {
    DefaultMailApp::Unsupported
}

/// Linux's default apps: `xdg-settings` (xdg-utils, on every desktop
/// distribution) and the desktop entries in the XDG data folders.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
mod linux {
    use std::path::PathBuf;
    use std::process::{Command, Stdio};

    /// The app's desktop entry, as the packages install it: Tauri names it
    /// after the product.
    pub fn our_entry() -> String {
        format!("{}.desktop", mail_core::brand::NAME)
    }

    /// What `xdg-settings` printed, or None when it isn't there or failed.
    pub fn xdg_settings(args: &[&str]) -> Option<String> {
        let out = Command::new("xdg-settings")
            .args(args)
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output()
            .ok()?;
        out.status
            .success()
            .then(|| String::from_utf8_lossy(&out.stdout).into_owned())
    }

    /// Where a desktop entry is installed: the first `applications` folder
    /// that has it, in `$XDG_DATA_HOME` then `$XDG_DATA_DIRS`.
    pub fn entry_file(id: &str) -> Option<PathBuf> {
        if id.contains('/') {
            return None;
        }
        let dirs = std::env::var("XDG_DATA_DIRS")
            .ok()
            .filter(|d| !d.is_empty())
            .unwrap_or_else(|| "/usr/local/share:/usr/share".to_string());
        dirs::data_dir()
            .into_iter()
            .chain(dirs.split(':').map(PathBuf::from))
            .map(|d| d.join("applications").join(id))
            .find(|p| p.is_file())
    }

    /// The app's name in a desktop entry: `Name=` in `[Desktop Entry]`.
    pub fn entry_name(entry: &str) -> Option<String> {
        let mut in_entry = false;
        for line in entry.lines().map(str::trim) {
            if line.starts_with('[') {
                in_entry = line == "[Desktop Entry]";
            } else if in_entry {
                if let Some(name) = line.strip_prefix("Name=") {
                    return Some(name.trim().to_string()).filter(|n| !n.is_empty());
                }
            }
        }
        None
    }
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

/// Linux: `xdg-settings` sets it at once (no question asked, as the
/// desktop's own settings would).
#[cfg(target_os = "linux")]
pub async fn make_default(_app: &AppHandle) -> Result<(), String> {
    let ours = linux::our_entry();
    linux::xdg_settings(&["set", "default-url-scheme-handler", "mailto", &ours])
        .map(|_| ())
        .ok_or_else(|| "couldn't change the default email app".to_string())
}

#[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
pub async fn make_default(_app: &AppHandle) -> Result<(), String> {
    Err("Not available on this platform yet".into())
}

#[cfg(test)]
mod tests {
    use super::linux::entry_name;
    use super::program_in_command;

    #[test]
    fn reads_an_apps_name_from_its_desktop_entry() {
        let entry = "[Desktop Entry]\nType=Application\nName=Mail Reader\nName[de]=Leser\nExec=reader %u\n\n[Desktop Action compose]\nName=Write\n";
        assert_eq!(entry_name(entry), Some("Mail Reader".into()));
        assert_eq!(entry_name("[Desktop Action x]\nName=Write\n"), None);
        assert_eq!(entry_name("[Desktop Entry]\nName=\n"), None);
    }

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
