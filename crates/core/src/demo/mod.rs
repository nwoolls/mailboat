//! Demo mode: a made-up Google with made-up mail (`demo/mail.json`), so the
//! real app can run full of mail with no Google connection, for
//! screenshots, videos and trying things safely. The app's own Gmail
//! client talks to it (`FakeGoogle::base_url`), so sync, actions,
//! sending, drafts, rules and the rest run their real code. Sending is
//! faked: the message lands in Sent, and the person you wrote to answers.

mod data;
mod mailbox;
mod search;
mod server;

use std::sync::Arc;

use async_trait::async_trait;

pub use data::DemoData;
pub use server::{FakeGoogle, OnChange, Summary, Timing};

use crate::gmail::{GmailClient, QuotaPacer, TokenSource};
use crate::Result;

/// When a demo account's sign-in ends, as Google ends one in Testing.
/// Lets the sign-out notice be tried without waiting seven days
/// (the `DEMO_SIGN_OUT_AFTER` setting, with the app's environment prefix).
#[derive(Debug, Default)]
pub struct DemoSession {
    ends_at: std::sync::Mutex<Option<std::time::Instant>>,
}

impl DemoSession {
    /// A sign-in that ends after `after`.
    pub fn ending_in(after: std::time::Duration) -> Self {
        // A huge value (a typo in the setting) just never ends.
        Self {
            ends_at: std::sync::Mutex::new(std::time::Instant::now().checked_add(after)),
        }
    }

    /// Signing in again: it doesn't end any more.
    pub fn renew(&self) {
        *self.ends_at.lock().unwrap() = None;
    }

    fn ended(&self) -> bool {
        self.ends_at
            .lock()
            .unwrap()
            .is_some_and(|t| std::time::Instant::now() >= t)
    }
}

/// The made-up Google takes an account's address as its access token. With
/// a session that has ended, it refuses it as Google does a revoked grant.
pub struct DemoTokens {
    email: String,
    session: Option<Arc<DemoSession>>,
}

#[async_trait]
impl TokenSource for DemoTokens {
    async fn access_token(&self) -> Result<String> {
        if self.session.as_ref().is_some_and(|s| s.ended()) {
            return Err(crate::CoreError::Auth(
                "the demo's sign-in ended (invalid_grant)".into(),
            ));
        }
        Ok(self.email.clone())
    }
    async fn invalidate(&self) {}
}

/// A Gmail client acting as one demo account. Nothing to pace: there's no
/// quota to respect.
pub fn client(http: reqwest::Client, google: &FakeGoogle, email: &str) -> GmailClient {
    client_with_session(http, google, email, None)
}

/// As `client`, for an account whose sign-in can end.
pub fn client_with_session(
    http: reqwest::Client,
    google: &FakeGoogle,
    email: &str,
    session: Option<Arc<DemoSession>>,
) -> GmailClient {
    GmailClient::with_base_url(
        http,
        Arc::new(DemoTokens {
            email: email.to_string(),
            session,
        }),
        google.base_url(),
    )
    .with_pacer(QuotaPacer::unlimited())
}

/// Gets a fresh database ready for the demo: adds its accounts (with
/// every permission, in their colors), syncs each once so the window
/// opens full, and stores the conversations' summaries.
/// Returns the accounts by address.
pub async fn prepare(
    db: &crate::db::Db,
    http: &reqwest::Client,
    google: &FakeGoogle,
    data: &DemoData,
) -> Result<Vec<(crate::model::AccountId, String)>> {
    use crate::ai::summaries;
    use crate::db::accounts;
    use crate::sync::{SyncConfig, SyncEngine, SyncProgress};

    let mut added = Vec::new();
    for account in &data.accounts {
        let sub = format!("demo:{}", account.email);
        let id = accounts::upsert(
            &db.conn(),
            &accounts::NewAccount {
                google_sub: &sub,
                email: &account.email,
                display_name: Some(&account.name),
                avatar_url: None,
                oauth_client: "demo",
            },
        )?
        .id;
        let scopes: Vec<String> = crate::auth::oauth::SCOPES
            .iter()
            .map(|s| s.to_string())
            .collect();
        accounts::set_granted_scopes(&db.conn(), id, &scopes)?;
        if let Some(color) = &account.color {
            accounts::set_color(&db.conn(), id, color)?;
        }
        let gmail = client(http.clone(), google, &account.email);
        let config = SyncConfig::default();
        let progress = |_: SyncProgress| {};
        SyncEngine {
            db,
            gmail: &gmail,
            account: id,
            config: &config,
            progress: &progress,
        }
        .run()
        .await?;
        added.push((id, account.email.clone()));
    }

    // Written as if by the provider that makes list summaries now.
    let provider = crate::settings::load(&db.conn())?
        .ai
        .list_summaries
        .unwrap_or(crate::ai::AiProvider::Apple);
    for s in google.summaries() {
        let Some((account, _)) = added.iter().find(|(_, e)| *e == s.account) else {
            continue;
        };
        let conn = db.conn();
        let thread = crate::db::store::thread_id_for(&conn, *account, &s.thread)?;
        let Some(thread) = thread else { continue };
        if let Some(newest) = summaries::newest_message(&conn, thread)? {
            summaries::store(&conn, thread, s.kind, provider, newest, &s.text)?;
        }
    }
    Ok(added)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[tokio::test]
    async fn an_ended_demo_sign_in_is_refused_until_it_is_renewed() {
        let session = Arc::new(DemoSession::ending_in(Duration::ZERO));
        let tokens = DemoTokens {
            email: "a@x.example".into(),
            session: Some(session.clone()),
        };
        let err = tokens.access_token().await.unwrap_err();
        assert!(matches!(err, crate::CoreError::Auth(_)));
        session.renew();
        assert_eq!(tokens.access_token().await.unwrap(), "a@x.example");
    }
}
