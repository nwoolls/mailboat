//! What starting the app knew about the mail cache, for the window: a
//! problem that kept it from opening (the window then shows only that, with
//! Try again and Quit), and whether a new cache was started because its key
//! was gone (the window says so once). See `mail_core::db::cache`.

use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use specta::Type;
use tauri::{AppHandle, State};

use crate::error::CmdResult;

/// Why the mail cache couldn't be opened.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum StartupProblem {
    /// The keychain didn't answer (locked, access denied, no keyring).
    Keychain,
    /// Another copy of the app has the cache open, and it needs setting
    /// aside, which waits for that copy to close.
    InUse,
}

pub struct Startup {
    pub problem: Option<StartupProblem>,
    cache_reset: AtomicBool,
}

impl Startup {
    pub fn opened(cache_reset: bool) -> Self {
        Self {
            problem: None,
            cache_reset: AtomicBool::new(cache_reset),
        }
    }

    pub fn stopped(problem: StartupProblem) -> Self {
        Self {
            problem: Some(problem),
            cache_reset: AtomicBool::new(false),
        }
    }
}

/// The lock every running copy keeps on the cache (`mail_core::db::cache`),
/// held for as long as the app runs.
pub struct HeldCacheLock(#[allow(dead_code)] pub mail_core::db::cache::CacheLock);

/// What kept the mail cache from opening, if anything. The window asks
/// first and shows only that problem when there is one.
#[tauri::command]
#[specta::specta]
pub fn startup_problem(state: State<'_, Startup>) -> Option<StartupProblem> {
    state.problem
}

/// Whether this start set an unreadable cache aside and began a new one
/// (its key was gone from the keychain): the window says so until dismissed.
#[tauri::command]
#[specta::specta]
pub fn cache_reset_notice(state: State<'_, Startup>) -> bool {
    state.cache_reset.load(Ordering::Relaxed)
}

#[tauri::command]
#[specta::specta]
pub fn cache_reset_notice_dismiss(state: State<'_, Startup>) {
    state.cache_reset.store(false, Ordering::Relaxed);
}

/// Starts the app again, to try opening the cache once more. Outside the
/// normal mode (a clean start, the demo) Tauri's own restart, which keeps
/// the arguments that chose the mode: the Mac's relaunch helper opens the
/// app without them, in the normal mode, with the owner's real cache.
#[tauri::command]
#[specta::specta]
pub async fn startup_try_again(app: AppHandle) -> CmdResult<()> {
    if !crate::mode::Mode::from_args(std::env::args().skip(1)).is_normal() {
        app.restart();
    }
    crate::updates::relaunch(&app).await
}

/// Quits the app (from the window shown when the cache couldn't open).
#[tauri::command]
#[specta::specta]
pub fn startup_quit(app: AppHandle) {
    app.exit(0);
}
