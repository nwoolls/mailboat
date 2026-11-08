//! Desktop OAuth: loopback redirect + PKCE (RFC 8252 / RFC 7636).
//!
//! 1. Listen on 127.0.0.1 on a random port.
//! 2. Open the browser at Google's consent page with a PKCE challenge.
//! 3. Google redirects to the loopback address with a one-time code.
//! 4. Exchange the code (plus the PKCE verifier) for tokens.

use std::future::Future;
use std::pin::Pin;
use std::time::Duration;

use oauth2::basic::{BasicClient, BasicErrorResponseType};
use oauth2::{
    AuthUrl, AuthorizationCode, ClientId, ClientSecret, CsrfToken, PkceCodeChallenge,
    PkceCodeVerifier, RedirectUrl, RefreshToken, RequestTokenError, Scope, TokenResponse as _,
    TokenUrl,
};
use serde::Deserialize;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use super::config::OAuthClientConfig;
use crate::error::{CoreError, Result};
use crate::gmail::client::net_error;

// The OAuth protocol itself (PKCE, consent URL, code exchange, refresh) comes
// from the `oauth2` crate. This file adds the loopback listener, Google's
// user-info call and the mapping of failures onto the app's errors.

pub const SCOPES: [&str; 8] = [
    "openid",
    "email",
    "profile",
    // Reads, labels, drafts and sends. It already covers everything
    // `gmail.compose` would (drafts, sending), so that one isn't asked for:
    // one box fewer on Google's permissions screen.
    GMAIL_MODIFY_SCOPE,
    // Address suggestions from Google Contacts (saved and "other"
    // contacts), read-only. Accounts that signed in before these were
    // asked for simply go without until they sign in again.
    "https://www.googleapis.com/auth/contacts.readonly",
    "https://www.googleapis.com/auth/contacts.other.readonly",
    // Answering meeting invitations through Google Calendar, as Gmail
    // does: read your events (and clashes) and set your answer.
    CALENDAR_SCOPE,
    // Gmail's settings: rules (filters), signatures, vacation responder
    // (Milestone 6). Asked for together with Calendar so each account
    // signs in again only once.
    GMAIL_SETTINGS_SCOPE,
];

pub const GMAIL_MODIFY_SCOPE: &str = "https://www.googleapis.com/auth/gmail.modify";
pub const CALENDAR_SCOPE: &str = "https://www.googleapis.com/auth/calendar.events";
pub const GMAIL_SETTINGS_SCOPE: &str = "https://www.googleapis.com/auth/gmail.settings.basic";
pub const CONTACTS_SCOPE: &str = "https://www.googleapis.com/auth/contacts.readonly";

/// How long to wait for the user to finish in the browser.
pub const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(300);

/// Tokens returned by Google's token endpoint.
#[derive(Debug, Clone)]
pub struct TokenResponse {
    pub access_token: String,
    pub expires_in: u64,
    pub refresh_token: Option<String>,
    /// The permissions this token carries, as Google reports them (Google
    /// always does, on sign-in and on every refresh).
    pub scopes: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UserInfo {
    pub sub: String,
    pub email: String,
    pub name: Option<String>,
    pub picture: Option<String>,
}

fn invalid_url(e: impl std::fmt::Display) -> CoreError {
    CoreError::Config(format!("invalid OAuth URL: {e}"))
}

/// A configured `oauth2` client: auth and token endpoints set, others not.
type GoogleClient = oauth2::Client<
    oauth2::basic::BasicErrorResponse,
    oauth2::basic::BasicTokenResponse,
    oauth2::basic::BasicTokenIntrospectionResponse,
    oauth2::StandardRevocableToken,
    oauth2::basic::BasicRevocationErrorResponse,
    oauth2::EndpointSet,
    oauth2::EndpointNotSet,
    oauth2::EndpointNotSet,
    oauth2::EndpointNotSet,
    oauth2::EndpointSet,
>;

fn client(config: &OAuthClientConfig, redirect_uri: Option<&str>) -> Result<GoogleClient> {
    let mut client = BasicClient::new(ClientId::new(config.client_id.clone()))
        .set_client_secret(ClientSecret::new(config.client_secret.clone()))
        // Google's installed-app flow sends the client credentials in the
        // request body, not an Authorization header.
        .set_auth_type(oauth2::AuthType::RequestBody)
        .set_auth_uri(AuthUrl::new(config.auth_uri.clone()).map_err(invalid_url)?)
        .set_token_uri(TokenUrl::new(config.token_uri.clone()).map_err(invalid_url)?);
    if let Some(uri) = redirect_uri {
        client = client.set_redirect_uri(RedirectUrl::new(uri.to_string()).map_err(invalid_url)?);
    }
    Ok(client)
}

/// Google's consent page URL for this sign-in.
pub fn authorization_url(
    config: &OAuthClientConfig,
    redirect_uri: &str,
    challenge: PkceCodeChallenge,
    state: &CsrfToken,
    login_hint: Option<&str>,
) -> Result<String> {
    let state = state.clone();
    let client = client(config, Some(redirect_uri))?;
    let mut request = client
        .authorize_url(move || state)
        .add_scopes(SCOPES.iter().map(|s| Scope::new((*s).to_string())))
        .set_pkce_challenge(challenge)
        // offline + consent so Google always returns a refresh token.
        .add_extra_param("access_type", "offline")
        .add_extra_param("prompt", "consent");
    if let Some(hint) = login_hint {
        request = request.add_extra_param("login_hint", hint);
    }
    Ok(request.url().0.into())
}

/// Lets `oauth2` send its requests through our shared `reqwest` client.
#[derive(Debug, thiserror::Error)]
#[error("{0}")]
pub struct HttpError(String);

type HttpFuture =
    Pin<Box<dyn Future<Output = std::result::Result<oauth2::HttpResponse, HttpError>> + Send>>;

fn send_with(http: &reqwest::Client) -> impl Fn(oauth2::HttpRequest) -> HttpFuture + '_ {
    move |request| {
        let http = http.clone();
        Box::pin(async move {
            let request =
                reqwest::Request::try_from(request).map_err(|e| HttpError(e.to_string()))?;
            let response = http
                .execute(request)
                .await
                .map_err(|e| HttpError(e.without_url().to_string()))?;
            let mut builder = oauth2::http::Response::builder().status(response.status());
            for (name, value) in response.headers() {
                builder = builder.header(name, value);
            }
            let body = response
                .bytes()
                .await
                .map_err(|e| HttpError(e.without_url().to_string()))?;
            builder
                .body(body.to_vec())
                .map_err(|e| HttpError(e.to_string()))
        })
    }
}

fn convert(token: oauth2::basic::BasicTokenResponse) -> TokenResponse {
    TokenResponse {
        access_token: token.access_token().secret().clone(),
        expires_in: token.expires_in().map_or(3600, |d| d.as_secs()),
        refresh_token: token.refresh_token().map(|t| t.secret().clone()),
        scopes: token
            .scopes()
            .map(|s| s.iter().map(|scope| scope.to_string()).collect()),
    }
}

/// Maps token-endpoint failures onto the app's error kinds, in fixed
/// words: the endpoint's description, an error code it made up and a
/// value the parser quotes all stay out, as this reaches the sync log
/// (code review R5-05). The standard OAuth code is kept.
fn token_error(e: RequestTokenError<HttpError, oauth2::basic::BasicErrorResponse>) -> CoreError {
    match e {
        RequestTokenError::ServerResponse(resp) => {
            let code = match resp.error() {
                BasicErrorResponseType::InvalidGrant => "invalid_grant",
                BasicErrorResponseType::InvalidClient => "invalid_client",
                BasicErrorResponseType::InvalidRequest => "invalid_request",
                BasicErrorResponseType::InvalidScope => "invalid_scope",
                BasicErrorResponseType::UnauthorizedClient => "unauthorized_client",
                BasicErrorResponseType::UnsupportedGrantType => "unsupported_grant_type",
                BasicErrorResponseType::Extension(_) => "other",
            };
            // invalid_grant = refresh token revoked/expired; sign in again.
            if *resp.error() == BasicErrorResponseType::InvalidGrant {
                CoreError::Auth(format!("Google refused the sign-in ({code})"))
            } else if *resp.error() == BasicErrorResponseType::InvalidClient {
                CoreError::Config(format!(
                    "Google doesn't recognize this OAuth client ({code}); check the client file"
                ))
            } else {
                CoreError::Config(format!("token request rejected ({code})"))
            }
        }
        RequestTokenError::Request(e) => CoreError::Network(e.to_string()),
        RequestTokenError::Parse(_, _) | RequestTokenError::Other(_) => {
            CoreError::Other("unexpected token response".into())
        }
    }
}

pub async fn exchange_code(
    http: &reqwest::Client,
    config: &OAuthClientConfig,
    code: &str,
    verifier: PkceCodeVerifier,
    redirect_uri: &str,
) -> Result<TokenResponse> {
    client(config, Some(redirect_uri))?
        .exchange_code(AuthorizationCode::new(code.to_string()))
        .set_pkce_verifier(verifier)
        .request_async(&send_with(http))
        .await
        .map(convert)
        .map_err(token_error)
}

pub async fn refresh(
    http: &reqwest::Client,
    config: &OAuthClientConfig,
    refresh_token: &str,
) -> Result<TokenResponse> {
    client(config, None)?
        .exchange_refresh_token(&RefreshToken::new(refresh_token.to_string()))
        .request_async(&send_with(http))
        .await
        .map(convert)
        .map_err(token_error)
}

/// Tells Google to end a refresh token's grant (the account was removed
/// here). Google answers 400 for a token that is already revoked or expired;
/// that counts as done. A network failure is an error for the caller to
/// report, never to retry in a loop. The token goes in the request body and
/// nowhere else: no error text carries it.
pub async fn revoke(
    http: &reqwest::Client,
    config: &OAuthClientConfig,
    refresh_token: &str,
) -> Result<()> {
    let response = http
        .post(&config.revoke_uri)
        .form(&[("token", refresh_token)])
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(net_error)?;
    let status = response.status().as_u16();
    if response.status().is_success() || status == 400 {
        return Ok(());
    }
    Err(CoreError::Api {
        status,
        message: "Google didn't revoke the sign-in".into(),
    })
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
        .map_err(net_error)?;
    if !response.status().is_success() {
        return Err(CoreError::Api {
            status: response.status().as_u16(),
            message: "could not read Google profile".into(),
        });
    }
    response.json().await.map_err(net_error)
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
                    Some(Ok(_)) => concat!(
                        "You're signed in. You can close this tab and return to ",
                        env!("BRAND_NAME"),
                        "."
                    ),
                    Some(Err(_)) => concat!(
                        "Sign-in did not complete. You can close this tab and try again in ",
                        env!("BRAND_NAME"),
                        "."
                    ),
                    None => "",
                };
                let status = if outcome.is_some() { "200 OK" } else { "404 Not Found" };
                let html = format!(
                    "<!doctype html><meta charset=utf-8><title>{}</title><body style=\"font-family:system-ui;margin:4rem;color:#333\"><p>{page}</p>",
                    crate::brand::NAME
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

/// Google's permissions screen starts with every box empty and lets a
/// person press Continue that way, which signs in an account that can't
/// read mail (it then fails with a raw "insufficient authentication
/// scopes"). Refuses such a sign-in, in plain words. The other
/// permissions (contacts, calendar, settings) are optional: an account
/// without them works, and says what it's missing. When Google doesn't
/// report the permissions at all, the sync finds out.
pub fn require_mail_permission(scopes: Option<&[String]>) -> Result<()> {
    match scopes {
        Some(granted) if !granted.iter().any(|s| s == GMAIL_MODIFY_SCOPE) => {
            Err(CoreError::MissingMailPermission(format!(
                "{} wasn't given permission to read your mail. Sign in again, and tick \
                 \"Select all\" on Google's permissions screen.",
                crate::brand::NAME
            )))
        }
        _ => Ok(()),
    }
}

/// Result of a completed sign-in.
pub struct SignedIn {
    pub user: UserInfo,
    pub refresh_token: String,
    pub access_token: String,
    pub expires_in: u64,
    pub scopes: Option<Vec<String>>,
}

/// Runs the whole browser sign-in. `open_browser` is given the consent URL.
/// If `cancel` completes first (the user gave up, e.g. closed the tab, which
/// the app can't detect), returns `CoreError::Cancelled` and closes the
/// loopback port.
pub async fn sign_in(
    http: &reqwest::Client,
    config: &OAuthClientConfig,
    login_hint: Option<&str>,
    open_browser: impl FnOnce(&str) -> Result<()>,
    cancel: impl Future<Output = ()>,
) -> Result<SignedIn> {
    tokio::select! {
        result = sign_in_inner(http, config, login_hint, open_browser) => result,
        _ = cancel => Err(CoreError::Cancelled),
    }
}

async fn sign_in_inner(
    http: &reqwest::Client,
    config: &OAuthClientConfig,
    login_hint: Option<&str>,
    open_browser: impl FnOnce(&str) -> Result<()>,
) -> Result<SignedIn> {
    let loopback = Loopback::bind().await?;
    let (challenge, verifier) = PkceCodeChallenge::new_random_sha256();
    let state = CsrfToken::new_random();
    let redirect_uri = loopback.redirect_uri.clone();
    open_browser(&authorization_url(
        config,
        &redirect_uri,
        challenge,
        &state,
        login_hint,
    )?)?;
    let code = loopback
        .wait_for_code(state.secret(), SIGN_IN_TIMEOUT)
        .await?;
    let tokens = exchange_code(http, config, &code, verifier, &redirect_uri).await?;
    // Before anything is saved: no half-added account that can't sync.
    require_mail_permission(tokens.scopes.as_deref())?;
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
        scopes: tokens.scopes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_matches_rfc_7636_example() {
        // Checks the library computes S256 challenges as the RFC specifies.
        let verifier = PkceCodeVerifier::new("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk".into());
        let challenge = PkceCodeChallenge::from_code_verifier_sha256(&verifier);
        assert_eq!(
            challenge.as_str(),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
        assert_eq!(challenge.method().as_str(), "S256");
    }

    #[test]
    fn a_sign_in_without_the_mail_permission_is_refused_plainly() {
        let basic: Vec<String> = ["openid", "email", "profile"].map(String::from).to_vec();
        let err = require_mail_permission(Some(&basic)).unwrap_err();
        assert_eq!(err.kind(), "missing_mail_permission");
        assert!(err.to_string().contains("Select all"));
        assert!(require_mail_permission(Some(&[])).is_err());
        let mut with_mail = basic.clone();
        with_mail.push(GMAIL_MODIFY_SCOPE.into());
        assert!(require_mail_permission(Some(&with_mail)).is_ok());
        // Contacts, calendar and settings are optional.
        assert!(require_mail_permission(None).is_ok());
    }

    #[test]
    fn compose_is_not_asked_for_because_modify_covers_it() {
        assert!(SCOPES.contains(&GMAIL_MODIFY_SCOPE));
        assert!(!SCOPES.iter().any(|s| s.ends_with("gmail.compose")));
        assert_eq!(SCOPES.len(), 8);
    }

    #[test]
    fn auth_url_carries_pkce_state_and_scopes() {
        let config = OAuthClientConfig::google("cid".into(), "secret".into());
        let (challenge, _) = PkceCodeChallenge::new_random_sha256();
        let expected_challenge = challenge.as_str().to_string();
        let state = CsrfToken::new("st".into());
        let url = authorization_url(
            &config,
            "http://127.0.0.1:5555",
            challenge,
            &state,
            Some("me@gmail.com"),
        )
        .unwrap();
        let parsed = url::Url::parse(&url).unwrap();
        let q: std::collections::HashMap<_, _> = parsed.query_pairs().into_owned().collect();
        assert_eq!(q["code_challenge"], expected_challenge);
        assert_eq!(q["code_challenge_method"], "S256");
        assert_eq!(q["state"], "st");
        assert_eq!(q["redirect_uri"], "http://127.0.0.1:5555");
        assert_eq!(q["response_type"], "code");
        assert!(q["scope"].contains("gmail.modify") && q["scope"].contains("openid"));
        assert_eq!(q["access_type"], "offline");
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
    async fn cancelling_stops_waiting_and_closes_the_port() {
        let config = OAuthClientConfig::google("cid".into(), "secret".into());
        let (url_tx, url_rx) = tokio::sync::oneshot::channel::<String>();
        let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel::<()>();
        let http = reqwest::Client::new();
        let task = tokio::spawn(async move {
            sign_in(
                &http,
                &config,
                None,
                |url| {
                    let _ = url_tx.send(url.to_string());
                    Ok(())
                },
                async {
                    let _ = cancel_rx.await;
                },
            )
            .await
        });
        // The browser "opened"; find the loopback port from the redirect URI.
        let url = url_rx.await.unwrap();
        let parsed = url::Url::parse(&url).unwrap();
        let redirect = parsed
            .query_pairs()
            .find(|(k, _)| k == "redirect_uri")
            .unwrap()
            .1
            .into_owned();
        cancel_tx.send(()).unwrap();
        let result = tokio::time::timeout(Duration::from_secs(5), task)
            .await
            .unwrap()
            .unwrap();
        assert!(matches!(result, Err(CoreError::Cancelled)));
        // Nothing is listening for Google's redirect any more.
        assert!(reqwest::Client::new().get(&redirect).send().await.is_err());
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
