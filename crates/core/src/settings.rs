//! App-wide settings that Rust acts on, from the Settings page. Settings
//! only the window uses (like transparency) stay in the web view's storage,
//! so they apply before the first paint.
//!
//! Stored as one JSON value; a setting missing from it (added in a later
//! version) takes its default.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::ai::{AiProvider, Quality};
use crate::error::{CoreError, Result};
use crate::mail::images::RemoteImages;
use crate::model::AccountId;

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

/// Which releases the updater offers: only finished ones (the default), or
/// test versions ("betas") too, which come first and may have bugs.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum UpdateChannel {
    #[default]
    Stable,
    Beta,
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

/// Which new mail notifies: what arrives in an Inbox (the default), or
/// anything new except Spam and Trash (mail a rule skipped the Inbox for).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum NotifyFor {
    #[default]
    Inbox,
    AllNew,
}

/// A stretch of each day without notifications, in minutes after local
/// midnight. `start` after `end` runs overnight (22:00 to 07:00).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct QuietHours {
    pub on: bool,
    pub start: u16,
    pub end: u16,
}

impl Default for QuietHours {
    fn default() -> Self {
        Self {
            on: false,
            start: 22 * 60,
            end: 7 * 60,
        }
    }
}

impl QuietHours {
    /// Whether `minute` (after local midnight) is inside them.
    pub fn covers(&self, minute: u16) -> bool {
        if !self.on || self.start == self.end {
            return false;
        }
        if self.start < self.end {
            (self.start..self.end).contains(&minute)
        } else {
            minute >= self.start || minute < self.end
        }
    }

    /// Whether it's quiet now, by this Mac's clock.
    pub fn covers_now(&self) -> bool {
        use chrono::Timelike;
        let now = chrono::Local::now();
        self.covers((now.hour() * 60 + now.minute()) as u16)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    /// Show a macOS notification when new mail arrives in an Inbox.
    pub new_mail_notifications: bool,
    /// Which new mail notifies.
    pub notify_for: NotifyFor,
    /// When notifications stay quiet.
    pub quiet_hours: QuietHours,
    /// Set on the window from Rust, so the glass, the page and emails'
    /// own dark styles all follow it, from the first paint.
    pub theme: Theme,
    /// Which of the app icon choices shows in the Dock, by name (e.g.
    /// "C10-orange"); `None` is the icon the app is built with.
    pub app_icon: Option<String>,
    /// The unread count on the Dock icon, across every account.
    pub dock_badge: DockBadge,
    /// Whether remote images load for senders without a saved choice.
    pub remote_images: RemoteImages,
    /// Download remote images when mail arrives, as Apple Mail's "Protect
    /// Mail Activity" does (`mail::prefetch`).
    pub image_prefetch: bool,
    /// The most the downloaded images may take, in MB.
    pub image_cache_mb: u32,
    /// Summaries and writing help (Settings → AI).
    pub ai: AiSettings,
    /// What AI apps (Claude Desktop, Claude Code) may do with each
    /// account's mail through the app's MCP server. Nothing by default.
    pub mcp: McpSettings,
    /// Look for a new version at launch and about once a day. It only
    /// looks and tells: installing is always the person's click.
    pub auto_check_updates: bool,
    /// Whether test versions are offered as updates too. Choosing Stable
    /// again never goes back to an older version: it only waits for a
    /// finished release newer than the one installed.
    pub update_channel: UpdateChannel,
}

/// Which accounts AI apps may use through the MCP server (`crate::mcp`),
/// by surrogate ID. Reading and creating drafts are separate choices;
/// drafts need reading too. Nothing is ever sent.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct McpSettings {
    pub read: Vec<AccountId>,
    pub drafts: Vec<AccountId>,
}

impl McpSettings {
    pub fn can_read(&self, account: AccountId) -> bool {
        self.read.contains(&account)
    }

    pub fn can_draft(&self, account: AccountId) -> bool {
        self.can_read(account) && self.drafts.contains(&account)
    }
}

/// When the summary above an opened conversation appears.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ReaderSummary {
    Off,
    /// A Summarize button; nothing is sent until it's pressed.
    Button,
    /// By itself, for conversations long enough to need one.
    #[default]
    Auto,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct AiSettings {
    /// Claude and ChatGPT once connected (signed in through their own
    /// tools). Apple Intelligence needs no connecting.
    pub connected: Vec<AiProvider>,
    /// Who writes the one-line summaries in the list; `None` is off
    /// (the email's own first words show, as before).
    pub list_summaries: Option<AiProvider>,
    pub reader_summary: ReaderSummary,
    pub reader_provider: AiProvider,
    /// Who helps write replies and new mail.
    pub writing_provider: AiProvider,
    /// Which Claude model writes (Haiku, Sonnet, Opus); for ChatGPT, how
    /// hard it thinks (always "best", medium, now that the model is chosen).
    pub writing_quality: Quality,
    /// Which ChatGPT model writes (a Codex catalog slug); `None` is
    /// Codex's default.
    pub chatgpt_model: Option<String>,
    /// Keep saved summaries (the default): each is reused until new mail
    /// arrives in its conversation, and stays on this computer until it is
    /// written again or cleared. Off: they are forgotten when the app quits
    /// and at the next launch (`ai::summaries::forget_unless_kept`), so one
    /// lives only as long as the app stays open.
    pub keep_summaries: bool,
}

impl Default for AiSettings {
    /// Apple Intelligence for everything, as it keeps mail on the Mac.
    /// Elsewhere list summaries start off: they'd send every conversation
    /// scrolled past to a cloud provider, which has to be chosen.
    fn default() -> Self {
        Self {
            connected: Vec::new(),
            list_summaries: cfg!(target_os = "macos").then_some(AiProvider::Apple),
            reader_summary: ReaderSummary::Auto,
            reader_provider: AiProvider::Apple,
            writing_provider: AiProvider::Apple,
            writing_quality: Quality::Best,
            chatgpt_model: None,
            keep_summaries: true,
        }
    }
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            new_mail_notifications: true,
            notify_for: NotifyFor::Inbox,
            quiet_hours: QuietHours::default(),
            theme: Theme::System,
            app_icon: None,
            dock_badge: DockBadge::Inbox,
            remote_images: RemoteImages::Load,
            image_prefetch: true,
            image_cache_mb: 500,
            ai: AiSettings::default(),
            mcp: McpSettings::default(),
            auto_check_updates: true,
            update_channel: UpdateChannel::Stable,
        }
    }
}

/// Every setting back to its default ("Restore default settings"), except
/// which AI providers are connected: that's a sign-in, not a preference.
pub fn defaults_from(current: &AppSettings) -> AppSettings {
    AppSettings {
        ai: AiSettings {
            connected: current.ai.connected.clone(),
            ..AiSettings::default()
        },
        ..AppSettings::default()
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
            notify_for: NotifyFor::AllNew,
            quiet_hours: QuietHours {
                on: true,
                start: 60,
                end: 120,
            },
            theme: Theme::Dark,
            app_icon: Some("C10-orange".into()),
            dock_badge: DockBadge::Off,
            remote_images: RemoteImages::Correspondents,
            image_prefetch: false,
            image_cache_mb: 1000,
            auto_check_updates: false,
            update_channel: UpdateChannel::Beta,
            ai: AiSettings {
                connected: vec![AiProvider::Claude],
                list_summaries: None,
                reader_summary: ReaderSummary::Button,
                reader_provider: AiProvider::Claude,
                writing_provider: AiProvider::ChatGpt,
                writing_quality: Quality::Strongest,
                chatgpt_model: Some("gpt-6-astra".into()),
                keep_summaries: false,
            },
            mcp: McpSettings {
                read: vec![AccountId(1), AccountId(2)],
                drafts: vec![AccountId(2)],
            },
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
        assert!(loaded.image_prefetch);
        assert_eq!(loaded.image_cache_mb, 500);
        // Apple Intelligence exists only on macOS; elsewhere nothing is on.
        assert_eq!(
            loaded.ai.list_summaries,
            cfg!(target_os = "macos").then_some(AiProvider::Apple)
        );
        assert_eq!(loaded.notify_for, NotifyFor::Inbox);
        assert!(!loaded.quiet_hours.on);
        // Settings saved before the switch existed look for updates, as new ones do.
        assert!(loaded.auto_check_updates);
        assert_eq!(loaded.update_channel, UpdateChannel::Stable);
        // Settings saved before the switch existed keep their summaries.
        assert!(loaded.ai.keep_summaries);
        conn.execute(
            "UPDATE app_settings SET value = '{\"ai\":{\"connected\":[]}}' WHERE key = 'app'",
            [],
        )
        .unwrap();
        assert!(load(&conn).unwrap().ai.keep_summaries);
    }

    #[test]
    fn restoring_defaults_keeps_ai_connections_only() {
        let changed = AppSettings {
            new_mail_notifications: false,
            theme: Theme::Dark,
            dock_badge: DockBadge::Off,
            ai: AiSettings {
                connected: vec![AiProvider::Claude],
                writing_provider: AiProvider::Claude,
                ..AiSettings::default()
            },
            ..AppSettings::default()
        };
        let restored = defaults_from(&changed);
        assert_eq!(restored.ai.connected, vec![AiProvider::Claude]);
        assert_eq!(
            restored,
            AppSettings {
                ai: AiSettings {
                    connected: vec![AiProvider::Claude],
                    ..AiSettings::default()
                },
                ..AppSettings::default()
            }
        );
    }

    #[test]
    fn quiet_hours_within_a_day_and_overnight() {
        let day = QuietHours {
            on: true,
            start: 9 * 60,
            end: 17 * 60,
        };
        assert!(!day.covers(9 * 60 - 1));
        assert!(day.covers(9 * 60));
        assert!(day.covers(16 * 60 + 59));
        assert!(!day.covers(17 * 60));
        let night = QuietHours::default();
        assert!(!night.covers(23 * 60), "off until switched on");
        let night = QuietHours { on: true, ..night };
        assert!(night.covers(23 * 60));
        assert!(night.covers(0));
        assert!(night.covers(6 * 60 + 59));
        assert!(!night.covers(7 * 60));
        assert!(!night.covers(12 * 60));
        let empty = QuietHours {
            on: true,
            start: 600,
            end: 600,
        };
        assert!(!empty.covers(600));
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
