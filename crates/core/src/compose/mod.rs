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
use crate::gmail::types::DraftRef;
use crate::gmail::{parse, GmailClient};
use crate::model::{AccountId, Address, Attachment, AttachmentId, DraftId, MessageId, ThreadId};
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
    /// Attachments of the original carried along (forwards), by ID.
    pub forwarded: Vec<AttachmentId>,
    /// Images embedded in the quoted original (`cid:`), sent along so the
    /// quote shows them.
    pub inline_images: Vec<AttachmentId>,
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

/// Files ready to attach: (name, MIME type, bytes); for inline images
/// the first item is the Content-ID.
pub type Files = Vec<(String, String, Vec<u8>)>;

/// Parts of received mail a message carries along, already fetched: a
/// forward's attachments and the quote's embedded images.
#[derive(Debug, Clone, Default)]
pub struct Carried {
    pub forwarded: Files,
    pub inline: Files,
}

/// Fetches what a message carries from received mail, each part with its
/// own account's client, through the attachment cache.
pub async fn carried_parts(
    db: &Db,
    gmail_for: impl Fn(AccountId) -> Result<GmailClient>,
    msg: &OutgoingMessage,
    cache_dir: &std::path::Path,
) -> Result<Carried> {
    let mut out = Carried::default();
    for (ids, inline) in [(&msg.forwarded, false), (&msg.inline_images, true)] {
        for &id in ids {
            let a = store::attachment_ref(&db.conn(), id)?;
            let gmail = gmail_for(a.account)?;
            let path = crate::attachments::download(db, &gmail, id, cache_dir).await?;
            let bytes = std::fs::read(&path)
                .map_err(|e| CoreError::Other(format!("couldn't read {}: {e}", a.filename)))?;
            if inline {
                if let Some(cid) = a.content_id {
                    out.inline.push((cid, a.mime_type, bytes));
                }
            } else {
                out.forwarded.push((a.filename, a.mime_type, bytes));
            }
        }
    }
    Ok(out)
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
    /// The original's files (a forward carries them along).
    pub attachments: Vec<Attachment>,
    /// Images embedded in the original (`cid:`), for its quote.
    pub inline_images: Vec<AttachmentId>,
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
/// date and text. Messages synced before the app read Reply-To have it
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
    // One lock, bound first: two `db.conn()` in one expression deadlock.
    let (attachments, inline_images) = {
        let conn = db.conn();
        let files = store::attachments_for(&conn, message)?;
        let inline: Vec<AttachmentId> = store::inline_parts(&conn, message)?
            .into_iter()
            .filter(|a| a.content_id.is_some())
            .map(|a| a.id)
            .collect();
        (files, inline)
    };
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
        attachments,
        inline_images,
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
    send_with_files(db, gmail, msg, &Carried::default()).await
}

/// [`send`], with carried parts already fetched ([`carried_parts`]).
pub async fn send_with_files(
    db: &Db,
    gmail: &GmailClient,
    msg: &OutgoingMessage,
    carried: &Carried,
) -> Result<Option<ThreadId>> {
    validate(db, msg)?;
    let (raw, thread) = prepare(db, msg, &msg.to, &msg.cc, &msg.bcc, carried)?;
    let sent = gmail.send_message(&raw, thread.as_deref()).await?;
    // The mail is gone: from here nothing may report a failure (that
    // invited sending it again). Failing to cache it only delays it until
    // sync.
    let Ok(Some(t)) = gmail.thread_metadata(&sent.thread_id).await else {
        return Ok(None);
    };
    let cached = store::upsert_thread(
        &mut db.conn(),
        msg.account_id,
        &parse::thread_to_incoming(&t),
    );
    Ok(cached.ok())
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
    carried: &Carried,
) -> Result<(Vec<u8>, Option<String>)> {
    let mut files = decode_attachments(&msg.attachments)?;
    files.extend(carried.forwarded.iter().cloned());
    let total: usize = files.iter().chain(&carried.inline).map(|f| f.2.len()).sum();
    if total > MAX_ATTACHMENTS_BYTES {
        return Err(CoreError::Invalid(
            "Attachments are over Gmail's 25 MB limit.".into(),
        ));
    }
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
        attachments: files,
        inline: carried.inline.clone(),
        in_reply_to,
        references,
    })?;
    Ok((raw, thread))
}

/// Saves a message being written as a Gmail draft, so it survives quitting
/// and shows in Gmail's Drafts. The first save creates it; later saves
/// replace it. If From moved to another account, the draft moves too: the
/// old account's copy is deleted and the new account gets its own.
/// Returns the local draft ID (Gmail's draft IDs stay in Rust) and whether
/// caching it also brought other mail in ([`SavedDraft`]).
pub async fn save_draft(
    db: &Db,
    gmail_for: impl Fn(AccountId) -> Result<GmailClient>,
    existing: Option<DraftId>,
    msg: &OutgoingMessage,
) -> Result<SavedDraft> {
    save_draft_with_files(db, gmail_for, existing, msg, &Carried::default()).await
}

/// [`save_draft`], with carried parts already fetched.
pub async fn save_draft_with_files(
    db: &Db,
    gmail_for: impl Fn(AccountId) -> Result<GmailClient>,
    existing: Option<DraftId>,
    msg: &OutgoingMessage,
    carried: &Carried,
) -> Result<SavedDraft> {
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
    let (raw, thread) = prepare(
        db,
        msg,
        &keep(&msg.to),
        &keep(&msg.cc),
        &keep(&msg.bcc),
        carried,
    )?;
    let saved = match existing {
        Some(id) => draft_row(db, id)?.map(|row| (id, row)),
        None => None,
    };
    let mut moving_from = None;
    if let Some((id, (account, gmail_id))) = saved {
        if account == msg.account_id {
            let gmail = gmail_for(account)?;
            // Gmail replaces a draft's message on every save; the old one
            // has to leave the cache too, or it showed as a second copy
            // of the draft until the next sync (owner report, 2026-10-25).
            let replaced = cached_message(db, id)?;
            let saved = gmail
                .update_draft(&gmail_id, &raw, thread.as_deref())
                .await?;
            db.conn().execute(
                "UPDATE drafts SET updated_at = ?2 WHERE id = ?1",
                params![id, now_millis()],
            )?;
            let other_mail_changed = cache_draft(db, &gmail, account, id, &saved).await;
            if let Some(old) = replaced.filter(|old| *old != saved.message.id) {
                store::delete_messages(&mut db.conn(), account, &[old])?;
            }
            return Ok(SavedDraft {
                id,
                other_mail_changed,
            });
        }
        // From changed account: the draft moves with it (below).
        moving_from = Some(id);
    }
    let gmail = gmail_for(msg.account_id)?;
    let created = gmail.create_draft(&raw, thread.as_deref()).await?;
    let id = {
        let conn = db.conn();
        conn.execute(
            "INSERT INTO drafts (account_id, gmail_draft_id, updated_at) VALUES (?1, ?2, ?3)",
            params![msg.account_id, created.id, now_millis()],
        )?;
        DraftId(conn.last_insert_rowid())
    };
    let other_mail_changed = cache_draft(db, &gmail, msg.account_id, id, &created).await;
    // The old account's copy goes only once the new one is saved, so a
    // failure on either side never leaves the draft saved nowhere. If it
    // can't go now, it stays in that account's Drafts: a spare copy the
    // owner can delete, rather than none.
    if let Some(old) = moving_from {
        let _ = delete_draft(db, &gmail_for, old).await;
    }
    Ok(SavedDraft {
        id,
        other_mail_changed,
    })
}

/// A saved draft: its local ID, and whether saving it also brought other
/// mail into the cache (see [`cache_draft`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SavedDraft {
    pub id: DraftId,
    /// Emails other than drafts arrived in or left the draft's conversation
    /// (Gmail had them before the next sync did): the window treats the
    /// save as a mail change, not a drafts-only one.
    pub other_mail_changed: bool,
}

/// Brings a just-saved draft's conversation into the cache, so it shows in
/// Drafts (and its conversation) at once rather than after the next sync,
/// and links the draft to its message. Best effort: sync catches up anyway.
///
/// The whole conversation is stored, so mail that changed in Gmail since
/// the last sync comes in with it. Says whether its emails other than
/// drafts changed (one arrived or left).
async fn cache_draft(
    db: &Db,
    gmail: &GmailClient,
    account: AccountId,
    id: DraftId,
    saved: &DraftRef,
) -> bool {
    let Ok(Some(thread)) = gmail.thread_metadata(&saved.message.thread_id).await else {
        return false;
    };
    let mut conn = db.conn();
    let gmail_thread = &saved.message.thread_id;
    let before = store::thread_emails(&conn, account, gmail_thread).unwrap_or_default();
    if store::upsert_thread(&mut conn, account, &parse::thread_to_incoming(&thread)).is_err() {
        return false;
    }
    let _ = conn.execute(
        "UPDATE drafts SET message_id =
           (SELECT id FROM messages WHERE account_id = ?2 AND gmail_message_id = ?3)
         WHERE id = ?1",
        params![id, account, saved.message.id],
    );
    // Unreadable (it can't be, just written): treated as changed, so the
    // window asks again rather than keep something stale.
    store::thread_emails(&conn, account, gmail_thread).map_or(true, |after| after != before)
}

/// The Gmail ID of the message a draft is cached as, if it's linked.
fn cached_message(db: &Db, id: DraftId) -> Result<Option<String>> {
    Ok(db
        .conn()
        .query_row(
            "SELECT m.gmail_message_id FROM drafts d JOIN messages m ON m.id = d.message_id
             WHERE d.id = ?1",
            [id],
            |r| r.get(0),
        )
        .optional()?)
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

/// Deletes a draft from Gmail (with its own account's client) and here,
/// including its cached message, so it leaves its conversation and the
/// Drafts list at once (not at the next sync, which let it be reopened
/// and deleted a second time). Already gone is fine. Returns the account
/// it was in, if it was still known here.
pub async fn delete_draft(
    db: &Db,
    gmail_for: &impl Fn(AccountId) -> Result<GmailClient>,
    id: DraftId,
) -> Result<Option<AccountId>> {
    let Some((account, gmail_id)) = draft_row(db, id)? else {
        return Ok(None);
    };
    gmail_for(account)?.delete_draft(&gmail_id).await?;
    let cached = cached_message(db, id)?;
    let mut conn = db.conn();
    if let Some(message) = cached {
        store::delete_messages(&mut conn, account, &[message])?;
    }
    conn.execute("DELETE FROM drafts WHERE id = ?1", [id])?;
    Ok(Some(account))
}

/// Drops empty lines from the end of a signature (Gmail signatures often
/// end with several): breaks, spaces and empty paragraphs. As the
/// composer's `trimSignature`.
pub fn trim_signature(html: &str) -> String {
    fn empty_inside(inner: &str) -> bool {
        let rest = inner
            .replace("&nbsp;", "")
            .replace("<br>", "")
            .replace("<br/>", "")
            .replace("<br />", "");
        rest.trim().is_empty()
    }
    let mut s = html.trim().to_string();
    loop {
        let before = s.len();
        s = s.trim_end().to_string();
        let lower = s.to_lowercase();
        if let Some(cut) = ["<br>", "<br/>", "<br />"]
            .iter()
            .find(|br| lower.ends_with(*br))
            .map(|br| s.len() - br.len())
        {
            s.truncate(cut);
        } else if let Some(tag) = ["p", "div"]
            .iter()
            .find(|t| lower.ends_with(&format!("</{t}>")))
        {
            let close = format!("</{tag}>").len();
            let open = lower[..lower.len() - close].rfind(&format!("<{tag}"));
            match open.and_then(|o| lower[o..].find('>').map(|e| (o, o + e + 1))) {
                Some((start, inner)) if empty_inside(&s[inner..s.len() - close]) => {
                    s.truncate(start)
                }
                _ => break,
            }
        }
        if s.len() == before {
            break;
        }
    }
    s
}

/// A message's text and HTML with the From address's signature below a
/// blank line, in Gmail's wrapper, as the composer saves and sends them.
pub fn with_signature(text: &str, html: &str, signature: Option<&str>) -> (String, String) {
    let signature = trim_signature(signature.unwrap_or_default());
    if signature.is_empty() {
        return (text.to_string(), html.to_string());
    }
    (
        format!(
            "{}\n\n{}",
            text.trim_end(),
            parse::html_to_text(&signature).trim()
        ),
        format!("{html}<div><br></div><div class=\"gmail_signature\">{signature}</div>"),
    )
}

/// Cleans an original for quoting in mail we send: scripts, forms,
/// frames and event handlers go, but its look stays: `<style>` blocks,
/// inline styles and table layout attributes, as Gmail keeps when it
/// quotes. (Plain `ammonia::clean` dropped all styling, so quotes looked
/// nothing like the original.)
pub fn quote_clean(html: &str) -> String {
    ammonia::Builder::default()
        // Embedded images stay as `cid:` links; their parts go along.
        .add_url_schemes(&["cid"])
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
    use super::{trim_signature, with_signature};

    #[test]
    fn signatures_lose_their_empty_tail_lines() {
        assert_eq!(trim_signature("Jordan<br><br> "), "Jordan");
        assert_eq!(
            trim_signature("<div>Jordan</div><div><br></div><p>&nbsp;</p>"),
            "<div>Jordan</div>"
        );
        assert_eq!(
            trim_signature("<div>Jordan <b>W</b></div>"),
            "<div>Jordan <b>W</b></div>"
        );
        assert_eq!(trim_signature("  <br>  "), "");
    }

    #[test]
    fn a_signature_goes_under_a_blank_line_in_gmails_wrapper() {
        let (text, html) = with_signature("Hi Sam", "<p>Hi Sam</p>", Some("<div>Jordan</div><br>"));
        assert_eq!(text, "Hi Sam\n\nJordan");
        assert_eq!(
            html,
            "<p>Hi Sam</p><div><br></div><div class=\"gmail_signature\"><div>Jordan</div></div>"
        );
        assert_eq!(
            with_signature("Hi", "<p>Hi</p>", None),
            ("Hi".to_string(), "<p>Hi</p>".to_string())
        );
    }

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
    fn quoted_html_keeps_embedded_image_links() {
        let clean = super::quote_clean(r#"<img src="cid:logo@x"><img src="javascript:x()">"#);
        assert!(clean.contains(r#"src="cid:logo@x""#), "{clean}");
        assert!(!clean.contains("javascript"), "{clean}");
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
            r#"<table><tr><td><b>Hi</b></td></tr></table><script>x()</script><a href="https://x.example" onclick="y()">l</a>"#,
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
    /// Its attached files, downloaded, ready to go with it again.
    pub files: Vec<OutgoingAttachment>,
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
    // Its files come along as plain attachments: the draft's message (and
    // with it these parts) is replaced the first time it's saved again.
    let mut files = Vec::new();
    for part in parse::extract_attachments(&payload, body.html.as_deref())
        .into_iter()
        .filter(|p| !p.inline)
    {
        let bytes = match parse::part_data(&payload, &part.part_id) {
            Some(bytes) => bytes,
            None => match &part.gmail_attachment_id {
                Some(id) => gmail.attachment(&gmail_message_id, id).await?,
                None => continue,
            },
        };
        use base64::Engine;
        files.push(OutgoingAttachment {
            filename: part.filename,
            mime_type: part.mime_type,
            data: base64::engine::general_purpose::STANDARD.encode(bytes),
        });
    }
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
        files,
    })
}

/// Discards a draft shown in a conversation (wherever it was made): deleted
/// from Gmail and from the cache at once.
pub async fn discard_draft_message(db: &Db, gmail: &GmailClient, message: MessageId) -> Result<()> {
    let found = store::message_gmail_ref(&db.conn(), message);
    let (account, gmail_message_id) = match found {
        Ok(found) => found,
        // Already removed here (deleting its draft takes the message too).
        Err(CoreError::NotFound(_)) => return Ok(()),
        Err(e) => return Err(e),
    };
    match draft_for_message(db, gmail, message).await {
        Ok(draft) => {
            delete_draft(db, &|_| Ok(gmail.clone()), draft).await?;
        }
        // Already gone from Gmail (deleted, or replaced by a later save):
        // only the cached copy is left to remove.
        Err(CoreError::NotFound(_)) => {}
        Err(e) => return Err(e),
    }
    store::delete_messages(&mut db.conn(), account, &[gmail_message_id])
}
