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

pub struct TauriSyncEvents {
    pub app: AppHandle,
    pub log: std::sync::Arc<crate::sync_log::SyncLog>,
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
}
