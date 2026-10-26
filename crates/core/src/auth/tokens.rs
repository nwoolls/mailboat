//! Token storage. Refresh tokens live only in the OS keychain; access tokens
//! live only in memory and are refreshed shortly before they expire.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use async_trait::async_trait;

use super::config::OAuthClientConfig;
use super::oauth;
use crate::error::{CoreError, Result};
use crate::gmail::TokenSource;

pub const KEYCHAIN_SERVICE: &str = crate::brand::ID;

/// Keychain key for an account's refresh token. Keyed by Google's stable
/// account ID (`sub`), not the email address, which can change.
pub fn refresh_token_key(google_sub: &str) -> String {
    format!("google-refresh:{google_sub}")
}

pub trait SecretStore: Send + Sync {
    fn get(&self, key: &str) -> Result<Option<String>>;
    fn set(&self, key: &str, value: &str) -> Result<()>;
    fn delete(&self, key: &str) -> Result<()>;
}

/// macOS Keychain / Windows Credential Manager / Linux Secret Service.
/// Entries are filed under a service name: the bundle ID, or another one
/// for a copy of the app that must not see the owner's (the clean start).
pub struct KeyringStore {
    service: String,
}

impl Default for KeyringStore {
    fn default() -> Self {
        Self::with_service(KEYCHAIN_SERVICE)
    }
}

impl KeyringStore {
    pub fn with_service(service: &str) -> Self {
        Self {
            service: service.to_string(),
        }
    }
}

impl SecretStore for KeyringStore {
    fn get(&self, key: &str) -> Result<Option<String>> {
        let entry = keyring::Entry::new(&self.service, key).map_err(keychain_err)?;
        match entry.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(keychain_err(e)),
        }
    }

    fn set(&self, key: &str, value: &str) -> Result<()> {
        keyring::Entry::new(&self.service, key)
            .and_then(|e| e.set_password(value))
            .map_err(keychain_err)
    }

    fn delete(&self, key: &str) -> Result<()> {
        let entry = keyring::Entry::new(&self.service, key).map_err(keychain_err)?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(keychain_err(e)),
        }
    }
}

fn keychain_err(e: keyring::Error) -> CoreError {
    CoreError::Keychain(e.to_string())
}

/// In-memory store for tests.
#[derive(Default)]
pub struct MemoryStore(Mutex<HashMap<String, String>>);

impl SecretStore for MemoryStore {
    fn get(&self, key: &str) -> Result<Option<String>> {
        Ok(self.0.lock().unwrap().get(key).cloned())
    }
    fn set(&self, key: &str, value: &str) -> Result<()> {
        self.0.lock().unwrap().insert(key.into(), value.into());
        Ok(())
    }
    fn delete(&self, key: &str) -> Result<()> {
        self.0.lock().unwrap().remove(key);
        Ok(())
    }
}

/// Refresh this long before Google's stated expiry.
const EXPIRY_MARGIN: Duration = Duration::from_secs(120);

struct CachedToken {
    value: String,
    expires_at: Instant,
}

/// Access tokens for one account.
pub struct AccountTokens {
    http: reqwest::Client,
    config: OAuthClientConfig,
    secrets: Arc<dyn SecretStore>,
    key: String,
    cached: tokio::sync::Mutex<Option<CachedToken>>,
    /// Read from the keychain once per launch, then kept in memory, so
    /// macOS asks for keychain access at most once per run.
    refresh_token: std::sync::Mutex<Option<String>>,
    /// Told the permissions Google reports with each new access token, so
    /// they can be recorded (see `accounts::set_granted_scopes`).
    on_scopes: Option<ScopeHook>,
}

/// Receives the permissions an account's token carries.
pub type ScopeHook = Arc<dyn Fn(&[String]) + Send + Sync>;

impl AccountTokens {
    pub fn new(
        http: reqwest::Client,
        config: OAuthClientConfig,
        secrets: Arc<dyn SecretStore>,
        google_sub: &str,
    ) -> Self {
        Self {
            http,
            config,
            secrets,
            key: refresh_token_key(google_sub),
            cached: tokio::sync::Mutex::new(None),
            refresh_token: std::sync::Mutex::new(None),
            on_scopes: None,
        }
    }

    /// Calls `hook` with the permissions of each new access token.
    pub fn with_scope_hook(mut self, hook: ScopeHook) -> Self {
        self.on_scopes = Some(hook);
        self
    }

    fn refresh_token(&self) -> Result<String> {
        let mut slot = self.refresh_token.lock().unwrap();
        if let Some(token) = slot.as_ref() {
            return Ok(token.clone());
        }
        let token = self
            .secrets
            .get(&self.key)?
            .ok_or_else(|| CoreError::Auth("no saved sign-in for this account".into()))?;
        *slot = Some(token.clone());
        Ok(token)
    }

    /// Seeds the cache with the access token from a fresh sign-in.
    pub async fn seed(&self, access_token: String, expires_in: u64) {
        *self.cached.lock().await = Some(CachedToken {
            value: access_token,
            expires_at: Instant::now() + Duration::from_secs(expires_in),
        });
    }
}

#[async_trait]
impl TokenSource for AccountTokens {
    async fn access_token(&self) -> Result<String> {
        let mut cached = self.cached.lock().await;
        if let Some(token) = cached.as_ref() {
            if token.expires_at > Instant::now() + EXPIRY_MARGIN {
                return Ok(token.value.clone());
            }
        }
        let refresh_token = self.refresh_token()?;
        let fresh = match oauth::refresh(&self.http, &self.config, &refresh_token).await {
            Ok(fresh) => fresh,
            Err(e) => {
                // A revoked token must be re-read after the user signs in again.
                if matches!(e, CoreError::Auth(_)) {
                    *self.refresh_token.lock().unwrap() = None;
                }
                return Err(e);
            }
        };
        // Google may rotate the refresh token; keep the newest.
        if let Some(rotated) = &fresh.refresh_token {
            self.secrets.set(&self.key, rotated)?;
            *self.refresh_token.lock().unwrap() = Some(rotated.clone());
        }
        if let (Some(hook), Some(scopes)) = (&self.on_scopes, &fresh.scopes) {
            hook(scopes);
        }
        *cached = Some(CachedToken {
            value: fresh.access_token.clone(),
            expires_at: Instant::now() + Duration::from_secs(fresh.expires_in),
        });
        Ok(fresh.access_token)
    }

    async fn invalidate(&self) {
        *self.cached.lock().await = None;
    }
}
