//! One background worker per account. Each worker has its own cursor,
//! backoff and error state, so a failing account (expired sign-in, quota)
//! never blocks the others.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::sync::Notify;
use tokio::task::JoinHandle;

use super::engine::{SyncConfig, SyncEngine, SyncProgress};
use crate::db::{store, Db};
use crate::error::CoreError;
use crate::gmail::GmailClient;
use crate::model::{AccountId, AccountSyncState, SyncStatus};

/// Where workers report to (the Tauri layer forwards these to the window).
pub trait SyncEvents: Send + Sync {
    fn status(&self, state: AccountSyncState);
    fn progress(&self, progress: SyncProgress);
    fn mail_changed(&self, account: AccountId);
}

#[derive(Debug, Clone)]
pub struct WorkerTiming {
    pub poll_interval: Duration,
    pub backoff_base: Duration,
    pub backoff_max: Duration,
    pub error_retry: Duration,
}

impl Default for WorkerTiming {
    fn default() -> Self {
        Self {
            poll_interval: Duration::from_secs(60),
            backoff_base: Duration::from_secs(30),
            backoff_max: Duration::from_secs(15 * 60),
            error_retry: Duration::from_secs(5 * 60),
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
    loop {
        set_status(&db, &*events, account, SyncStatus::Syncing, None);
        let progress_events = events.clone();
        let progress = move |p: SyncProgress| progress_events.progress(p);
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
                set_status(&db, &*events, account, SyncStatus::Idle, None);
                if outcome.changed_threads > 0 {
                    events.mail_changed(account);
                }
                Some(timing.poll_interval)
            }
            Err(e) => {
                // Partial progress may already be written; let the UI refresh.
                events.mail_changed(account);
                match &e {
                    CoreError::Auth(_) => {
                        set_status(&db, &*events, account, SyncStatus::AuthError, Some(&e));
                        None
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
    let last_sync_at = store::sync_states(&conn)
        .ok()
        .and_then(|all| all.into_iter().find(|s| s.account_id == account))
        .and_then(|s| s.last_sync_at);
    drop(conn);
    events.status(AccountSyncState {
        account_id: account,
        status,
        error_kind: error.map(|e| e.kind().to_string()),
        error_message: message,
        last_sync_at,
    });
}
