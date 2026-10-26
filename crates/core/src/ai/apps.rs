//! The copies of Claude Code and Codex inside the Claude and ChatGPT
//! desktop apps. Neither app puts its copy where other programs look, so
//! someone with only the app (no command-line install) would otherwise be
//! told to install a tool they in effect already have. Mailboat installs
//! nothing itself (owner, 2026-10-25): it uses what's there.
//!
//! These places aren't documented and move with app updates, so they're
//! searched by pattern, newest version first. Found on the owner's Mac and
//! Windows VM (2026-10-25):
//!
//! - Claude app: `<data>/Claude/claude-code/<version>/<id>/` then
//!   `claude.app/Contents/MacOS/claude` (Mac) or `claude.exe` (Windows),
//!   where `<data>` is `~/Library/Application Support` (Mac), `%APPDATA%`,
//!   or, for the Microsoft Store-style install,
//!   `%LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming`.
//! - ChatGPT app (Mac): `ChatGPT.app/Contents/Resources/codex-cli/
//!   CodexCLI.app/Contents/MacOS/codex`; the Codex app (MonoCode's
//!   fallback): `Codex.app/Contents/Resources/codex`.
//! - Windows: `%LOCALAPPDATA%\OpenAI\Codex\bin\<id>\codex.exe` and
//!   `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin\codex.exe`.
//!
//! A command-line install wins when there's one (`Programs::find`): it's
//! the one the owner keeps up to date, and the apps' copies can be
//! pre-releases pinned to the app.

use std::path::{Path, PathBuf};

/// The Claude app's Claude Code, newest version, if the app is installed.
pub fn claude() -> Option<PathBuf> {
    let binary: &[&str] = if cfg!(windows) {
        &["claude.exe"]
    } else {
        &["claude.app", "Contents", "MacOS", "claude"]
    };
    claude_data_dirs()
        .into_iter()
        .filter_map(|data| newest(&data.join("Claude").join("claude-code"), binary))
        .max_by(|a, b| compare_versions(&a.0, &b.0))
        .map(|(_, path)| path)
}

/// The ChatGPT (or Codex) app's Codex, if one is installed.
pub fn codex() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if cfg!(windows) {
        if let Some(local) = env_dir("LOCALAPPDATA") {
            candidates.push(local.join(r"Programs\OpenAI\Codex\bin\codex.exe"));
            // One folder per build, named by an ID: any that has it.
            candidates
                .extend(subdirs(&local.join(r"OpenAI\Codex\bin")).map(|d| d.join("codex.exe")));
        }
    } else {
        let mut apps = vec![PathBuf::from("/Applications")];
        if let Some(home) = env_dir("HOME") {
            apps.push(home.join("Applications"));
        }
        for dir in apps {
            candidates.push(dir.join(
                "ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex",
            ));
            candidates.push(dir.join("Codex.app/Contents/Resources/codex"));
        }
    }
    candidates.into_iter().find(|p| p.is_file())
}

/// Where the Claude app keeps its data, on this system.
fn claude_data_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if cfg!(windows) {
        dirs.extend(env_dir("APPDATA"));
        if let Some(local) = env_dir("LOCALAPPDATA") {
            for package in subdirs(&local.join("Packages")) {
                let is_claude = package
                    .file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.starts_with("Claude_"));
                if is_claude {
                    dirs.push(package.join(r"LocalCache\Roaming"));
                }
            }
        }
    } else if let Some(home) = env_dir("HOME") {
        dirs.push(home.join("Library/Application Support"));
    }
    dirs
}

/// In `root/<version>/<id>/<binary…>`: the newest version that has the
/// binary, with that version's name.
fn newest(root: &Path, binary: &[&str]) -> Option<(String, PathBuf)> {
    subdirs(root)
        .filter_map(|version| {
            let name = version.file_name()?.to_str()?.to_string();
            let path = subdirs(&version)
                .map(|id| binary.iter().fold(id, |p, part| p.join(part)))
                .find(|p| p.is_file())?;
            Some((name, path))
        })
        .max_by(|a, b| compare_versions(&a.0, &b.0))
}

/// "2.1.308" after "2.1.99": numbers compared as numbers.
fn compare_versions(a: &str, b: &str) -> std::cmp::Ordering {
    let parts = |v: &str| -> Vec<u64> { v.split('.').map(|p| p.parse().unwrap_or(0)).collect() };
    parts(a).cmp(&parts(b))
}

fn subdirs(dir: &Path) -> impl Iterator<Item = PathBuf> {
    std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir())
}

fn env_dir(name: &str) -> Option<PathBuf> {
    std::env::var_os(name)
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_compare_as_numbers() {
        use std::cmp::Ordering::*;
        assert_eq!(compare_versions("2.1.308", "2.1.99"), Greater);
        assert_eq!(compare_versions("2.1.295", "2.1.308"), Less);
        assert_eq!(compare_versions("2.1.3", "2.1.3"), Equal);
    }

    #[test]
    fn finds_the_newest_version_that_has_the_binary() {
        let root = std::env::temp_dir().join(format!("mailboat-apps-{}", fastrand::u64(..)));
        let make = |rel: &str| {
            let path = root.join(rel);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, b"").unwrap();
        };
        make("2.1.295/9d64/claude.exe");
        make("2.1.308/a93d/claude.exe");
        // A newer version still downloading: no binary yet, so skipped.
        std::fs::create_dir_all(root.join("2.1.400/ffff")).unwrap();
        let (version, path) = newest(&root, &["claude.exe"]).unwrap();
        assert_eq!(version, "2.1.308");
        assert_eq!(path, root.join("2.1.308/a93d/claude.exe"));
        assert!(newest(&root.join("missing"), &["claude.exe"]).is_none());
        let _ = std::fs::remove_dir_all(&root);
    }
}
