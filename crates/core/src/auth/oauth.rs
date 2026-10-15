//! Desktop OAuth: loopback redirect + PKCE (RFC 8252 / RFC 7636).
//!
//! 1. Listen on 127.0.0.1 on a random port.
//! 2. Open the browser at Google's consent page with a PKCE challenge.
//! 3. Google redirects to the loopback address with a one-time code.
//! 4. Exchange the code (plus the PKCE verifier) for tokens.

use std::time::Duration;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use super::config::OAuthClientConfig;
use crate::error::{CoreError, Result};

pub const SCOPES: &str = "openid email profile https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.compose";

/// How long to wait for the user to finish in the browser.
pub const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(300);

fn random_token(bytes: usize) -> Result<String> {
    let mut buf = vec![0u8; bytes];
    getrandom::fill(&mut buf).map_err(|e| CoreError::Other(format!("random: {e}")))?;
    Ok(URL_SAFE_NO_PAD.encode(buf))
}

pub struct Pkce {
    pub verifier: String,
    pub challenge: String,
}

impl Pkce {
    pub fn new() -> Result<Self> {
        // 32 random bytes → 43 base64url chars, the RFC minimum length.
        Ok(Self::from_verifier(random_token(32)?))
    }

    pub fn from_verifier(verifier: String) -> Self {
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        Self {
            verifier,
            challenge,
        }
    }
}

pub fn authorization_url(
    config: &OAuthClientConfig,
    redirect_uri: &str,
    pkce: &Pkce,
    state: &str,
    login_hint: Option<&str>,
) -> String {
    let mut url = url::Url::parse(&config.auth_uri).expect("auth_uri is a valid URL");
    {
        let mut q = url.query_pairs_mut();
        q.append_pair("client_id", &config.client_id)
            .append_pair("redirect_uri", redirect_uri)
            .append_pair("response_type", "code")
            .append_pair("scope", SCOPES)
            .append_pair("code_challenge", &pkce.challenge)
            .append_pair("code_challenge_method", "S256")
            .append_pair("state", state)
            // offline + consent so Google always returns a refresh token.
            .append_pair("access_type", "offline")
            .append_pair("prompt", "consent");
        if let Some(hint) = login_hint {
            q.append_pair("login_hint", hint);
        }
    }
    url.into()
}

#[derive(Debug, Clone, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub expires_in: u64,
    pub refresh_token: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UserInfo {
    pub sub: String,
    pub email: String,
    pub name: Option<String>,
    pub picture: Option<String>,
}

#[derive(Deserialize)]
struct TokenError {
    error: String,
    error_description: Option<String>,
}

pub async fn exchange_code(
    http: &reqwest::Client,
    config: &OAuthClientConfig,
    code: &str,
    verifier: &str,
    redirect_uri: &str,
) -> Result<TokenResponse> {
    token_request(
        http,
        config,
        &[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("code_verifier", verifier),
            ("redirect_uri", redirect_uri),
        ],
    )
    .await
}

pub async fn refresh(
    http: &reqwest::Client,
    config: &OAuthClientConfig,
    refresh_token: &str,
) -> Result<TokenResponse> {
    token_request(
        http,
        config,
        &[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
        ],
    )
    .await
}

async fn token_request(
    http: &reqwest::Client,
    config: &OAuthClientConfig,
    params: &[(&str, &str)],
) -> Result<TokenResponse> {
    let mut form: Vec<(&str, &str)> = vec![
        ("client_id", config.client_id.as_str()),
        ("client_secret", config.client_secret.as_str()),
    ];
    form.extend_from_slice(params);
    let response = http
        .post(&config.token_uri)
        .form(&form)
        .send()
        .await
        .map_err(|e| CoreError::Network(e.to_string()))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| CoreError::Network(e.to_string()))?;
    if status.is_success() {
        return Ok(serde_json::from_str(&body)?);
    }
    let err: Option<TokenError> = serde_json::from_str(&body).ok();
    let message = err
        .as_ref()
        .map(|e| {
            format!(
                "{}: {}",
                e.error,
                e.error_description.clone().unwrap_or_default()
            )
        })
        .unwrap_or_else(|| body.chars().take(200).collect());
    // invalid_grant = refresh token revoked/expired; the user must sign in again.
    if err.as_ref().is_some_and(|e| e.error == "invalid_grant") || status.as_u16() == 401 {
        return Err(CoreError::Auth(message));
    }
    if status.is_server_error() {
        return Err(CoreError::Api {
            status: status.as_u16(),
            message,
        });
    }
    Err(CoreError::Config(format!(
        "token request rejected ({status}): {message}"
    )))
}

pub async fn user_info(
    http: &reqwest::Client,
    config: &OAuthClientConfig,
    access_token: &str,
) -> Result<UserInfo> {
    let response = http
        .get(&config.userinfo_uri)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| CoreError::Network(e.to_string()))?;
    if !response.status().is_success() {
        return Err(CoreError::Api {
            status: response.status().as_u16(),
            message: "could not read Google profile".into(),
        });
    }
    response
        .json()
        .await
        .map_err(|e| CoreError::Network(e.to_string()))
}

/// A started loopback listener, waiting for Google's redirect.
pub struct Loopback {
    listener: TcpListener,
    pub redirect_uri: String,
}

impl Loopback {
    pub async fn bind() -> Result<Self> {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| CoreError::Other(format!("could not open loopback port: {e}")))?;
        let port = listener
            .local_addr()
            .map_err(|e| CoreError::Other(e.to_string()))?
            .port();
        Ok(Self {
            listener,
            redirect_uri: format!("http://127.0.0.1:{port}"),
        })
    }

    /// Waits for the redirect carrying `state` and returns the auth code.
    /// Requests that don't match (favicon, stray connections) are ignored.
    pub async fn wait_for_code(self, expected_state: &str, timeout: Duration) -> Result<String> {
        tokio::time::timeout(timeout, async {
            loop {
                let (mut stream, _) = self
                    .listener
                    .accept()
                    .await
                    .map_err(|e| CoreError::Other(e.to_string()))?;
                let mut buf = vec![0u8; 8192];
                let n = stream.read(&mut buf).await.unwrap_or(0);
                let request = String::from_utf8_lossy(&buf[..n]);
                let outcome = parse_callback(&request, expected_state);
                let page = match &outcome {
                    Some(Ok(_)) => "You're signed in. You can close this tab and return to Mailboat.",
                    Some(Err(_)) => "Sign-in did not complete. You can close this tab and try again in Mailboat.",
                    None => "",
                };
                let status = if outcome.is_some() { "200 OK" } else { "404 Not Found" };
                let html = format!(
                    "<!doctype html><meta charset=utf-8><title>Mailboat</title><body style=\"font-family:system-ui;margin:4rem;color:#333\"><p>{page}</p>"
                );
                let response = format!(
                    "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{html}",
                    html.len()
                );
                let _ = stream.write_all(response.as_bytes()).await;
                let _ = stream.shutdown().await;
                if let Some(result) = outcome {
                    return result;
                }
            }
        })
        .await
        .map_err(|_| CoreError::Auth("sign-in timed out".into()))?
    }
}

/// `None` if this request isn't the OAuth callback; otherwise the code or
/// the reason it failed.
fn parse_callback(request: &str, expected_state: &str) -> Option<Result<String>> {
    let target = request.lines().next()?.split_whitespace().nth(1)?;
    let url = url::Url::parse(&format!("http://127.0.0.1{target}")).ok()?;
    if url.path() != "/" {
        return None;
    }
    let get = |k: &str| {
        url.query_pairs()
            .find(|(key, _)| key == k)
            .map(|(_, v)| v.into_owned())
    };
    let state = get("state")?;
    if state != expected_state {
        return Some(Err(CoreError::Auth(
            "sign-in response did not match (state mismatch)".into(),
        )));
    }
    if let Some(error) = get("error") {
        return Some(Err(CoreError::Auth(format!("Google returned: {error}"))));
    }
    Some(get("code").ok_or_else(|| CoreError::Auth("no authorization code".into())))
}

pub fn new_state() -> Result<String> {
    random_token(24)
}

/// Result of a completed sign-in.
pub struct SignedIn {
    pub user: UserInfo,
    pub refresh_token: String,
    pub access_token: String,
    pub expires_in: u64,
}

/// Runs the whole browser sign-in. `open_browser` is given the consent URL.
pub async fn sign_in(
    http: &reqwest::Client,
    config: &OAuthClientConfig,
    login_hint: Option<&str>,
    open_browser: impl FnOnce(&str) -> Result<()>,
) -> Result<SignedIn> {
    let loopback = Loopback::bind().await?;
    let pkce = Pkce::new()?;
    let state = new_state()?;
    let redirect_uri = loopback.redirect_uri.clone();
    open_browser(&authorization_url(
        config,
        &redirect_uri,
        &pkce,
        &state,
        login_hint,
    ))?;
    let code = loopback.wait_for_code(&state, SIGN_IN_TIMEOUT).await?;
    let tokens = exchange_code(http, config, &code, &pkce.verifier, &redirect_uri).await?;
    let refresh_token = tokens
        .refresh_token
        .clone()
        .ok_or_else(|| CoreError::Auth("Google did not return a refresh token".into()))?;
    let user = user_info(http, config, &tokens.access_token).await?;
    Ok(SignedIn {
        user,
        refresh_token,
        access_token: tokens.access_token,
        expires_in: tokens.expires_in,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_matches_rfc_7636_example() {
        let pkce = Pkce::from_verifier("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk".into());
        assert_eq!(
            pkce.challenge,
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
        assert_eq!(Pkce::new().unwrap().verifier.len(), 43);
    }

    #[test]
    fn auth_url_carries_pkce_state_and_scopes() {
        let config = OAuthClientConfig::google("cid".into(), "secret".into());
        let pkce = Pkce::from_verifier("v".into());
        let url = authorization_url(
            &config,
            "http://127.0.0.1:5555",
            &pkce,
            "st",
            Some("me@gmail.com"),
        );
        let parsed = url::Url::parse(&url).unwrap();
        let q: std::collections::HashMap<_, _> = parsed.query_pairs().into_owned().collect();
        assert_eq!(q["code_challenge_method"], "S256");
        assert_eq!(q["state"], "st");
        assert_eq!(q["redirect_uri"], "http://127.0.0.1:5555");
        assert!(q["scope"].contains("gmail.modify"));
        assert_eq!(q["login_hint"], "me@gmail.com");
        assert!(
            !url.contains("secret"),
            "the client secret never goes in the browser URL"
        );
    }

    #[test]
    fn callback_parsing() {
        let ok = parse_callback("GET /?state=s&code=abc HTTP/1.1\r\n", "s")
            .unwrap()
            .unwrap();
        assert_eq!(ok, "abc");
        assert!(parse_callback("GET /favicon.ico HTTP/1.1\r\n", "s").is_none());
        assert!(
            parse_callback("GET /?state=evil&code=abc HTTP/1.1\r\n", "s")
                .unwrap()
                .is_err()
        );
        assert!(
            parse_callback("GET /?state=s&error=access_denied HTTP/1.1\r\n", "s")
                .unwrap()
                .is_err()
        );
    }

    #[tokio::test]
    async fn loopback_receives_code_and_ignores_strays() {
        let lb = Loopback::bind().await.unwrap();
        let addr = lb.redirect_uri.trim_start_matches("http://").to_string();
        let wait = tokio::spawn(lb.wait_for_code("st", Duration::from_secs(5)));
        let http = reqwest::Client::new();
        let stray = http
            .get(format!("http://{addr}/favicon.ico"))
            .send()
            .await
            .unwrap();
        assert_eq!(stray.status(), 404);
        let page = http
            .get(format!("http://{addr}/?state=st&code=the-code"))
            .send()
            .await
            .unwrap();
        assert!(page.text().await.unwrap().contains("signed in"));
        assert_eq!(wait.await.unwrap().unwrap(), "the-code");
    }
}
