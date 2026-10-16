//! Compose (Milestone 4): sending mail, choosing From, address
//! suggestions, and what a reply or forward needs from the original.
//!
//! Every send goes through the From account's own Gmail client, and a
//! reply only joins the original's thread when it's sent from the same
//! account (threads never merge across accounts).

pub mod contacts;
pub mod identities;
pub mod mime;

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::db::{store, Db};
use crate::error::{CoreError, Result};
use crate::gmail::{parse, GmailClient};
use crate::model::{AccountId, Address, MessageId, ThreadId};
use crate::sync::fetch_body;

/// A message the user wants sent.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct OutgoingMessage {
    /// The account it's sent with; `from` must be one of its identities.
    pub account_id: AccountId,
    pub from: Address,
    pub to: Vec<Address>,
    pub cc: Vec<Address>,
    pub bcc: Vec<Address>,
    pub subject: String,
    /// Plain-text body.
    pub text: String,
    /// Formatted body, if written with formatting.
    pub html: Option<String>,
    /// Files to attach.
    pub attachments: Vec<OutgoingAttachment>,
    /// The message this replies to or forwards, for threading.
    pub replying_to: Option<MessageId>,
}

/// A file attached to a message being sent.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct OutgoingAttachment {
    pub filename: String,
    pub mime_type: String,
    /// The file's bytes, base64 (standard alphabet).
    pub data: String,
}

/// Gmail's limit for attachments on one message.
pub const MAX_ATTACHMENTS_BYTES: usize = 25 * 1024 * 1024;

fn decode_attachments(list: &[OutgoingAttachment]) -> Result<Vec<(String, String, Vec<u8>)>> {
    use base64::Engine;
    let mut out = Vec::with_capacity(list.len());
    let mut total = 0usize;
    for a in list {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(a.data.trim())
            .map_err(|_| CoreError::Invalid(format!("“{}” couldn't be read.", a.filename)))?;
        total += bytes.len();
        let mime_type = if a.mime_type.contains('/') {
            a.mime_type.clone()
        } else {
            "application/octet-stream".into()
        };
        out.push((a.filename.clone(), mime_type, bytes));
    }
    if total > MAX_ATTACHMENTS_BYTES {
        return Err(CoreError::Invalid(
            "Attachments are over Gmail's 25 MB limit.".into(),
        ));
    }
    Ok(out)
}

/// What compose needs from a message to reply to or forward it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ReplySource {
    pub message_id: MessageId,
    pub account_id: AccountId,
    pub thread_id: ThreadId,
    pub from: Address,
    pub to: Vec<Address>,
    pub cc: Vec<Address>,
    /// Where the sender asked replies to go (empty: to From).
    pub reply_to: Vec<Address>,
    pub subject: String,
    /// Unix milliseconds.
    pub date: i64,
    /// The body as plain text, for quoting.
    pub text: String,
    /// The body's HTML, cleaned for quoting in mail sent from here: no
    /// scripts, styles sheets, forms or event handlers (`ammonia`'s
    /// defaults). `None` for plain-text mail.
    pub html: Option<String>,
}

struct Original {
    account: AccountId,
    thread: ThreadId,
    gmail_message_id: String,
    gmail_thread_id: String,
    from: Address,
    to: Vec<Address>,
    cc: Vec<Address>,
    reply_to: Option<Vec<Address>>,
    subject: String,
    date: i64,
    rfc822_message_id: Option<String>,
    references: Option<String>,
}

fn original(db: &Db, message: MessageId) -> Result<Original> {
    let conn = db.conn();
    conn.query_row(
        "SELECT m.account_id, m.thread_id, m.gmail_message_id, t.gmail_thread_id,
                m.from_name, m.from_email, m.to_json, m.cc_json, m.reply_to_json,
                m.subject, m.internal_date, m.rfc822_message_id, m.references_header
         FROM messages m JOIN threads t ON t.id = m.thread_id
         WHERE m.id = ?1",
        [message],
        |r| {
            let json = |i: usize| -> rusqlite::Result<Option<String>> { r.get(i) };
            let list = |s: Option<String>| -> Vec<Address> {
                s.and_then(|s| serde_json::from_str(&s).ok())
                    .unwrap_or_default()
            };
            Ok(Original {
                account: r.get(0)?,
                thread: r.get(1)?,
                gmail_message_id: r.get(2)?,
                gmail_thread_id: r.get(3)?,
                from: Address {
                    name: r.get(4)?,
                    email: r.get(5)?,
                },
                to: list(json(6)?),
                cc: list(json(7)?),
                reply_to: json(8)?.and_then(|s| serde_json::from_str(&s).ok()),
                subject: r.get(9)?,
                date: r.get(10)?,
                rfc822_message_id: r.get(11)?,
                references: r.get(12)?,
            })
        },
    )
    .optional()?
    .ok_or_else(|| CoreError::NotFound(format!("message {}", message.0)))
}

/// Gathers what a reply or forward needs: the original's people, subject,
/// date and text. Messages synced before Mailboat read Reply-To have it
/// fetched now (and remembered); the body is fetched if it isn't cached.
pub async fn reply_source(db: &Db, gmail: &GmailClient, message: MessageId) -> Result<ReplySource> {
    let o = original(db, message)?;
    let reply_to = match o.reply_to {
        Some(list) => list,
        None => {
            let meta = gmail.message_metadata(&o.gmail_message_id).await?;
            let list = parse::message_to_incoming(&meta).reply_to;
            db.conn().execute(
                "UPDATE messages SET reply_to_json = ?2 WHERE id = ?1",
                params![message, serde_json::to_string(&list)?],
            )?;
            list
        }
    };
    let body = fetch_body(db, gmail, message).await?;
    let html = body.html.as_deref().map(quote_clean);
    let text = body
        .text
        .or_else(|| body.html.as_deref().map(parse::html_to_text))
        .unwrap_or_default();
    Ok(ReplySource {
        message_id: message,
        account_id: o.account,
        thread_id: o.thread,
        from: o.from,
        to: o.to,
        cc: o.cc,
        reply_to,
        subject: o.subject,
        date: o.date,
        text,
        html,
    })
}

/// Checks a message before sending; the error says what to fix.
pub fn validate(db: &Db, msg: &OutgoingMessage) -> Result<()> {
    let invalid = |m: String| Err(CoreError::Invalid(m));
    if msg.to.is_empty() && msg.cc.is_empty() && msg.bcc.is_empty() {
        return invalid("Add at least one recipient.".into());
    }
    if let Some(bad) = msg
        .to
        .iter()
        .chain(&msg.cc)
        .chain(&msg.bcc)
        .find(|a| !mime::valid_email(&a.email))
    {
        return invalid(format!("“{}” isn't a valid email address.", bad.email));
    }
    if !identities::owns(&db.conn(), msg.account_id, &msg.from.email)? {
        return invalid(format!(
            "{} isn't an address this account can send from.",
            msg.from.email
        ));
    }
    Ok(())
}

/// Sends a message with its account's Gmail client and caches the thread
/// it lands in, so it shows at once. Returns that thread (`None` if Gmail
/// couldn't be asked for it straight after; sync brings it in later).
pub async fn send(db: &Db, gmail: &GmailClient, msg: &OutgoingMessage) -> Result<Option<ThreadId>> {
    validate(db, msg)?;
    let original = msg.replying_to.map(|m| original(db, m)).transpose()?;
    let (in_reply_to, references) = match &original {
        Some(o) => {
            let mut refs = o
                .references
                .as_deref()
                .map(mime::message_ids)
                .unwrap_or_default();
            if let Some(id) = &o.rfc822_message_id {
                if !refs.contains(id) {
                    refs.push(id.clone());
                }
            }
            (o.rfc822_message_id.clone(), refs)
        }
        None => (None, Vec::new()),
    };
    // A reply sent from another account starts its own thread there.
    let thread = original
        .as_ref()
        .filter(|o| o.account == msg.account_id)
        .map(|o| o.gmail_thread_id.clone());
    let raw = mime::build(&mime::MimeMessage {
        from: msg.from.clone(),
        to: msg.to.clone(),
        cc: msg.cc.clone(),
        bcc: msg.bcc.clone(),
        subject: msg.subject.clone(),
        text: msg.text.clone(),
        html: msg.html.clone(),
        attachments: decode_attachments(&msg.attachments)?,
        in_reply_to,
        references,
    })?;
    let sent = gmail.send_message(&raw, thread.as_deref()).await?;
    // The mail is gone; failing to cache it now only delays it until sync.
    let fetched = gmail.thread_metadata(&sent.thread_id).await;
    Ok(match fetched {
        Ok(Some(t)) => Some(store::upsert_thread(
            &mut db.conn(),
            msg.account_id,
            &parse::thread_to_incoming(&t),
        )?),
        _ => None,
    })
}

/// Cleans an original for quoting in mail we send: scripts, forms,
/// frames and event handlers go, but its look stays: `<style>` blocks,
/// inline styles and table layout attributes, as Gmail keeps when it
/// quotes. (Plain `ammonia::clean` dropped all styling, so quotes looked
/// nothing like the original.)
pub fn quote_clean(html: &str) -> String {
    ammonia::Builder::default()
        .rm_clean_content_tags(&["style"])
        .add_tags(&["style", "center", "font"])
        .add_generic_attributes(&[
            "style",
            "class",
            "align",
            "valign",
            "width",
            "height",
            "bgcolor",
            "color",
            "border",
            "cellpadding",
            "cellspacing",
            "face",
            "size",
        ])
        .clean(html)
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn attachments_over_gmails_limit_or_unreadable_are_refused() {
        use base64::Engine;
        let file = |bytes: usize| OutgoingAttachment {
            filename: "a.bin".into(),
            mime_type: "".into(),
            data: base64::engine::general_purpose::STANDARD.encode(vec![0u8; bytes]),
        };
        let ok = decode_attachments(&[file(10)]).unwrap();
        assert_eq!(ok[0].1, "application/octet-stream");
        let big = decode_attachments(&[
            file(MAX_ATTACHMENTS_BYTES / 2 + 1),
            file(MAX_ATTACHMENTS_BYTES / 2),
        ]);
        assert!(matches!(big, Err(CoreError::Invalid(_))));
        let bad = OutgoingAttachment {
            data: "%%%".into(),
            ..file(1)
        };
        assert!(matches!(
            decode_attachments(&[bad]),
            Err(CoreError::Invalid(_))
        ));
    }

    #[test]
    fn quoted_html_keeps_its_look_but_not_scripts() {
        let clean = super::quote_clean(
            r#"<style>.x{color:red}</style><table><tr><td style="color:blue" align="center">k</td></tr></table>"#,
        );
        assert!(
            clean.contains(".x{color:red}") && clean.contains(r#"style="color:blue""#),
            "{clean}"
        );
    }

    #[test]
    fn quoted_html_keeps_formatting_but_not_scripts() {
        let clean = super::quote_clean(
            r#"<table><tr><td><b>Hi</b></td></tr></table><script>x()</script><a href="https://x.com" onclick="y()">l</a>"#,
        );
        assert!(
            clean.contains("<table>") && clean.contains("<b>Hi</b>"),
            "{clean}"
        );
        assert!(
            !clean.contains("script") && !clean.contains("onclick"),
            "{clean}"
        );
    }
}
