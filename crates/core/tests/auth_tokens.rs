//! Token refresh against a mock Google token endpoint.

use std::sync::Arc;

use mailboat_core::auth::tokens::refresh_token_key;
use mailboat_core::auth::{AccountTokens, MemoryStore, OAuthClientConfig, SecretStore};
use mailboat_core::gmail::TokenSource;
use mailboat_core::CoreError;
use wiremock::matchers::{body_string_contains, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn config(server: &MockServer) -> OAuthClientConfig {
    let mut c = OAuthClientConfig::google("cid".into(), "secret".into());
    c.token_uri = format!("{}/token", server.uri());
    c
}

#[tokio::test]
async fn refreshes_caches_and_stores_rotated_token() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/token"))
        .and(body_string_contains("grant_type=refresh_token"))
        .and(body_string_contains("refresh_token=r1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "access_token": "a1", "expires_in": 3599, "token_type": "Bearer", "refresh_token": "r2"
        })))
        .expect(1)
        .mount(&server)
        .await;
    let secrets = Arc::new(MemoryStore::default());
    secrets.set(&refresh_token_key("sub-1"), "r1").unwrap();
    let tokens = AccountTokens::new(
        reqwest::Client::new(),
        config(&server),
        secrets.clone(),
        "sub-1",
    );

    assert_eq!(tokens.access_token().await.unwrap(), "a1");
    // Second call uses the cache (the mock expects exactly one request).
    assert_eq!(tokens.access_token().await.unwrap(), "a1");
    assert_eq!(
        secrets.get(&refresh_token_key("sub-1")).unwrap().as_deref(),
        Some("r2")
    );
}

#[tokio::test]
async fn revoked_refresh_token_is_an_auth_error() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/token"))
        .respond_with(ResponseTemplate::new(400).set_body_json(serde_json::json!({
            "error": "invalid_grant", "error_description": "Token has been expired or revoked."
        })))
        .mount(&server)
        .await;
    let secrets = Arc::new(MemoryStore::default());
    secrets.set(&refresh_token_key("sub-1"), "r1").unwrap();
    let tokens = AccountTokens::new(reqwest::Client::new(), config(&server), secrets, "sub-1");
    assert!(matches!(
        tokens.access_token().await,
        Err(CoreError::Auth(_))
    ));
}

#[tokio::test]
async fn missing_keychain_entry_is_an_auth_error() {
    let server = MockServer::start().await;
    let tokens = AccountTokens::new(
        reqwest::Client::new(),
        config(&server),
        Arc::new(MemoryStore::default()),
        "sub-x",
    );
    assert!(matches!(
        tokens.access_token().await,
        Err(CoreError::Auth(_))
    ));
}

#[tokio::test]
async fn code_exchange_sends_pkce_verifier_and_secret() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/token"))
        .and(body_string_contains("grant_type=authorization_code"))
        .and(body_string_contains("code_verifier=ver"))
        .and(body_string_contains("client_secret=secret"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "access_token": "a", "expires_in": 3599, "token_type": "Bearer", "refresh_token": "r"
        })))
        .mount(&server)
        .await;
    let t = mailboat_core::auth::oauth::exchange_code(
        &reqwest::Client::new(),
        &config(&server),
        "code",
        oauth2::PkceCodeVerifier::new("ver".into()),
        "http://127.0.0.1:1",
    )
    .await
    .unwrap();
    assert_eq!(t.refresh_token.as_deref(), Some("r"));
}

/// Counts keychain reads, to prove the refresh token is read once per run.
#[derive(Default)]
struct CountingStore {
    inner: MemoryStore,
    reads: std::sync::atomic::AtomicUsize,
}

impl SecretStore for CountingStore {
    fn get(&self, key: &str) -> mailboat_core::Result<Option<String>> {
        self.reads.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        self.inner.get(key)
    }
    fn set(&self, key: &str, value: &str) -> mailboat_core::Result<()> {
        self.inner.set(key, value)
    }
    fn delete(&self, key: &str) -> mailboat_core::Result<()> {
        self.inner.delete(key)
    }
}

#[tokio::test]
async fn keychain_is_read_once_per_run() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            // Already "expired" so every call refreshes.
            "access_token": "a", "expires_in": 0, "token_type": "Bearer"
        })))
        .mount(&server)
        .await;
    let secrets = Arc::new(CountingStore::default());
    secrets.set(&refresh_token_key("sub-1"), "r1").unwrap();
    let tokens = AccountTokens::new(
        reqwest::Client::new(),
        config(&server),
        secrets.clone(),
        "sub-1",
    );
    for _ in 0..3 {
        tokens.access_token().await.unwrap();
    }
    assert_eq!(
        server.received_requests().await.unwrap().len(),
        3,
        "refreshed each time"
    );
    assert_eq!(
        secrets.reads.load(std::sync::atomic::Ordering::SeqCst),
        1,
        "but read the keychain once"
    );
}
