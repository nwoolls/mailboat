//! App-wide state shared by commands: the database, the HTTP client, the
//! keychain, per-account Gmail clients and the sync supervisor.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use mailboat_core::auth::{AccountTokens, OAuthClientConfig, SecretStore};
use mailboat_core::db::{accounts, Db};
use mailboat_core::gmail::GmailClient;
use mailboat_core::model::AccountId;
use mailboat_core::reqwest;
use mailboat_core::sync::Supervisor;
use mailboat_core::Result;

pub struct AppState {
    pub db: Arc<Db>,
    pub http: reqwest::Client,
    pub secrets: Arc<dyn SecretStore>,
    pub supervisor: Supervisor,
    pub config_dir: PathBuf,
    pub sync_log: Arc<crate::sync_log::SyncLog>,
    /// One Gmail client per account (see `gmail_for`).
    clients: Mutex<HashMap<AccountId, GmailClient>>,
    /// Only one browser sign-in at a time.
    pub sign_in: tokio::sync::Mutex<()>,
}

impl AppState {
    pub fn new(
        db: Arc<Db>,
        http: reqwest::Client,
        secrets: Arc<dyn SecretStore>,
        supervisor: Supervisor,
        config_dir: PathBuf,
        sync_log: Arc<crate::sync_log::SyncLog>,
    ) -> Self {
        Self {
            db,
            http,
            secrets,
            supervisor,
            config_dir,
            sync_log,
            clients: Mutex::new(HashMap::new()),
            sign_in: tokio::sync::Mutex::new(()),
        }
    }

    /// Loaded fresh each time so a newly saved client file is picked up
    /// without restarting.
    pub fn oauth_config(&self) -> Result<OAuthClientConfig> {
        OAuthClientConfig::load(&self.config_dir)
    }

    /// The Gmail client acting as this account: its own token, never
    /// another's. One client per account is shared by sync and commands so
    /// they draw from the same quota budget and access-token cache.
    pub fn gmail_for(&self, account: AccountId) -> Result<GmailClient> {
        let cached = self.clients.lock().unwrap().get(&account).cloned();
        if let Some(client) = cached {
            return Ok(client);
        }
        let sub = accounts::google_sub(&self.db.conn(), account)?;
        let tokens = Arc::new(AccountTokens::new(
            self.http.clone(),
            self.oauth_config()?,
            self.secrets.clone(),
            &sub,
        ));
        Ok(self.set_tokens(account, tokens))
    }

    /// Installs fresh credentials for an account (after signing in).
    pub fn set_tokens(&self, account: AccountId, tokens: Arc<AccountTokens>) -> GmailClient {
        let log = self.sync_log.clone();
        let client = GmailClient::new(self.http.clone(), tokens)
            .with_logger(Arc::new(move |line: &str| log.write(account, line)));
        self.clients.lock().unwrap().insert(account, client.clone());
        client
    }

    pub fn forget_account(&self, account: AccountId) {
        self.clients.lock().unwrap().remove(&account);
    }

    /// Resumes syncing every connected account at startup. One that can't
    /// start (e.g. missing OAuth client file) doesn't stop the others.
    pub fn resume_all_accounts(&self) -> Result<()> {
        // Read the list into a variable first: a DB lock taken inside a
        // `for` header would be held for the whole loop, and starting sync
        // needs the same lock (that deadlock froze the app at launch).
        let all = accounts::list(&self.db.conn())?;
        for account in all {
            if let Err(e) = self.start_sync(account.id) {
                eprintln!("could not start sync for account {}: {e}", account.id.0);
            }
        }
        Ok(())
    }

    pub fn start_sync(&self, account: AccountId) -> Result<()> {
        self.supervisor.start(account, self.gmail_for(account)?);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mailboat_core::auth::MemoryStore;
    use mailboat_core::model::{AccountId, AccountSyncState};
    use mailboat_core::sync::{SyncConfig, SyncEvents, SyncProgress, WorkerTiming};
    use std::time::Duration;

    struct NoEvents;
    impl SyncEvents for NoEvents {
        fn status(&self, _: AccountSyncState) {}
        fn progress(&self, _: SyncProgress) {}
        fn mail_changed(&self, _: AccountId) {}
    }

    /// Regression: startup froze (self-deadlock on the DB lock) as soon as
    /// one account was connected.
    #[test]
    fn resuming_accounts_at_startup_does_not_deadlock() {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let db = Arc::new(Db::open_in_memory().unwrap());
        for sub in ["a", "b"] {
            accounts::upsert(
                &db.conn(),
                &accounts::NewAccount {
                    google_sub: sub,
                    email: &format!("{sub}@x.com"),
                    display_name: None,
                    avatar_url: None,
                    oauth_client: "default",
                },
            )
            .unwrap();
        }
        let supervisor = Supervisor::new(
            runtime.handle().clone(),
            db.clone(),
            Arc::new(NoEvents),
            SyncConfig::default(),
            WorkerTiming::default(),
        );
        let config_dir = std::env::temp_dir().join("mailboat-test-no-oauth-client");
        let log = Arc::new(crate::sync_log::SyncLog::open(
            &std::env::temp_dir().join("mailboat-test-logs"),
        ));
        let state = AppState::new(
            db,
            reqwest::Client::new(),
            Arc::new(MemoryStore::default()),
            supervisor,
            config_dir,
            log,
        );

        let (done_tx, done_rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let result = state.resume_all_accounts();
            let _ = done_tx.send(result.is_ok());
        });
        let finished = done_rx.recv_timeout(Duration::from_secs(5));
        assert_eq!(finished, Ok(true), "resume_all_accounts hung or failed");
    }
}
