//! Send again (docs/ROADMAP.md → 0.3.0 → "Clone a sent email"): an email
//! you sent, opened as a new message with the same From, recipients,
//! subject, body and attachments, as Apple Mail's Message → Send Again
//! does. Only for email you sent; the original is untouched.

use serde::{Deserialize, Serialize};
use specta::Type;

use super::{original, quote_clean};
use crate::db::{accounts, store, Db};
use crate::error::{CoreError, Result};
use crate::gmail::{parse, GmailClient};
use crate::model::{AccountId, Address, Attachment, MessageId};
use crate::sync::fetch_body;

/// What a new message needs from the email it copies.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SendAgainSource {
    pub account_id: AccountId,
    /// The address it was sent from (an alias too).
    pub from: Address,
    pub to: Vec<Address>,
    pub cc: Vec<Address>,
    /// From Gmail, which keeps Bcc on your own sent copy (the cache doesn't).
    pub bcc: Vec<Address>,
    /// Gmail couldn't be asked for Bcc (offline, say): `bcc` is empty
    /// because it's unknown, not because there was none.
    pub bcc_unknown: bool,
    pub subject: String,
    /// The body's HTML as sent, cleaned as a quote is (no scripts, style
    /// sheets, forms or event handlers). `None` for plain-text mail.
    pub html: Option<String>,
    /// The body as plain text.
    pub text: String,
    /// Its files, sent again from Gmail as a forward's are.
    pub attachments: Vec<Attachment>,
}

/// Whether `email` is one of the account's own addresses (its own, or an
/// alias's), compared without regard to case.
fn is_mine(conn: &rusqlite::Connection, account: AccountId, email: &str) -> Result<bool> {
    let own = accounts::get(conn, account)?.email;
    if own.trim().eq_ignore_ascii_case(email.trim()) {
        return Ok(true);
    }
    let alias: bool = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM send_as WHERE account_id = ?1 AND email = ?2 COLLATE NOCASE)",
        rusqlite::params![account, email.trim()],
        |r| r.get(0),
    )?;
    Ok(alias)
}

/// Gathers what Send again needs from `message`, which must be one you
/// sent. Bcc is asked of Gmail; the body is fetched if it isn't cached.
pub async fn source(db: &Db, gmail: &GmailClient, message: MessageId) -> Result<SendAgainSource> {
    let o = original(db, message)?;
    // Bound first: never hold the lock in an `if` header.
    let mine = is_mine(&db.conn(), o.account, &o.from.email)?;
    if !mine {
        return Err(CoreError::Invalid(
            "Send again is for emails you sent.".into(),
        ));
    }
    let (bcc, bcc_unknown) = match gmail.message_headers(&o.gmail_message_id, &["Bcc"]).await {
        Ok(meta) => {
            let bcc = meta
                .payload
                .as_ref()
                .and_then(|p| parse::header(p, "Bcc"))
                .map(parse::parse_address_list)
                .unwrap_or_default();
            (bcc, false)
        }
        Err(_) => (Vec::new(), true),
    };
    let body = fetch_body(db, gmail, message).await?;
    let html = body.html.as_deref().map(quote_clean);
    let text = body
        .text
        .or_else(|| body.html.as_deref().map(parse::html_to_text))
        .unwrap_or_default();
    let attachments = store::attachments_for(&db.conn(), message)?;
    Ok(SendAgainSource {
        account_id: o.account,
        from: o.from,
        to: o.to,
        cc: o.cc,
        bcc,
        bcc_unknown,
        subject: o.subject,
        html,
        text,
        attachments,
    })
}
