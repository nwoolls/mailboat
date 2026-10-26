//! The unread count on the Dock icon, across every account. What it
//! counts is a setting (`AppSettings::dock_badge`).
//!
//! Mail changes in many places (sync, actions, another copy of Mailboat), so
//! rather than hook each one, a watcher checks once a second whether the
//! database was written to (two cheap SQLite counters) and recounts only
//! then. Saving the setting is a write too, so it shows within a second.

use std::sync::Arc;
use std::time::Duration;

use mail_core::db::{query, Db};
use mail_core::settings::{self, DockBadge};
use tauri::{AppHandle, Manager};

pub fn watch(app: AppHandle, db: Arc<Db>) {
    tauri::async_runtime::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(1));
        let mut seen = None;
        let mut shown = None;
        loop {
            tick.tick().await;
            let Ok(version) = write_version(&db) else {
                continue;
            };
            if seen == Some(version) {
                continue;
            }
            seen = Some(version);
            let Ok(badge) = badge(&db) else {
                continue;
            };
            if shown == Some(badge) {
                continue;
            }
            if let Some(window) = app.get_webview_window("main") {
                if window.set_badge_count(badge).is_ok() {
                    shown = Some(badge);
                }
            }
        }
    });
}

/// Moves whenever this copy (`total_changes`) or another copy
/// (`data_version`) writes to the database.
fn write_version(db: &Db) -> mail_core::Result<(u64, i64)> {
    let conn = db.conn();
    let elsewhere: i64 = conn.query_row("PRAGMA data_version", [], |r| r.get(0))?;
    Ok((conn.total_changes(), elsewhere))
}

/// The number to show, or `None` for no badge (nothing unread, or off).
fn badge(db: &Db) -> mail_core::Result<Option<i64>> {
    let conn = db.conn();
    let which = settings::load(&conn)?.dock_badge;
    let unread = match which {
        DockBadge::Off => return Ok(None),
        DockBadge::Inbox => query::unread_threads(&conn, true)?,
        DockBadge::Unread => query::unread_threads(&conn, false)?,
    };
    Ok((unread > 0).then_some(i64::from(unread)))
}
