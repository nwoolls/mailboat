//! Events pushed from Rust to the window. Types are exported to TS.

use mailboat_core::model::{AccountId, AccountSyncState};
use mailboat_core::sync::{SyncEvents, SyncProgress};
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::AppHandle;
use tauri_specta::Event;

/// An account's sync status changed (idle, syncing, backoff, error).
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct SyncStatusEvent(pub AccountSyncState);

/// Progress during a sync pass.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct SyncProgressEvent(pub SyncProgress);

/// Cached mail for this account changed; refresh lists that include it.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct MailChangedEvent {
    pub account_id: AccountId,
}

/// An account's From addresses (Gmail "Send mail as") changed.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct IdentitiesChangedEvent {
    pub account_id: AccountId,
}

/// Mailboat → Settings… (⌘,) in the menu bar: open the Settings page.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct OpenSettingsEvent;

pub struct TauriSyncEvents {
    pub app: AppHandle,
    pub log: std::sync::Arc<crate::sync_log::SyncLog>,
    /// For reading what new mail notifications say.
    pub db: std::sync::Arc<mailboat_core::db::Db>,
}

impl SyncEvents for TauriSyncEvents {
    fn status(&self, state: AccountSyncState) {
        let _ = SyncStatusEvent(state).emit(&self.app);
    }
    fn progress(&self, progress: SyncProgress) {
        let _ = SyncProgressEvent(progress).emit(&self.app);
    }
    fn mail_changed(&self, account_id: AccountId) {
        let _ = MailChangedEvent { account_id }.emit(&self.app);
    }
    fn log(&self, account: AccountId, line: &str) {
        self.log.write(account, line);
    }
    fn new_mail(&self, account: AccountId, messages: &[mailboat_core::model::MessageId]) {
        use tauri_plugin_notification::NotificationExt;
        // Turned off in Settings → Notifications.
        let enabled = {
            let conn = self.db.conn();
            mailboat_core::settings::load(&conn).map_or(true, |s| s.new_mail_notifications)
        };
        if !enabled {
            return;
        }
        // The account's address, when there's more than one to tell apart.
        let label = {
            let conn = self.db.conn();
            let all = mailboat_core::db::accounts::list(&conn).unwrap_or_default();
            (all.len() > 1)
                .then(|| all.into_iter().find(|a| a.id == account).map(|a| a.email))
                .flatten()
        };
        let notices = {
            let conn = self.db.conn();
            mailboat_core::mail::notify::notices(&conn, account, messages, label.as_deref())
                .unwrap_or_default()
        };
        for n in notices {
            let _ = self
                .app
                .notification()
                .builder()
                .title(n.title)
                .body(n.body)
                .show();
        }
    }
    fn identities_changed(&self, account_id: AccountId) {
        let _ = IdentitiesChangedEvent { account_id }.emit(&self.app);
    }
}
