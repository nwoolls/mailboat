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

use crate::db::now_millis;
use crate::db::{store, Db};
use crate::error::{CoreError, Result};
use crate::gmail::{parse, GmailClient};
use crate::model::{AccountId, Address, DraftId, MessageId, ThreadId};
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
    /// The saved draft this is (deleted once sent).
    pub draft: Option<DraftId>,
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
    let (raw, thread) = prepare(db, msg, &msg.to, &msg.cc, &msg.bcc)?;
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

/// The RFC 5322 message, and the Gmail thread it joins: a reply joins the
/// original's thread only when sent from the same account (threads never
/// merge across accounts).
fn prepare(
    db: &Db,
    msg: &OutgoingMessage,
    to: &[Address],
    cc: &[Address],
    bcc: &[Address],
) -> Result<(Vec<u8>, Option<String>)> {
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
    let thread = original
        .as_ref()
        .filter(|o| o.account == msg.account_id)
        .map(|o| o.gmail_thread_id.clone());
    let raw = mime::build(&mime::MimeMessage {
        from: msg.from.clone(),
        to: to.to_vec(),
        cc: cc.to_vec(),
        bcc: bcc.to_vec(),
        subject: msg.subject.clone(),
        text: msg.text.clone(),
        html: msg.html.clone(),
        attachments: decode_attachments(&msg.attachments)?,
        in_reply_to,
        references,
    })?;
    Ok((raw, thread))
}

/// Saves a message being written as a Gmail draft, so it survives quitting
/// and shows in Gmail's Drafts. The first save creates it; later saves
/// replace it. If From moved to another account, the draft moves too: the
/// old account's copy is deleted and the new account gets its own.
/// Returns the local draft ID (Gmail's draft IDs stay in Rust).
pub async fn save_draft(
    db: &Db,
    gmail_for: impl Fn(AccountId) -> Result<GmailClient>,
    existing: Option<DraftId>,
    msg: &OutgoingMessage,
) -> Result<DraftId> {
    if !identities::owns(&db.conn(), msg.account_id, &msg.from.email)? {
        return Err(CoreError::Invalid(format!(
            "{} isn't an address this account can send from.",
            msg.from.email
        )));
    }
    // Half-typed recipients are left out of the saved copy (they can't go
    // into a header safely); the draft on screen keeps them.
    let keep = |list: &[Address]| -> Vec<Address> {
        list.iter()
            .filter(|a| mime::valid_email(&a.email))
            .cloned()
            .collect()
    };
    let (raw, thread) = prepare(db, msg, &keep(&msg.to), &keep(&msg.cc), &keep(&msg.bcc))?;
    let saved = match existing {
        Some(id) => draft_row(db, id)?.map(|row| (id, row)),
        None => None,
    };
    if let Some((id, (account, gmail_id))) = saved {
        if account == msg.account_id {
            gmail_for(account)?
                .update_draft(&gmail_id, &raw, thread.as_deref())
                .await?;
            db.conn().execute(
                "UPDATE drafts SET updated_at = ?2 WHERE id = ?1",
                params![id, now_millis()],
            )?;
            return Ok(id);
        }
        // From changed account: the draft moves with it.
        delete_draft(db, &gmail_for, id).await?;
    }
    let created = gmail_for(msg.account_id)?
        .create_draft(&raw, thread.as_deref())
        .await?;
    let conn = db.conn();
    conn.execute(
        "INSERT INTO drafts (account_id, gmail_draft_id, updated_at) VALUES (?1, ?2, ?3)",
        params![msg.account_id, created.id, now_millis()],
    )?;
    Ok(DraftId(conn.last_insert_rowid()))
}

fn draft_row(db: &Db, id: DraftId) -> Result<Option<(AccountId, String)>> {
    Ok(db
        .conn()
        .query_row(
            "SELECT account_id, gmail_draft_id FROM drafts WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?)
}

/// Deletes a draft from Gmail (with its own account's client) and here.
/// Already gone is fine.
pub async fn delete_draft(
    db: &Db,
    gmail_for: &impl Fn(AccountId) -> Result<GmailClient>,
    id: DraftId,
) -> Result<()> {
    let Some((account, gmail_id)) = draft_row(db, id)? else {
        return Ok(());
    };
    gmail_for(account)?.delete_draft(&gmail_id).await?;
    db.conn()
        .execute("DELETE FROM drafts WHERE id = ?1", [id])?;
    Ok(())
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

/// A saved draft opened for editing: what compose needs to resume it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct OpenedDraft {
    pub draft: DraftId,
    pub account_id: AccountId,
    pub thread_id: ThreadId,
    pub from: Address,
    pub to: Vec<Address>,
    pub cc: Vec<Address>,
    pub bcc: Vec<Address>,
    pub subject: String,
    /// The whole body as saved (signature and quote included).
    pub html: String,
    pub text: String,
    /// The message it answers, when it's a reply in its conversation.
    pub replying_to: Option<MessageId>,
}

/// The local draft ID for a draft message, recording it if it was made
/// elsewhere (Gmail on the web, a phone): Gmail's draft list is asked
/// which draft holds the message.
pub async fn draft_for_message(
    db: &Db,
    gmail: &GmailClient,
    message: MessageId,
) -> Result<DraftId> {
    let (account, gmail_message_id) = store::message_gmail_ref(&db.conn(), message)?;
    let known: Option<DraftId> = db
        .conn()
        .query_row(
            "SELECT id FROM drafts WHERE account_id = ?1 AND message_id = ?2",
            params![account, message],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(id) = known {
        return Ok(id);
    }
    let list = gmail.list_drafts().await?;
    let found = list
        .drafts
        .into_iter()
        .find(|d| d.message.id == gmail_message_id)
        .ok_or_else(|| CoreError::NotFound("that draft is no longer in Gmail".into()))?;
    let conn = db.conn();
    conn.execute(
        "INSERT INTO drafts (account_id, gmail_draft_id, message_id, updated_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (account_id, gmail_draft_id) DO UPDATE SET message_id = excluded.message_id",
        params![account, found.id, message, now_millis()],
    )?;
    Ok(conn.query_row(
        "SELECT id FROM drafts WHERE account_id = ?1 AND gmail_draft_id = ?2",
        params![account, found.id],
        |r| r.get(0),
    )?)
}

/// Opens a draft message for editing: its people, subject and body from
/// Gmail, and the message it replies to (by In-Reply-To) if that's cached.
pub async fn open_draft(db: &Db, gmail: &GmailClient, message: MessageId) -> Result<OpenedDraft> {
    let draft = draft_for_message(db, gmail, message).await?;
    let (account, gmail_message_id) = store::message_gmail_ref(&db.conn(), message)?;
    let thread: ThreadId = db.conn().query_row(
        "SELECT thread_id FROM messages WHERE id = ?1",
        [message],
        |r| r.get(0),
    )?;
    let full = gmail.message_full(&gmail_message_id).await?;
    let payload = full
        .payload
        .ok_or_else(|| CoreError::Other("the draft came back empty".into()))?;
    let h = |name: &str| {
        parse::header(&payload, name)
            .unwrap_or_default()
            .to_string()
    };
    let list = |name: &str| parse::parse_address_list(&h(name));
    let body = parse::extract_body(&payload);
    let in_reply_to = h("In-Reply-To");
    let replying_to: Option<MessageId> = if in_reply_to.trim().is_empty() {
        None
    } else {
        db.conn()
            .query_row(
                "SELECT id FROM messages WHERE account_id = ?1 AND rfc822_message_id = ?2",
                params![account, in_reply_to.trim()],
                |r| r.get(0),
            )
            .optional()?
    };
    Ok(OpenedDraft {
        draft,
        account_id: account,
        thread_id: thread,
        from: list("From").into_iter().next().unwrap_or_default(),
        to: list("To"),
        cc: list("Cc"),
        bcc: list("Bcc"),
        subject: h("Subject"),
        html: body.html.clone().unwrap_or_default(),
        text: body.text.unwrap_or_default(),
        replying_to,
    })
}

/// Discards a draft shown in a conversation (wherever it was made): deleted
/// from Gmail and from the cache at once.
pub async fn discard_draft_message(db: &Db, gmail: &GmailClient, message: MessageId) -> Result<()> {
    let (account, gmail_message_id) = store::message_gmail_ref(&db.conn(), message)?;
    match draft_for_message(db, gmail, message).await {
        Ok(draft) => delete_draft(db, &|_| Ok(gmail.clone()), draft).await?,
        // Already gone from Gmail (deleted, or replaced by a later save):
        // only the cached copy is left to remove.
        Err(CoreError::NotFound(_)) => {}
        Err(e) => return Err(e),
    }
    store::delete_messages(&mut db.conn(), account, &[gmail_message_id])
}
