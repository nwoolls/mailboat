//! One background worker per account. Each worker has its own cursor,
//! backoff and error state, so a failing account (expired sign-in, quota)
//! never blocks the others.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::sync::Notify;
use tokio::task::JoinHandle;

use super::engine::{SyncConfig, SyncEngine, SyncPhase, SyncProgress};
use crate::db::{store, Db};
use crate::error::CoreError;
use crate::gmail::GmailClient;
use crate::model::{AccountId, AccountSyncState, SyncStatus};

/// Where workers report to (the Tauri layer forwards these to the window).
pub trait SyncEvents: Send + Sync {
    fn status(&self, state: AccountSyncState);
    fn progress(&self, progress: SyncProgress);
    fn mail_changed(&self, account: AccountId);
    /// A diagnostic line for the sync log.
    fn log(&self, _account: AccountId, _line: &str) {}
    /// The account's From addresses (Gmail "Send mail as") were refreshed.
    fn identities_changed(&self, _account: AccountId) {}
    /// The account's own details (its name or picture) changed.
    fn account_changed(&self, _account: AccountId) {}
    /// New unread mail arrived (for notifications): `inbox` in the
    /// account's Inbox, `all` anywhere but Spam and Trash (Inbox included).
    fn new_mail(
        &self,
        _account: AccountId,
        _inbox: &[crate::model::MessageId],
        _all: &[crate::model::MessageId],
    ) {
    }
}

#[derive(Debug, Clone)]
pub struct WorkerTiming {
    pub poll_interval: Duration,
    pub backoff_base: Duration,
    pub backoff_max: Duration,
    pub error_retry: Duration,
    /// How often the account's Google profile (name and picture) is read
    /// again while the app runs, and after a launch first.
    pub profile_every: Duration,
    /// When reading it failed for a reason that may pass (offline).
    pub profile_retry: Duration,
    /// The longest a profile read may hold up the mail sync pass it comes
    /// before: a slow or silent profile endpoint must not delay the mail.
    pub profile_timeout: Duration,
}

impl Default for WorkerTiming {
    fn default() -> Self {
        Self {
            poll_interval: Duration::from_secs(60),
            backoff_base: Duration::from_secs(30),
            backoff_max: Duration::from_secs(15 * 60),
            error_retry: Duration::from_secs(5 * 60),
            profile_every: Duration::from_secs(24 * 3600),
            profile_retry: Duration::from_secs(3600),
            profile_timeout: Duration::from_secs(20),
        }
    }
}

struct Worker {
    wake: Arc<Notify>,
    task: JoinHandle<()>,
}

pub struct Supervisor {
    runtime: tokio::runtime::Handle,
    db: Arc<Db>,
    events: Arc<dyn SyncEvents>,
    config: SyncConfig,
    timing: WorkerTiming,
    workers: Mutex<HashMap<AccountId, Worker>>,
}

impl Supervisor {
    /// `runtime` is where workers run; pass it explicitly because app setup
    /// code may not be inside the async runtime.
    pub fn new(
        runtime: tokio::runtime::Handle,
        db: Arc<Db>,
        events: Arc<dyn SyncEvents>,
        config: SyncConfig,
        timing: WorkerTiming,
    ) -> Self {
        Self {
            runtime,
            db,
            events,
            config,
            timing,
            workers: Mutex::new(HashMap::new()),
        }
    }

    /// Starts (or restarts, e.g. after signing in again) an account's worker.
    pub fn start(&self, account: AccountId, gmail: GmailClient) {
        self.stop(account);
        let wake = Arc::new(Notify::new());
        let task = self.runtime.spawn(run_worker(
            account,
            gmail,
            self.db.clone(),
            self.events.clone(),
            self.config.clone(),
            self.timing.clone(),
            wake.clone(),
        ));
        self.workers
            .lock()
            .unwrap()
            .insert(account, Worker { wake, task });
    }

    pub fn stop(&self, account: AccountId) {
        if let Some(w) = self.workers.lock().unwrap().remove(&account) {
            w.task.abort();
        }
    }

    /// Stops an account's worker and waits until it has really ended, so
    /// nothing it was doing can write to the database afterwards (needed
    /// before removing the account's data).
    pub async fn stop_and_wait(&self, account: AccountId) {
        let worker = self.workers.lock().unwrap().remove(&account);
        if let Some(w) = worker {
            w.task.abort();
            // A cancelled task reports a JoinError; that is the expected end.
            let _ = w.task.await;
        }
    }

    /// Wakes the given accounts' workers (all if `None`) to sync right away.
    pub fn sync_now(&self, accounts: Option<&[AccountId]>) {
        let workers = self.workers.lock().unwrap();
        for (id, w) in workers.iter() {
            if accounts.is_none_or(|a| a.contains(id)) {
                w.wake.notify_one();
            }
        }
    }

    pub fn is_running(&self, account: AccountId) -> bool {
        self.workers
            .lock()
            .unwrap()
            .get(&account)
            .is_some_and(|w| !w.task.is_finished())
    }
}

impl Drop for Supervisor {
    fn drop(&mut self) {
        for (_, w) in self.workers.lock().unwrap().drain() {
            w.task.abort();
        }
    }
}

async fn run_worker(
    account: AccountId,
    gmail: GmailClient,
    db: Arc<Db>,
    events: Arc<dyn SyncEvents>,
    config: SyncConfig,
    timing: WorkerTiming,
    wake: Arc<Notify>,
) {
    let mut failures: u32 = 0;
    // From addresses (and the signatures they carry) and Google contacts
    // are fetched once per worker (each launch, or after signing in
    // again): before the first pass, so a new account is usable while its
    // mail is still coming in, and again after a pass if that attempt
    // failed for a reason that may pass (offline, Gmail busy).
    let mut identities_fresh = false;
    let mut contacts_fresh = false;
    // The Google profile (name, picture) at each launch, then once a day.
    let mut profile_due = tokio::time::Instant::now();
    loop {
        set_status(&db, &*events, account, SyncStatus::Syncing, None);
        // The quick things first (owner, 2026-10-29: a message written
        // during a first sync had no signature). A few small requests that
        // don't depend on the mail; labels are already first in a full sync.
        if !identities_fresh {
            identities_fresh = load_identities(&db, &gmail, &*events, account).await;
        }
        if !contacts_fresh {
            contacts_fresh = load_contacts(&db, &gmail, &*events, account).await;
        }
        if tokio::time::Instant::now() >= profile_due {
            let done =
                refresh_profile(&db, &gmail, &*events, account, timing.profile_timeout).await;
            profile_due = tokio::time::Instant::now()
                + if done {
                    timing.profile_every
                } else {
                    timing.profile_retry
                };
        }
        let progress_events = events.clone();
        let progress = move |p: SyncProgress| {
            // Each fetched chunk is already saved; let the UI show it now
            // rather than after a long initial sync finishes.
            if p.phase == SyncPhase::Fetching && p.done > 0 {
                progress_events.mail_changed(p.account_id);
            }
            progress_events.progress(p);
        };
        let engine = SyncEngine {
            db: &db,
            gmail: &gmail,
            account,
            config: &config,
            progress: &progress,
        };
        let result = engine.run().await;

        // None = wait only for an explicit wake (needs the user).
        let wait: Option<Duration> = match result {
            Ok(outcome) => {
                failures = 0;
                events.log(
                    account,
                    &format!(
                        "sync ok ({:?}): {} threads changed",
                        outcome.kind, outcome.changed_threads
                    ),
                );
                set_status(&db, &*events, account, SyncStatus::Idle, None);
                if outcome.changed_threads > 0 {
                    events.mail_changed(account);
                }
                if !outcome.new_unread.is_empty() {
                    events.new_mail(account, &outcome.new_inbox, &outcome.new_unread);
                }
                // Images of mail that just arrived, so opening it later
                // doesn't tell the sender when. A failure only costs the
                // head start: images then load when the email is opened.
                if let Some(prefetch) = &config.images {
                    match crate::mail::prefetch::run(&db, prefetch, account).await {
                        Ok(r) if r.messages > 0 => events.log(
                            account,
                            &format!(
                                "images downloaded ahead: {} for {} messages ({} failed)",
                                r.images, r.messages, r.failed
                            ),
                        ),
                        Ok(_) => {}
                        Err(e) => events.log(
                            account,
                            &format!("image download failed ({}): {}", e.kind(), e.for_log()),
                        ),
                    }
                }
                // Whatever the attempt before the pass couldn't do.
                if !contacts_fresh {
                    contacts_fresh = load_contacts(&db, &gmail, &*events, account).await;
                }
                if !identities_fresh {
                    identities_fresh = load_identities(&db, &gmail, &*events, account).await;
                }
                Some(timing.poll_interval)
            }
            Err(e) => {
                events.log(
                    account,
                    &format!("sync failed ({}): {}", e.kind(), e.for_log()),
                );
                // Partial progress may already be written; let the UI refresh.
                events.mail_changed(account);
                match &e {
                    CoreError::Auth(_) => {
                        set_status(&db, &*events, account, SyncStatus::AuthError, Some(&e));
                        None
                    }
                    // The Gmail client has already slowed itself down, so
                    // retry soon rather than backing off for minutes.
                    CoreError::RateLimited(_) => {
                        failures += 1;
                        set_status(&db, &*events, account, SyncStatus::Backoff, Some(&e));
                        Some(timing.backoff_base.min(timing.backoff_max))
                    }
                    e if e.is_transient() => {
                        failures += 1;
                        set_status(&db, &*events, account, SyncStatus::Backoff, Some(e));
                        let exp = timing
                            .backoff_base
                            .saturating_mul(1u32 << (failures - 1).min(10));
                        Some(exp.min(timing.backoff_max))
                    }
                    e => {
                        set_status(&db, &*events, account, SyncStatus::Error, Some(e));
                        Some(timing.error_retry)
                    }
                }
            }
        };

        match wait {
            Some(d) => {
                tokio::select! {
                    _ = tokio::time::sleep(d) => {}
                    _ = wake.notified() => {}
                }
            }
            None => wake.notified().await,
        }
    }
}

/// Fetches the account's From addresses ("Send mail as") and their
/// signatures. Returns whether it is done with them: false after a failure,
/// so the next chance tries again.
async fn load_identities(
    db: &Db,
    gmail: &GmailClient,
    events: &dyn SyncEvents,
    account: AccountId,
) -> bool {
    match crate::compose::identities::refresh(db, gmail, account).await {
        Ok(()) => {
            events.identities_changed(account);
            true
        }
        Err(e) => {
            events.log(
                account,
                &format!(
                    "could not read Send mail as addresses ({}): {}",
                    e.kind(),
                    e.for_log()
                ),
            );
            false
        }
    }
}

/// Reads the account's Google profile again and saves a changed name or
/// picture, so a new photo shows without signing in again. A failure keeps
/// what was saved. Gives up after `limit` (it runs before the mail pass, and
/// the client's own retries could take minutes). Returns whether to wait the
/// full period: false only after a failure that may pass (offline, too
/// slow), so it tries again sooner.
async fn refresh_profile(
    db: &Db,
    gmail: &GmailClient,
    events: &dyn SyncEvents,
    account: AccountId,
    limit: Duration,
) -> bool {
    let read = match tokio::time::timeout(limit, gmail.user_profile()).await {
        Ok(read) => read,
        Err(_) => Err(CoreError::Network("the profile took too long".into())),
    };
    match read {
        Ok(profile) => {
            let saved = crate::db::accounts::set_profile(
                &db.conn(),
                account,
                profile.name.as_deref(),
                profile.picture.as_deref(),
            );
            match saved {
                Ok(true) => {
                    events.log(account, "profile refreshed");
                    events.account_changed(account);
                }
                Ok(false) => {}
                Err(e) => events.log(
                    account,
                    &format!("could not save the profile ({}): {}", e.kind(), e.for_log()),
                ),
            }
            true
        }
        Err(e) => {
            events.log(
                account,
                &format!("profile unavailable ({}): {}", e.kind(), e.for_log()),
            );
            !e.is_transient()
        }
    }
}

/// Fetches Google contacts for address suggestions. An account without the
/// contacts permission (signed in before it was asked for) is noted in the
/// log and carries on, and isn't asked again until the next launch.
/// Returns whether it is done: false only after a failure that may pass
/// (offline, Gmail busy), so the next chance tries again.
async fn load_contacts(
    db: &Db,
    gmail: &GmailClient,
    events: &dyn SyncEvents,
    account: AccountId,
) -> bool {
    match crate::compose::contacts::refresh_google(db, gmail, account).await {
        Ok(n) => {
            events.log(account, &format!("Google contacts: {n} addresses"));
            events.mail_changed(account);
            true
        }
        Err(e) => {
            events.log(
                account,
                &format!(
                    "Google contacts unavailable ({}): {}; sign in again to allow them",
                    e.kind(),
                    e.for_log()
                ),
            );
            !e.is_transient()
        }
    }
}

fn set_status(
    db: &Db,
    events: &dyn SyncEvents,
    account: AccountId,
    status: SyncStatus,
    error: Option<&CoreError>,
) {
    let message = error.map(|e| e.to_string());
    let error_pair = error.map(|e| (e.kind(), message.as_deref().unwrap_or("")));
    let conn = db.conn();
    // If the account was removed meanwhile there is nothing to update.
    let _ = store::set_sync_status(&conn, account, status, error_pair);
    let stored = store::sync_states(&conn)
        .ok()
        .and_then(|all| all.into_iter().find(|s| s.account_id == account));
    drop(conn);
    events.status(stored.unwrap_or(AccountSyncState {
        account_id: account,
        status,
        error_kind: error.map(|e| e.kind().to_string()),
        error_message: message,
        last_sync_at: None,
    }));
}
