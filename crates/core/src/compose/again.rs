//! Send again (docs/ROADMAP.md → 0.3.0 → "Clone a sent email"): an email
//! you sent, opened as a new message with the same From, recipients,
//! subject, body and attachments, as Apple Mail's Message → Send Again
//! does. Only for email you sent; the original is untouched.

use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use specta::Type;

use super::{original, quote_clean};
use crate::db::query::SENT_NOT_DRAFT;
use crate::db::{accounts, store, Db};
use crate::error::{CoreError, Result};
use crate::gmail::{parse, GmailClient};
use crate::mail::{images, sanitize};
use crate::model::{AccountId, Address, Attachment, MessageId, ThreadId};
use crate::sync::fetch_body;

/// What a new message needs from the email it copies.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SendAgainSource {
    pub account_id: AccountId,
    /// The address it was sent from.
    pub from: Address,
    /// `from` is still one of the account's addresses (its own, or an
    /// alias). If not (an alias since removed), the new message starts
    /// from the account's default address, and says so.
    pub from_still_yours: bool,
    pub to: Vec<Address>,
    pub cc: Vec<Address>,
    /// From Gmail, which keeps Bcc on your own sent copy (the cache doesn't).
    pub bcc: Vec<Address>,
    /// Gmail couldn't be asked for Bcc (offline, an error): `bcc` is empty
    /// because it's unknown, not because there was none.
    pub bcc_unknown: bool,
    pub subject: String,
    /// The body's HTML as sent, cleaned as a quote is (no scripts, forms
    /// or event handlers; its style sheets stay), with its images as the reader
    /// would show them (`sanitize::images_for_editor`). `None` for
    /// plain-text mail.
    pub html: Option<String>,
    /// The body as plain text.
    pub text: String,
    /// Its files, sent again from Gmail as a forward's are.
    pub attachments: Vec<Attachment>,
    /// Images in the body that were left out: embedded ones (not carried)
    /// and remote ones the image setting blocks for this email.
    pub images_left_out: u32,
}

/// The newest email in `thread` that you sent: Gmail's SENT label, not a
/// draft. The same label marks the conversation (`ThreadSummary::in_sent`),
/// so what offers Send again and what it copies agree.
pub fn newest_sent(conn: &rusqlite::Connection, thread: ThreadId) -> Result<Option<MessageId>> {
    Ok(conn
        .query_row(
            &format!(
                "SELECT m.id FROM messages m WHERE m.thread_id = ?1 AND {SENT_NOT_DRAFT}
                 ORDER BY m.internal_date DESC, m.id DESC LIMIT 1"
            ),
            [thread],
            |r| r.get(0),
        )
        .optional()?)
}

/// `message` is still the email with this account and Gmail ID.
pub fn still_the_same(
    conn: &rusqlite::Connection,
    message: MessageId,
    account: AccountId,
    gmail_id: &str,
) -> Result<bool> {
    Ok(conn
        .query_row(
            "SELECT 1 FROM messages WHERE id = ?1 AND account_id = ?2 AND gmail_message_id = ?3",
            rusqlite::params![message, account, gmail_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

/// Whether `email` is one of the account's own addresses (its own, or an
/// alias's), compared without regard to case.
fn is_mine(conn: &rusqlite::Connection, account: AccountId, email: &str) -> Result<bool> {
    let email = email.trim().to_lowercase();
    if accounts::get(conn, account)?.email.trim().to_lowercase() == email {
        return Ok(true);
    }
    let mut stmt = conn.prepare("SELECT email FROM send_as WHERE account_id = ?1")?;
    let aliases = stmt
        .query_map([account], |r| r.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(aliases.iter().any(|a| a.trim().to_lowercase() == email))
}

/// Gathers what Send again needs from the newest email you sent in
/// `thread`. Bcc is asked of Gmail; the body is fetched if it isn't cached.
pub async fn source(db: &Db, gmail: &GmailClient, thread: ThreadId) -> Result<SendAgainSource> {
    // Bound first: never hold the lock in an `if`/`match` header.
    let newest = newest_sent(&db.conn(), thread)?;
    let message =
        newest.ok_or_else(|| CoreError::Invalid("Send again is for emails you sent.".into()))?;
    let o = original(db, message)?;
    let from_still_yours = is_mine(&db.conn(), o.account, &o.from.email)?;
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
    // While Gmail was asked, a sync may have removed the email, and SQLite
    // can give its ID to a new one (another account's): check it is still
    // the same email before reading anything else by that ID (review).
    let same = still_the_same(&db.conn(), message, o.account, &o.gmail_message_id)?;
    if !same {
        return Err(CoreError::Invalid(
            "The email changed while it was being read. Try again.".into(),
        ));
    }
    let body = fetch_body(db, gmail, message).await?;
    let text = body
        .text
        .clone()
        .or_else(|| body.html.as_deref().map(parse::html_to_text))
        .unwrap_or_default();
    // The composer loads an image's address itself, so the body's images
    // follow the reader's rule for this email (Settings → Viewing).
    let (policy, _) = images::policy_for_message(&db.conn(), message)?;
    let (html, images_left_out) = match body.html.as_deref().map(quote_clean) {
        Some(cleaned) => match sanitize::images_for_editor(&cleaned, policy.allows()) {
            Some((html, left_out)) => (Some(html), left_out),
            // Never the body with its images unchecked: the text instead.
            None => (None, 0),
        },
        None => (None, 0),
    };
    let attachments = store::attachments_for(&db.conn(), message)?;
    Ok(SendAgainSource {
        account_id: o.account,
        from: o.from,
        from_still_yours,
        to: o.to,
        cc: o.cc,
        bcc,
        bcc_unknown,
        subject: o.subject,
        html,
        text,
        attachments,
        images_left_out,
    })
}
