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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    /// Show a macOS notification when new mail arrives in an Inbox.
    pub new_mail_notifications: bool,
    /// Set on the window from Rust, so the glass, the page and emails'
    /// own dark styles all follow it, from the first paint.
    pub theme: Theme,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            new_mail_notifications: true,
            theme: Theme::System,
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
    }
}
