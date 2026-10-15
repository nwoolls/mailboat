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

    pub fn start_sync(&self, account: AccountId) -> Result<()> {
        self.supervisor.start(account, self.gmail_for(account)?);
        Ok(())
    }
}
