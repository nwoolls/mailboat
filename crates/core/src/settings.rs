//! App-wide settings that Rust acts on, from the Settings page. Settings
//! only the window uses (like transparency) stay in the web view's storage,
//! so they apply before the first paint.
//!
//! Stored as one JSON value; a setting missing from it (added in a later
//! version) takes its default.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::error::{CoreError, Result};
use crate::mail::images::RemoteImages;

const KEY: &str = "app";

/// Light or dark, or following macOS (the default).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum Theme {
    #[default]
    System,
    Light,
    Dark,
}

/// What the number on the Dock icon counts, named after the folders it
/// matches: unread in All Inboxes (the default), everything in Unread, or
/// nothing.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum DockBadge {
    #[default]
    Inbox,
    /// Saved as "allUnread" before it was renamed to match the folder.
    #[serde(alias = "allUnread")]
    Unread,
    Off,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    /// Show a macOS notification when new mail arrives in an Inbox.
    pub new_mail_notifications: bool,
    /// Set on the window from Rust, so the glass, the page and emails'
    /// own dark styles all follow it, from the first paint.
    pub theme: Theme,
    /// Which of the app icon choices shows in the Dock, by name (e.g.
    /// "C10-orange"); `None` is the icon Mailboat is built with.
    pub app_icon: Option<String>,
    /// The unread count on the Dock icon, across every account.
    pub dock_badge: DockBadge,
    /// Whether remote images load for senders without a saved choice.
    pub remote_images: RemoteImages,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            new_mail_notifications: true,
            theme: Theme::System,
            app_icon: None,
            dock_badge: DockBadge::Inbox,
            remote_images: RemoteImages::Load,
        }
    }
}

/// The saved settings, or the defaults if none were saved (or they can't
/// be read, which shouldn't happen: they're only written by `save`).
pub fn load(conn: &Connection) -> Result<AppSettings> {
    let json: Option<String> = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = ?1",
            [KEY],
            |r| r.get(0),
        )
        .optional()?;
    Ok(json
        .and_then(|j| serde_json::from_str(&j).ok())
        .unwrap_or_default())
}

pub fn save(conn: &Connection, settings: &AppSettings) -> Result<()> {
    let json = serde_json::to_string(settings)
        .map_err(|e| CoreError::Other(format!("save settings: {e}")))?;
    conn.execute(
        "INSERT INTO app_settings (key, value) VALUES (?1, ?2)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        params![KEY, json],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    #[test]
    fn defaults_until_saved_then_what_was_saved() {
        let db = Db::open_in_memory().unwrap();
        let conn = db.conn();
        assert_eq!(load(&conn).unwrap(), AppSettings::default());
        assert!(load(&conn).unwrap().new_mail_notifications);
        let off = AppSettings {
            new_mail_notifications: false,
            theme: Theme::Dark,
            app_icon: Some("C10-orange".into()),
            dock_badge: DockBadge::Off,
            remote_images: RemoteImages::Correspondents,
        };
        save(&conn, &off).unwrap();
        save(&conn, &off).unwrap();
        assert_eq!(load(&conn).unwrap(), off);
    }

    #[test]
    fn settings_missing_from_storage_take_their_default() {
        let db = Db::open_in_memory().unwrap();
        let conn = db.conn();
        conn.execute(
            "INSERT INTO app_settings (key, value) VALUES ('app', '{\"theme\":\"light\"}')",
            [],
        )
        .unwrap();
        let loaded = load(&conn).unwrap();
        assert_eq!(loaded.theme, Theme::Light);
        assert!(loaded.new_mail_notifications);
        assert_eq!(loaded.app_icon, None);
        assert_eq!(loaded.remote_images, RemoteImages::Load);
    }

    #[test]
    fn dock_badge_saved_under_its_old_name_still_loads() {
        let db = Db::open_in_memory().unwrap();
        let conn = db.conn();
        conn.execute(
            "INSERT INTO app_settings (key, value) VALUES ('app', '{\"dockBadge\":\"allUnread\"}')",
            [],
        )
        .unwrap();
        assert_eq!(load(&conn).unwrap().dock_badge, DockBadge::Unread);
    }
}
