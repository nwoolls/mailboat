//! Handing downloaded attachments to the operating system: open with the
//! default app, Quick Look, reveal in Finder, and marking them as
//! downloaded from the internet (quarantine) as browsers do.

use std::path::Path;
use std::process::{Command, Stdio};

use mail_core::CoreError;

#[cfg_attr(not(any(target_os = "macos", target_os = "windows")), allow(dead_code))]
fn spawn(cmd: &mut Command) -> Result<(), CoreError> {
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| CoreError::Other(format!("could not start {:?}: {e}", cmd.get_program())))
}

/// Tags a file as downloaded from the internet, so macOS Gatekeeper checks
/// it before anything in it runs (as it does for browser downloads).
/// Best effort: a failure here doesn't stop the file opening.
pub fn quarantine(path: &Path) {
    #[cfg(target_os = "macos")]
    {
        let secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let _ = Command::new("xattr")
            .args([
                "-w",
                "com.apple.quarantine",
                &format!("0081;{secs:x};{};", mail_core::brand::NAME),
            ])
            .arg(path)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(not(target_os = "macos"))]
    let _ = path;
}

/// Opens a file with its default app.
pub fn open(path: &Path) -> Result<(), CoreError> {
    open::that_detached(path).map_err(|e| CoreError::Other(format!("could not open the file: {e}")))
}

/// Shows a Quick Look preview (macOS); elsewhere opens the file.
pub fn quick_look(path: &Path) -> Result<(), CoreError> {
    #[cfg(target_os = "macos")]
    return spawn(Command::new("qlmanage").arg("-p").arg(path));
    #[cfg(not(target_os = "macos"))]
    return open(path);
}

/// The bytes taken by the files under `dir` (0 if it doesn't exist).
pub fn dir_size(dir: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    entries
        .flatten()
        .map(|e| match e.file_type() {
            Ok(t) if t.is_dir() => dir_size(&e.path()),
            Ok(_) => e.metadata().map_or(0, |m| m.len()),
            Err(_) => 0,
        })
        .sum()
}

/// Shows the file selected in Finder, File Explorer or the Linux desktop's
/// file manager (where none answers, opens its folder).
pub fn reveal(path: &Path) -> Result<(), CoreError> {
    #[cfg(target_os = "macos")]
    return spawn(Command::new("open").arg("-R").arg(path));
    #[cfg(target_os = "windows")]
    return spawn(Command::new("explorer").arg(format!("/select,{}", path.display())));
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        if show_items(path) {
            return Ok(());
        }
        open(path.parent().unwrap_or(path))
    }
}

/// Asks the desktop's file manager to show the file selected, through the
/// freedesktop `FileManager1` D-Bus interface (Files, Dolphin, Nemo and
/// others answer it; Chromium does the same). False when nothing answered,
/// so the caller opens the folder instead. `dbus-send` comes with D-Bus
/// itself, so no D-Bus library is linked for this one call.
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn show_items(path: &Path) -> bool {
    let Ok(uri) = tauri::Url::from_file_path(path) else {
        return false;
    };
    // dbus-send splits an array's items at commas.
    let uri = uri.as_str().replace(',', "%2C");
    Command::new("dbus-send")
        .args([
            "--session",
            "--print-reply",
            "--reply-timeout=2000",
            "--dest=org.freedesktop.FileManager1",
            "--type=method_call",
            "/org/freedesktop/FileManager1",
            "org.freedesktop.FileManager1.ShowItems",
        ])
        .arg(format!("array:string:{uri}"))
        .arg("string:")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}
