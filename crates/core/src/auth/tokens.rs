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

pub const KEYCHAIN_SERVICE: &str = "com.nwoolls.mailboat";

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
pub struct KeyringStore;

impl SecretStore for KeyringStore {
    fn get(&self, key: &str) -> Result<Option<String>> {
        let entry = keyring::Entry::new(KEYCHAIN_SERVICE, key).map_err(keychain_err)?;
        match entry.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(keychain_err(e)),
        }
    }

    fn set(&self, key: &str, value: &str) -> Result<()> {
        keyring::Entry::new(KEYCHAIN_SERVICE, key)
            .and_then(|e| e.set_password(value))
            .map_err(keychain_err)
    }

    fn delete(&self, key: &str) -> Result<()> {
        let entry = keyring::Entry::new(KEYCHAIN_SERVICE, key).map_err(keychain_err)?;
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
}

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
        }
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
        let refresh_token = self
            .secrets
            .get(&self.key)?
            .ok_or_else(|| CoreError::Auth("no saved sign-in for this account".into()))?;
        let fresh = oauth::refresh(&self.http, &self.config, &refresh_token).await?;
        // Google may rotate the refresh token; keep the newest.
        if let Some(rotated) = &fresh.refresh_token {
            self.secrets.set(&self.key, rotated)?;
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
