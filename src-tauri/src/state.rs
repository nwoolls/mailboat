//! App-wide state shared by commands: the database, the HTTP client, the
//! keychain, per-account token caches and the sync supervisor.

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
    /// One token cache per account, so access tokens are reused.
    tokens: Mutex<HashMap<AccountId, Arc<AccountTokens>>>,
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
    ) -> Self {
        Self {
            db,
            http,
            secrets,
            supervisor,
            config_dir,
            tokens: Mutex::new(HashMap::new()),
            sign_in: tokio::sync::Mutex::new(()),
        }
    }

    /// Loaded fresh each time so a newly saved client file is picked up
    /// without restarting.
    pub fn oauth_config(&self) -> Result<OAuthClientConfig> {
        OAuthClientConfig::load(&self.config_dir)
    }

    pub fn tokens_for(&self, account: AccountId) -> Result<Arc<AccountTokens>> {
        if let Some(t) = self.tokens.lock().unwrap().get(&account) {
            return Ok(t.clone());
        }
        let sub = accounts::google_sub(&self.db.conn(), account)?;
        let tokens = Arc::new(AccountTokens::new(
            self.http.clone(),
            self.oauth_config()?,
            self.secrets.clone(),
            &sub,
        ));
        self.tokens.lock().unwrap().insert(account, tokens.clone());
        Ok(tokens)
    }

    pub fn set_tokens(&self, account: AccountId, tokens: Arc<AccountTokens>) {
        self.tokens.lock().unwrap().insert(account, tokens);
    }

    pub fn forget_tokens(&self, account: AccountId) {
        self.tokens.lock().unwrap().remove(&account);
    }

    /// A Gmail client acting as this account (its own token, never another's).
    pub fn gmail_for(&self, account: AccountId) -> Result<GmailClient> {
        Ok(GmailClient::new(
            self.http.clone(),
            self.tokens_for(account)?,
        ))
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
        let state = AppState::new(
            db,
            reqwest::Client::new(),
            Arc::new(MemoryStore::default()),
            supervisor,
            config_dir,
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
