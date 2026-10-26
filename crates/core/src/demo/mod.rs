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
pub use server::{FakeGoogle, OnChange, Timing};

use crate::gmail::{GmailClient, QuotaPacer, TokenSource};
use crate::Result;

/// The made-up Google takes an account's address as its access token.
pub struct DemoTokens(pub String);

#[async_trait]
impl TokenSource for DemoTokens {
    async fn access_token(&self) -> Result<String> {
        Ok(self.0.clone())
    }
    async fn invalidate(&self) {}
}

/// A Gmail client acting as one demo account. Nothing to pace: there's no
/// quota to respect.
pub fn client(http: reqwest::Client, google: &FakeGoogle, email: &str) -> GmailClient {
    GmailClient::with_base_url(
        http,
        Arc::new(DemoTokens(email.to_string())),
        google.base_url(),
    )
    .with_pacer(QuotaPacer::unlimited())
}

/// Gets a fresh database ready for the demo: adds its accounts (with
/// every permission, in their colors), syncs each once so the window
/// opens full, and stores the conversations' one-line summaries.
/// Returns the accounts by address.
pub async fn prepare(
    db: &crate::db::Db,
    http: &reqwest::Client,
    google: &FakeGoogle,
    data: &DemoData,
) -> Result<Vec<(crate::model::AccountId, String)>> {
    use crate::ai::summaries::{self, SummaryKind};
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
    for (email, gmail_thread, text) in google.summaries() {
        let Some((account, _)) = added.iter().find(|(_, e)| *e == email) else {
            continue;
        };
        let conn = db.conn();
        let thread = crate::db::store::thread_id_for(&conn, *account, &gmail_thread)?;
        let Some(thread) = thread else { continue };
        if let Some(newest) = summaries::newest_message(&conn, thread)? {
            summaries::store(&conn, thread, SummaryKind::Line, provider, newest, &text)?;
        }
    }
    Ok(added)
}
