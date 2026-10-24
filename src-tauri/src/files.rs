//! Handing downloaded attachments to the operating system: open with the
//! default app, Quick Look, reveal in Finder, and marking them as
//! downloaded from the internet (quarantine) as browsers do.

use std::path::Path;
use std::process::{Command, Stdio};

use mailboat_core::CoreError;

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
                &format!("0081;{secs:x};Mailboat;"),
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

/// Shows the file selected in Finder (or Explorer).
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

pub fn reveal(path: &Path) -> Result<(), CoreError> {
    #[cfg(target_os = "macos")]
    return spawn(Command::new("open").arg("-R").arg(path));
    #[cfg(target_os = "windows")]
    return spawn(Command::new("explorer").arg(format!("/select,{}", path.display())));
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    return open(path.parent().unwrap_or(path));
}
