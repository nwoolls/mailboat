//! Windows: the taskbar icon's right-click menu (its jump list). "New
//! message" sits in a section of its own at the top, and the unified
//! folders under Tasks. Each entry starts the app with an argument: New
//! message with an empty `mailto:` link (`mail_handler` opens it), a
//! folder with `--view <name>`. A copy started while the app is open
//! hands its arguments to the running one and quits (single-instance
//! plugin, `lib.rs`), as `mailto:` links do.
//!
//! The list is written at every start of the installed app, in the normal
//! mode only, so it follows the app to a new folder after an update or a
//! reinstall, and a dev build, a clean start or the demo never points the
//! menu at itself. It is kept under the app's ID (the bundle identifier),
//! which the app also takes as its own at start: Tauri's installer gives
//! the Start menu shortcut that ID, and its uninstaller deletes the list
//! kept under it.
//!
//! Everything but the writing itself compiles and is tested on every
//! system.

// Off Windows only the tests and the queue's command use this module.
#![cfg_attr(not(windows), allow(dead_code))]

use std::sync::Mutex;

use mail_core::model::{MailView, SystemLabel};
use tauri::{AppHandle, Manager};
use tauri_specta::Event;

use crate::events::ViewRequestEvent;
use crate::mode::Mode;

/// The argument that names a folder to show: `--view inbox`.
pub const VIEW_FLAG: &str = "--view";

/// The heading of the section that holds New message.
pub const WRITE_HEADING: &str = "Write";

/// One entry in the menu.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    pub title: &'static str,
    /// The arguments the app starts with, each one quoted on its own.
    pub args: Vec<String>,
    /// The icon's file, in the installed app's `jump-list` folder.
    pub icon: &'static str,
}

/// The New message entry, in the section headed `WRITE_HEADING`.
pub fn new_message() -> Entry {
    Entry {
        title: "New message",
        args: vec!["mailto:".into()],
        icon: "new-message.ico",
    }
}

/// The folders the menu offers, with the name each takes after `--view`.
/// Sent, Important, Spam and Trash stay out.
const FOLDERS: [(&str, &str, &str); 6] = [
    ("inbox", "Inbox", "inbox.ico"),
    ("unread", "Unread", "unread.ico"),
    ("starred", "Starred", "starred.ico"),
    ("drafts", "Drafts", "drafts.ico"),
    ("archive", "Archive", "archive.ico"),
    ("all-mail", "All Mail", "all-mail.ico"),
];

/// The folder entries, in the sidebar's order, for Tasks.
pub fn folders() -> Vec<Entry> {
    FOLDERS
        .iter()
        .map(|&(name, title, icon)| Entry {
            title,
            args: vec![VIEW_FLAG.into(), name.into()],
            icon,
        })
        .collect()
}

/// The folder a `--view` name stands for.
fn view_named(name: &str) -> Option<MailView> {
    Some(match name {
        "inbox" => MailView::System {
            label: SystemLabel::Inbox,
        },
        "unread" => MailView::System {
            label: SystemLabel::Unread,
        },
        "starred" => MailView::System {
            label: SystemLabel::Starred,
        },
        "drafts" => MailView::System {
            label: SystemLabel::Draft,
        },
        "archive" => MailView::Archive,
        "all-mail" => MailView::AllMail,
        _ => return None,
    })
}

/// The folder asked for in a start's arguments (`--view inbox`), if any.
/// An unknown name is ignored; with several, the last one wins.
pub fn view_in_args<S: AsRef<str>>(args: impl IntoIterator<Item = S>) -> Option<MailView> {
    let mut found = None;
    let mut args = args.into_iter();
    while let Some(arg) = args.next() {
        if arg.as_ref() == VIEW_FLAG {
            if let Some(view) = args.next().and_then(|name| view_named(name.as_ref())) {
                found = Some(view);
            }
        }
    }
    found
}

/// A command line's arguments as Windows reads them back: each quoted,
/// with quotes and the backslashes before them escaped. The entries'
/// arguments are fixed and need none of it, but nothing breaks if one
/// ever does.
pub fn command_line(args: &[String]) -> String {
    args.iter()
        .map(|arg| {
            let mut out = String::from('"');
            let mut backslashes = 0;
            for c in arg.chars() {
                match c {
                    '\\' => backslashes += 1,
                    '"' => {
                        out.extend(std::iter::repeat_n('\\', backslashes * 2 + 1));
                        out.push('"');
                        backslashes = 0;
                    }
                    _ => {
                        out.extend(std::iter::repeat_n('\\', backslashes));
                        out.push(c);
                        backslashes = 0;
                    }
                }
            }
            out.extend(std::iter::repeat_n('\\', backslashes * 2));
            out.push('"');
            out
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Whether this copy should own the menu: the normal mode, run from where
/// it was installed, not from a build folder (`target\debug`,
/// `target\release`, or the same under a target triple). The same test as
/// Tauri's notification plugin, which gives notifications the app's ID
/// only when installed. `exe` is the program's path.
pub fn owns_jump_list(mode: Mode, exe: &str) -> bool {
    if !mode.is_normal() {
        return false;
    }
    let parts: Vec<&str> = exe.split(['\\', '/']).filter(|p| !p.is_empty()).collect();
    let dirs = &parts[..parts.len().saturating_sub(1)];
    let is = |part: Option<&&str>, name: &str| part.is_some_and(|p| p.eq_ignore_ascii_case(name));
    let profile = dirs.last();
    let built = (is(profile, "debug") || is(profile, "release"))
        && (is(dirs.iter().rev().nth(1), "target") || is(dirs.iter().rev().nth(2), "target"));
    !built
}

/// The folder a jump-list entry asked for, waiting for the window. Only
/// the latest counts.
#[derive(Default)]
pub struct ViewRequest(Mutex<Option<MailView>>);

impl ViewRequest {
    pub fn take(&self) -> Option<MailView> {
        self.0.lock().unwrap().take()
    }
}

/// Opens the folder named in a start's arguments, if any: queued for the
/// window, which is brought forward.
pub fn open_args<S: AsRef<str>>(app: &AppHandle, args: impl IntoIterator<Item = S>) {
    let Some(view) = view_in_args(args) else {
        return;
    };
    *app.state::<ViewRequest>().0.lock().unwrap() = Some(view);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    let _ = ViewRequestEvent.emit(app);
}

/// Gives the process the app's ID, so every start (from the Start menu, a
/// pinned icon, a `mailto:` link) shares one taskbar button and this menu.
/// Must run before the window is made.
#[cfg(windows)]
pub fn take_app_id(mode: Mode) {
    use windows::core::HSTRING;
    use windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;

    if !owns_jump_list(mode, &exe_path()) {
        return;
    }
    // SAFETY: a plain call with a valid string; it only fails on bad input.
    let _ =
        unsafe { SetCurrentProcessExplicitAppUserModelID(&HSTRING::from(mail_core::brand::ID)) };
}

#[cfg(windows)]
fn exe_path() -> String {
    std::env::current_exe()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Writes the menu, on a thread of its own (COM wants one it can set up).
/// Best effort: if Windows refuses, the menu keeps what it had.
#[cfg(windows)]
pub fn write(app: &AppHandle, mode: Mode) {
    let exe = exe_path();
    if !owns_jump_list(mode, &exe) {
        return;
    }
    let icons = app
        .path()
        .resource_dir()
        .map(|dir| dir.join("jump-list"))
        .ok();
    // A windowed app on Windows has no console, and the sync log is kept
    // per account: a failure only leaves the old menu in place.
    std::thread::spawn(move || {
        let _ = windows_list::write(&exe, icons.as_deref());
    });
}

#[cfg(windows)]
mod windows_list {
    use std::path::Path;

    use windows::core::{Interface, Result, HSTRING};
    use windows::Win32::Storage::EnhancedStorage::PKEY_Title;
    use windows::Win32::System::Com::StructuredStorage::PROPVARIANT;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::Common::{IObjectArray, IObjectCollection};
    use windows::Win32::UI::Shell::PropertiesSystem::{IPropertyStore, PSCoerceToCanonicalValue};
    use windows::Win32::UI::Shell::{
        DestinationList, EnumerableObjectCollection, ICustomDestinationList, IShellLinkW, ShellLink,
    };

    use super::{command_line, folders, new_message, Entry, WRITE_HEADING};

    pub fn write(exe: &str, icons: Option<&Path>) -> Result<()> {
        // SAFETY: COM is set up on this thread for these calls, and taken
        // down after them; every pointer passed is a live COM object or a
        // string that outlives the call.
        unsafe {
            CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok()?;
            let result = write_list(exe, icons);
            CoUninitialize();
            result
        }
    }

    fn write_list(exe: &str, icons: Option<&Path>) -> Result<()> {
        // SAFETY: COM calls on objects made here or handed over by
        // Windows, with strings and buffers that outlive each call; COM
        // is set up on this thread (`write`).
        unsafe {
            let list: ICustomDestinationList =
                CoCreateInstance(&DestinationList, None, CLSCTX_INPROC_SERVER)?;
            list.SetAppID(&HSTRING::from(mail_core::brand::ID))?;
            let mut slots = 0u32;
            let removed: IObjectArray = list.BeginList(&mut slots)?;

            // New message, unless someone removed it from the menu
            // (Windows rejects a whole section that holds a removed item,
            // and the whole list would go unwritten with it).
            let compose = new_message();
            if !was_removed(&removed, &compose)? {
                let section: IObjectCollection =
                    CoCreateInstance(&EnumerableObjectCollection, None, CLSCTX_INPROC_SERVER)?;
                section.AddObject(&link(exe, icons, &compose)?)?;
                list.AppendCategory(
                    &HSTRING::from(WRITE_HEADING),
                    &section.cast::<IObjectArray>()?,
                )?;
            }

            let tasks: IObjectCollection =
                CoCreateInstance(&EnumerableObjectCollection, None, CLSCTX_INPROC_SERVER)?;
            for entry in folders() {
                tasks.AddObject(&link(exe, icons, &entry)?)?;
            }
            list.AddUserTasks(&tasks.cast::<IObjectArray>()?)?;
            list.CommitList()
        }
    }

    /// One entry: the app, its arguments, title and icon.
    fn link(exe: &str, icons: Option<&Path>, entry: &Entry) -> Result<IShellLinkW> {
        // SAFETY: COM calls on objects made here or handed over by
        // Windows, with strings and buffers that outlive each call; COM
        // is set up on this thread (`write`).
        unsafe {
            let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
            link.SetPath(&HSTRING::from(exe))?;
            link.SetArguments(&HSTRING::from(command_line(&entry.args)))?;
            link.SetDescription(&HSTRING::from(entry.title))?;
            // Without its own icon an entry shows the app's.
            if let Some(icon) = icons
                .map(|dir| dir.join(entry.icon))
                .filter(|p| p.is_file())
            {
                link.SetIconLocation(&HSTRING::from(icon.as_os_str()), 0)?;
            }
            // The menu shows a link's title, which is a string property.
            let store: IPropertyStore = link.cast()?;
            let mut title = PROPVARIANT::from(entry.title);
            PSCoerceToCanonicalValue(&PKEY_Title, &mut title)?;
            store.SetValue(&PKEY_Title, &title)?;
            store.Commit()?;
            Ok(link)
        }
    }

    /// Whether `entry` is among the items removed from the menu (Windows
    /// gives them back as links; compared by their arguments).
    fn was_removed(removed: &IObjectArray, entry: &Entry) -> Result<bool> {
        // SAFETY: COM calls on objects made here or handed over by
        // Windows, with strings and buffers that outlive each call; COM
        // is set up on this thread (`write`).
        unsafe {
            let ours = command_line(&entry.args);
            for i in 0..removed.GetCount()? {
                let Ok(link) = removed.GetAt::<IShellLinkW>(i) else {
                    continue;
                };
                let mut buf = [0u16; 1024];
                if link.GetArguments(&mut buf).is_ok() {
                    let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
                    if String::from_utf16_lossy(&buf[..end]) == ours {
                        return Ok(true);
                    }
                }
            }
            Ok(false)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn system(label: SystemLabel) -> MailView {
        MailView::System { label }
    }

    #[test]
    fn the_menu_lists_new_message_then_the_folders_in_the_sidebars_order() {
        assert_eq!(new_message().title, "New message");
        assert_eq!(new_message().args, ["mailto:"]);
        let titles: Vec<_> = folders().iter().map(|e| e.title).collect();
        assert_eq!(
            titles,
            ["Inbox", "Unread", "Starred", "Drafts", "Archive", "All Mail"]
        );
    }

    #[test]
    fn every_folder_entry_starts_the_app_on_its_folder() {
        let wanted = [
            system(SystemLabel::Inbox),
            system(SystemLabel::Unread),
            system(SystemLabel::Starred),
            system(SystemLabel::Draft),
            MailView::Archive,
            MailView::AllMail,
        ];
        for (entry, view) in folders().iter().zip(wanted) {
            assert_eq!(view_in_args(&entry.args), Some(view), "{}", entry.title);
        }
    }

    #[test]
    fn new_message_is_an_empty_mailto_link() {
        let link = mail_core::mail::mailto::parse(&new_message().args[0]).unwrap();
        assert!(link.to.is_empty() && link.cc.is_empty() && link.bcc.is_empty());
        assert!(link.subject.is_empty() && link.body.is_empty());
        assert_eq!(view_in_args(&new_message().args), None);
    }

    #[test]
    fn reads_the_folder_among_other_arguments() {
        assert_eq!(
            view_in_args(["mailto:", "--view", "starred"]),
            Some(system(SystemLabel::Starred))
        );
        assert_eq!(
            view_in_args(["--view", "inbox", "--view", "archive"]),
            Some(MailView::Archive)
        );
        // Unknown names, a flag with nothing after it, other folders.
        assert_eq!(view_in_args(["--view", "spam"]), None);
        assert_eq!(view_in_args(["--view", "trash"]), None);
        assert_eq!(view_in_args(["--view"]), None);
        assert_eq!(view_in_args(["inbox"]), None);
        assert_eq!(view_in_args(Vec::<String>::new()), None);
        // A bad name later doesn't undo a good one.
        assert_eq!(
            view_in_args(["--view", "inbox", "--view", "nope"]),
            Some(system(SystemLabel::Inbox))
        );
    }

    #[test]
    fn a_folder_argument_leaves_the_mode_normal_and_isnt_a_mailto_link() {
        let args = ["--view", "inbox"];
        assert!(Mode::from_args(args).is_normal());
        assert!(args
            .iter()
            .all(|a| mail_core::mail::mailto::parse(a).is_none()));
    }

    #[test]
    fn quotes_each_argument_as_windows_reads_it() {
        assert_eq!(
            command_line(&["--view".into(), "inbox".into()]),
            r#""--view" "inbox""#
        );
        assert_eq!(command_line(&["mailto:".into()]), r#""mailto:""#);
        assert_eq!(command_line(&[r#"a "b""#.into()]), r#""a \"b\"""#);
        assert_eq!(command_line(&[r"C:\dir\".into()]), r#""C:\dir\\""#);
    }

    #[test]
    fn only_the_installed_app_in_the_normal_mode_owns_the_menu() {
        let installed = r"C:\Users\me\AppData\Local\App\app.exe";
        assert!(owns_jump_list(Mode::Normal, installed));
        assert!(!owns_jump_list(Mode::Demo, installed));
        assert!(!owns_jump_list(Mode::CleanStart, installed));
        for built in [
            r"C:\src\app\target\debug\app.exe",
            r"C:\src\app\target\release\app.exe",
            r"C:\src\app\target\aarch64-pc-windows-msvc\release\app.exe",
            r"C:\src\app\TARGET\Debug\app.exe",
        ] {
            assert!(!owns_jump_list(Mode::Normal, built), "{built}");
        }
        // A folder that only looks like one.
        assert!(owns_jump_list(Mode::Normal, r"C:\release\app.exe"));
    }

    #[test]
    fn every_entry_has_its_own_icon_file() {
        let mut icons: Vec<_> = folders().iter().map(|e| e.icon).collect();
        icons.push(new_message().icon);
        let count = icons.len();
        icons.sort();
        icons.dedup();
        assert_eq!(icons.len(), count);
        assert!(icons.iter().all(|i| i.ends_with(".ico")));
    }
}
