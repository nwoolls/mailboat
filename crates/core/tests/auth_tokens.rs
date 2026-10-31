//! Token refresh against a mock Google token endpoint.

use std::sync::Arc;

use mail_core::auth::tokens::refresh_token_key;
use mail_core::auth::{AccountTokens, MemoryStore, OAuthClientConfig, SecretStore};
use mail_core::gmail::TokenSource;
use mail_core::CoreError;
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
    let t = mail_core::auth::oauth::exchange_code(
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
    fn get(&self, key: &str) -> mail_core::Result<Option<String>> {
        self.reads.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        self.inner.get(key)
    }
    fn set(&self, key: &str, value: &str) -> mail_core::Result<()> {
        self.inner.set(key, value)
    }
    fn delete(&self, key: &str) -> mail_core::Result<()> {
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

/// A keychain whose deletes fail (locked, or the owner said no).
#[derive(Default)]
struct StuckStore {
    inner: MemoryStore,
    stuck: std::sync::atomic::AtomicBool,
}

impl SecretStore for StuckStore {
    fn get(&self, key: &str) -> mail_core::Result<Option<String>> {
        self.inner.get(key)
    }
    fn set(&self, key: &str, value: &str) -> mail_core::Result<()> {
        self.inner.set(key, value)
    }
    fn delete(&self, key: &str) -> mail_core::Result<()> {
        if self.stuck.load(std::sync::atomic::Ordering::SeqCst) {
            return Err(mail_core::CoreError::Keychain(
                "the keychain said no".into(),
            ));
        }
        self.inner.delete(key)
    }
}

/// Code review R4-05: removing an account deleted it before its refresh
/// token, so a keychain that failed left the token behind with nothing
/// left to say which one it was. The account stays until the token goes.
#[test]
fn a_failed_keychain_delete_keeps_the_account_to_try_again() {
    use mail_core::auth::tokens::remove_account;
    use mail_core::db::{accounts, Db};

    let db = Db::open_in_memory().unwrap();
    let account = accounts::upsert(
        &db.conn(),
        &accounts::NewAccount {
            google_sub: "sub-r",
            email: "me@example.com",
            display_name: None,
            avatar_url: None,
            oauth_client: "default",
        },
    )
    .unwrap()
    .id;
    let secrets = StuckStore::default();
    secrets.set(&refresh_token_key("sub-r"), "r").unwrap();
    secrets
        .stuck
        .store(true, std::sync::atomic::Ordering::SeqCst);

    assert!(remove_account(&db, &secrets, account).is_err());
    assert!(
        accounts::get(&db.conn(), account).is_ok(),
        "the account is kept"
    );
    assert_eq!(
        secrets.get(&refresh_token_key("sub-r")).unwrap().as_deref(),
        Some("r")
    );

    // Trying again once the keychain works removes both.
    secrets
        .stuck
        .store(false, std::sync::atomic::Ordering::SeqCst);
    remove_account(&db, &secrets, account).unwrap();
    assert!(accounts::get(&db.conn(), account).is_err());
    assert_eq!(secrets.get(&refresh_token_key("sub-r")).unwrap(), None);
}
