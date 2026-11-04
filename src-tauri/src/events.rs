//! Events pushed from Rust to the window. Types are exported to TS.

use mail_core::model::{AccountId, AccountSyncState};
use mail_core::sync::{SyncEvents, SyncProgress};
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

/// An account changed in Rust (e.g. the permissions its sign-in carries);
/// re-read the account list.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct AccountsChangedEvent;

/// The app → Settings… (⌘,) in the menu bar: open the Settings page.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct OpenSettingsEvent;

pub struct TauriSyncEvents {
    pub app: AppHandle,
    pub log: std::sync::Arc<crate::sync_log::SyncLog>,
    /// For reading what new mail notifications say.
    pub db: std::sync::Arc<mail_core::db::Db>,
    /// Which accounts' sign-outs have been told already.
    pub sign_outs: std::sync::Mutex<mail_core::mail::notify::SignOuts>,
}

impl TauriSyncEvents {
    /// The OS notification for a sign-out, once per sign-out (the window's
    /// notice is separate and always shows). Follows Settings →
    /// Notifications: off, or quiet hours, and it stays silent.
    fn notify_signed_out(&self, state: &AccountSyncState) {
        let is_new = self
            .sign_outs
            .lock()
            .unwrap()
            .is_new(state.account_id, state.status);
        if !is_new {
            return;
        }
        let (settings, email) = {
            let conn = self.db.conn();
            let settings = mail_core::settings::load(&conn).unwrap_or_default();
            let all = mail_core::db::accounts::list(&conn).unwrap_or_default();
            let email = all
                .into_iter()
                .find(|a| a.id == state.account_id)
                .map(|a| a.email);
            (settings, email)
        };
        let Some(email) = email else {
            // Nothing to say it about (the account list couldn't be read, or
            // the account is gone): not told, so a later report may be.
            self.sign_outs.lock().unwrap().forget(state.account_id);
            return;
        };
        if !settings.new_mail_notifications || settings.quiet_hours.covers_now() {
            return;
        }
        let notice = mail_core::mail::notify::signed_out_notice(&email);
        crate::notifications::show(&self.app, vec![notice]);
    }
}

impl SyncEvents for TauriSyncEvents {
    fn status(&self, state: AccountSyncState) {
        self.notify_signed_out(&state);
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
    fn new_mail(
        &self,
        account: AccountId,
        inbox: &[mail_core::model::MessageId],
        all: &[mail_core::model::MessageId],
    ) {
        use mail_core::settings::NotifyFor;
        // Sign-in codes go to the window whether or not notifications are on.
        if !inbox.is_empty() {
            crate::codes::arrived(&self.app, &self.db, inbox);
        }
        // Settings → Notifications: on or off, which mail, quiet hours.
        let settings = {
            let conn = self.db.conn();
            mail_core::settings::load(&conn).unwrap_or_default()
        };
        if !settings.new_mail_notifications || settings.quiet_hours.covers_now() {
            return;
        }
        let messages = match settings.notify_for {
            NotifyFor::Inbox => inbox,
            NotifyFor::AllNew => all,
        };
        if messages.is_empty() {
            return;
        }
        // The account's address, when there's more than one to tell apart.
        let label = {
            let conn = self.db.conn();
            let all = mail_core::db::accounts::list(&conn).unwrap_or_default();
            (all.len() > 1)
                .then(|| all.into_iter().find(|a| a.id == account).map(|a| a.email))
                .flatten()
        };
        let notices = {
            let conn = self.db.conn();
            mail_core::mail::notify::notices(&conn, account, messages, label.as_deref())
                .unwrap_or_default()
        };
        crate::notifications::show(&self.app, notices);
    }
    fn identities_changed(&self, account_id: AccountId) {
        let _ = IdentitiesChangedEvent { account_id }.emit(&self.app);
    }
}

/// A `mailto:` link arrived; take it with `mailto_take`.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct MailtoEvent;

/// A command chosen in the menu bar, by its ID (`features/commands`).
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct MenuCommandEvent(pub String);
