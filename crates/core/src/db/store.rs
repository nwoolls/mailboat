//! Writes synced Gmail data into the cache. Everything here takes an
//! `AccountId` and resolves Gmail IDs only within that account.

use std::collections::HashSet;

use rusqlite::{params, Connection, OptionalExtension};

use super::{now_millis, placeholders};
use crate::error::{CoreError, Result};
use crate::model::{
    AccountId, AccountSyncState, Address, Attachment, AttachmentId, LabelId, LabelKind, MessageId,
    SyncStatus, ThreadId, ThreadSender,
};

/// A label as reported by Gmail's `labels.list`.
#[derive(Debug, Clone)]
pub struct IncomingLabel {
    pub gmail_label_id: String,
    pub name: String,
    pub kind: LabelKind,
    pub color_bg: Option<String>,
    pub color_fg: Option<String>,
}

/// One message's metadata, already parsed out of Gmail's JSON.
#[derive(Debug, Clone, Default)]
pub struct IncomingMessage {
    pub gmail_message_id: String,
    pub label_ids: Vec<String>,
    pub internal_date: i64,
    pub snippet: String,
    pub subject: String,
    pub from: Option<Address>,
    pub to: Vec<Address>,
    pub cc: Vec<Address>,
    /// Where replies should go, if not to From.
    pub reply_to: Vec<Address>,
    pub rfc822_message_id: Option<String>,
    pub in_reply_to: Option<String>,
    pub references: Option<String>,
    pub has_attachments: bool,
}

/// A complete thread: the messages listed are all the messages it has.
#[derive(Debug, Clone, Default)]
pub struct IncomingThread {
    pub gmail_thread_id: String,
    pub messages: Vec<IncomingMessage>,
}

/// Replaces the account's label list with what Gmail reported.
pub fn sync_labels(
    conn: &mut Connection,
    account: AccountId,
    labels: &[IncomingLabel],
) -> Result<()> {
    let tx = conn.transaction()?;
    for label in labels {
        tx.execute(
            "INSERT INTO labels (account_id, gmail_label_id, name, kind, color_bg, color_fg)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT (account_id, gmail_label_id) DO UPDATE SET
               name = excluded.name, kind = excluded.kind,
               color_bg = excluded.color_bg, color_fg = excluded.color_fg",
            params![
                account,
                label.gmail_label_id,
                label.name,
                label.kind.as_str(),
                label.color_bg,
                label.color_fg
            ],
        )?;
    }
    let keep: Vec<&str> = labels.iter().map(|l| l.gmail_label_id.as_str()).collect();
    if !keep.is_empty() {
        let sql = format!(
            "DELETE FROM labels WHERE account_id = ? AND gmail_label_id NOT IN ({})",
            placeholders(keep.len())
        );
        let mut values: Vec<&dyn rusqlite::ToSql> = vec![&account];
        values.extend(keep.iter().map(|k| k as &dyn rusqlite::ToSql));
        tx.execute(&sql, values.as_slice())?;
    }
    tx.commit()?;
    Ok(())
}

/// Finds the label row for a Gmail label ID in this account, creating a
/// placeholder if the message references a label we have not listed yet.
fn label_id(conn: &Connection, account: AccountId, gmail_label_id: &str) -> Result<LabelId> {
    if let Some(id) = conn
        .query_row(
            "SELECT id FROM labels WHERE account_id = ?1 AND gmail_label_id = ?2",
            params![account, gmail_label_id],
            |r| r.get(0),
        )
        .optional()?
    {
        return Ok(id);
    }
    // Gmail user labels are always "Label_<n>"; everything else is a system
    // or category label.
    let kind = if gmail_label_id.starts_with("Label_") {
        LabelKind::User
    } else {
        LabelKind::System
    };
    conn.execute(
        "INSERT INTO labels (account_id, gmail_label_id, name, kind) VALUES (?1, ?2, ?2, ?3)",
        params![account, gmail_label_id, kind.as_str()],
    )?;
    Ok(LabelId(conn.last_insert_rowid()))
}

/// Inserts or replaces a whole thread. Messages that disappeared from the
/// thread are deleted, labels are replaced, and the thread's summary columns,
/// derived labels and search index are rebuilt.
pub fn upsert_thread(
    conn: &mut Connection,
    account: AccountId,
    thread: &IncomingThread,
) -> Result<ThreadId> {
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO threads (account_id, gmail_thread_id, synced_at) VALUES (?1, ?2, ?3)
         ON CONFLICT (account_id, gmail_thread_id) DO UPDATE SET synced_at = excluded.synced_at",
        params![account, thread.gmail_thread_id, now_millis()],
    )?;
    let thread_id: ThreadId = tx.query_row(
        "SELECT id FROM threads WHERE account_id = ?1 AND gmail_thread_id = ?2",
        params![account, thread.gmail_thread_id],
        |r| r.get(0),
    )?;

    let mut kept: Vec<MessageId> = Vec::with_capacity(thread.messages.len());
    // Threads an email moves out of (R7-03): tidied below.
    let mut left: Vec<ThreadId> = Vec::new();
    for msg in &thread.messages {
        let previous: Option<ThreadId> = tx
            .query_row(
                "SELECT thread_id FROM messages WHERE account_id = ?1 AND gmail_message_id = ?2",
                params![account, msg.gmail_message_id],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(previous) = previous.filter(|p| *p != thread_id) {
            if !left.contains(&previous) {
                left.push(previous);
            }
        }
        let from = msg.from.clone().unwrap_or(Address {
            name: None,
            email: String::new(),
        });
        tx.execute(
            "INSERT INTO messages (account_id, thread_id, gmail_message_id, internal_date, subject, snippet,
               from_name, from_email, to_json, cc_json, rfc822_message_id, in_reply_to, references_header, has_attachments,
               reply_to_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
             ON CONFLICT (account_id, gmail_message_id) DO UPDATE SET
               thread_id = excluded.thread_id, internal_date = excluded.internal_date,
               subject = excluded.subject, snippet = excluded.snippet,
               from_name = excluded.from_name, from_email = excluded.from_email,
               to_json = excluded.to_json, cc_json = excluded.cc_json,
               reply_to_json = excluded.reply_to_json,
               rfc822_message_id = excluded.rfc822_message_id, in_reply_to = excluded.in_reply_to,
               references_header = excluded.references_header,
               -- Once the body is fetched, its attachment list is the
               -- real answer; the header-only guess mustn't overwrite it.
               has_attachments = CASE WHEN EXISTS (
                   SELECT 1 FROM message_bodies b
                   WHERE b.message_id = messages.id AND b.parts_version >= 1)
                 THEN messages.has_attachments ELSE excluded.has_attachments END",
            params![
                account,
                thread_id,
                msg.gmail_message_id,
                msg.internal_date,
                msg.subject,
                msg.snippet,
                from.name,
                from.email,
                serde_json::to_string(&msg.to)?,
                serde_json::to_string(&msg.cc)?,
                msg.rfc822_message_id,
                msg.in_reply_to,
                msg.references,
                msg.has_attachments,
                serde_json::to_string(&msg.reply_to)?,
            ],
        )?;
        let message_id: MessageId = tx.query_row(
            "SELECT id FROM messages WHERE account_id = ?1 AND gmail_message_id = ?2",
            params![account, msg.gmail_message_id],
            |r| r.get(0),
        )?;
        kept.push(message_id);

        tx.execute(
            "DELETE FROM message_labels WHERE message_id = ?1",
            [message_id],
        )?;
        for gmail_label in &msg.label_ids {
            let label = label_id(&tx, account, gmail_label)?;
            tx.execute(
                "INSERT OR IGNORE INTO message_labels (account_id, message_id, label_id) VALUES (?1, ?2, ?3)",
                params![account, message_id, label],
            )?;
        }
        index_message(&tx, message_id, msg, &from)?;
    }

    // Drop messages that are no longer part of this thread.
    let sql = format!(
        "DELETE FROM messages WHERE thread_id = ? AND id NOT IN ({})",
        placeholders(kept.len().max(1))
    );
    let none = MessageId(-1);
    let mut values: Vec<&dyn rusqlite::ToSql> = vec![&thread_id];
    if kept.is_empty() {
        values.push(&none);
    } else {
        values.extend(kept.iter().map(|k| k as &dyn rusqlite::ToSql));
    }
    let dropped = tx.execute(&sql, values.as_slice())?;
    if dropped > 0 {
        forget_search_hits(&tx, thread_id)?;
    }

    if kept.is_empty() {
        tx.execute("DELETE FROM threads WHERE id = ?1", [thread_id])?;
    } else {
        refresh_thread(&tx, account, thread_id)?;
    }
    // A thread an email moved out of: its Gmail hits may have been for
    // that email, and its counts change; gone if nothing's left.
    for previous in left {
        forget_search_hits(&tx, previous)?;
        // Its summary and reply ideas covered the email that left; they're
        // only rechecked against the newest email, which may not change
        // (code review R8-04).
        tx.execute("DELETE FROM ai_summaries WHERE thread_id = ?1", [previous])?;
        tx.execute(
            "DELETE FROM ai_reply_ideas WHERE thread_id = ?1",
            [previous],
        )?;
        let remaining: i64 = tx.query_row(
            "SELECT COUNT(*) FROM messages WHERE thread_id = ?1",
            [previous],
            |r| r.get(0),
        )?;
        if remaining == 0 {
            tx.execute("DELETE FROM threads WHERE id = ?1", [previous])?;
        } else {
            refresh_thread(&tx, account, previous)?;
        }
    }
    tx.commit()?;
    Ok(thread_id)
}

fn index_message(
    conn: &Connection,
    id: MessageId,
    msg: &IncomingMessage,
    from: &Address,
) -> Result<()> {
    let sender = format!("{} {}", from.name.as_deref().unwrap_or(""), from.email);
    let recipients = msg
        .to
        .iter()
        .chain(msg.cc.iter())
        .map(|a| format!("{} {}", a.name.as_deref().unwrap_or(""), a.email))
        .collect::<Vec<_>>()
        .join(" ");
    // Keep the body column if we already fetched it.
    let body: Option<String> = conn
        .query_row(
            "SELECT text FROM message_bodies WHERE message_id = ?1",
            [id],
            |r| r.get(0),
        )
        .optional()?
        .flatten();
    conn.execute("DELETE FROM messages_fts WHERE rowid = ?1", [id])?;
    conn.execute(
        "INSERT INTO messages_fts (rowid, subject, sender, recipients, snippet, body) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, msg.subject, sender, recipients, msg.snippet, body.unwrap_or_default()],
    )?;
    Ok(())
}

/// Rebuilds a thread's summary columns and derived labels from its messages.
fn refresh_thread(conn: &Connection, account: AccountId, thread: ThreadId) -> Result<()> {
    conn.execute("DELETE FROM thread_labels WHERE thread_id = ?1", [thread])?;
    conn.execute(
        "INSERT INTO thread_labels (account_id, thread_id, label_id)
         SELECT DISTINCT ?1, m.thread_id, ml.label_id
         FROM messages m JOIN message_labels ml ON ml.message_id = m.id
         WHERE m.thread_id = ?2",
        params![account, thread],
    )?;

    // Each sender once, in the order they first wrote; unread if any of
    // their messages is (the list bolds those, as Gmail does).
    let mut stmt = conn.prepare(
        "SELECT m.from_name, m.from_email,
           EXISTS (SELECT 1 FROM message_labels ml JOIN labels l ON l.id = ml.label_id
                   WHERE ml.message_id = m.id AND l.gmail_label_id = 'UNREAD')
         FROM messages m WHERE m.thread_id = ?1 ORDER BY m.internal_date, m.id",
    )?;
    let mut senders: Vec<ThreadSender> = Vec::new();
    for row in stmt.query_map([thread], |r| {
        Ok(ThreadSender {
            name: r.get(0)?,
            email: r.get(1)?,
            unread: r.get(2)?,
        })
    })? {
        let sender = row?;
        if sender.email.is_empty() {
            continue;
        }
        match senders
            .iter_mut()
            .find(|s| s.email.eq_ignore_ascii_case(&sender.email))
        {
            Some(seen) => seen.unread |= sender.unread,
            None => senders.push(sender),
        }
    }

    conn.execute(
        "UPDATE threads SET
           subject = COALESCE((SELECT subject FROM messages WHERE thread_id = ?1 ORDER BY internal_date, id LIMIT 1), ''),
           snippet = COALESCE((SELECT snippet FROM messages WHERE thread_id = ?1 ORDER BY internal_date DESC, id DESC LIMIT 1), ''),
           last_message_at = COALESCE((SELECT MAX(internal_date) FROM messages WHERE thread_id = ?1), 0),
           message_count = (SELECT COUNT(*) FROM messages WHERE thread_id = ?1),
           unread_count = (SELECT COUNT(*) FROM messages m
                           JOIN message_labels ml ON ml.message_id = m.id
                           JOIN labels l ON l.id = ml.label_id
                           WHERE m.thread_id = ?1 AND l.gmail_label_id = 'UNREAD'),
           has_attachments = EXISTS (SELECT 1 FROM messages WHERE thread_id = ?1 AND has_attachments),
           senders_json = ?2
         WHERE id = ?1",
        params![thread, serde_json::to_string(&senders)?],
    )?;
    Ok(())
}

/// Forgets what Gmail's searches found in a thread once an email has left
/// it: a hit doesn't say which email matched, so it may have been the one
/// that's gone (code review R6-05: deleting a trashed email made its old
/// hit count again). They're a cache, found again by the next search.
fn forget_search_hits(conn: &Connection, thread: ThreadId) -> Result<()> {
    conn.execute("DELETE FROM search_hits WHERE thread_id = ?1", [thread])?;
    Ok(())
}

/// Deletes messages by Gmail ID (from `history.list` messageDeleted events).
/// Threads left empty are removed too.
pub fn delete_messages(
    conn: &mut Connection,
    account: AccountId,
    gmail_message_ids: &[String],
) -> Result<()> {
    let tx = conn.transaction()?;
    let mut touched: HashSet<ThreadId> = HashSet::new();
    for gid in gmail_message_ids {
        let thread: Option<ThreadId> = tx
            .query_row(
                "SELECT thread_id FROM messages WHERE account_id = ?1 AND gmail_message_id = ?2",
                params![account, gid],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(thread) = thread {
            tx.execute(
                "DELETE FROM messages WHERE account_id = ?1 AND gmail_message_id = ?2",
                params![account, gid],
            )?;
            forget_search_hits(&tx, thread)?;
            touched.insert(thread);
        }
    }
    for thread in touched {
        let remaining: i64 = tx.query_row(
            "SELECT COUNT(*) FROM messages WHERE thread_id = ?1",
            [thread],
            |r| r.get(0),
        )?;
        if remaining == 0 {
            tx.execute("DELETE FROM threads WHERE id = ?1", [thread])?;
        } else {
            refresh_thread(&tx, account, thread)?;
        }
    }
    tx.commit()?;
    Ok(())
}

/// Removes a thread Gmail says no longer exists.
pub fn delete_thread(conn: &Connection, account: AccountId, gmail_thread_id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM threads WHERE account_id = ?1 AND gmail_thread_id = ?2",
        params![account, gmail_thread_id],
    )?;
    Ok(())
}

/// The cached thread with this Gmail ID in this account, if any.
pub fn thread_id_for(
    conn: &Connection,
    account: AccountId,
    gmail_thread_id: &str,
) -> Result<Option<ThreadId>> {
    Ok(conn
        .query_row(
            "SELECT id FROM threads WHERE account_id = ?1 AND gmail_thread_id = ?2",
            params![account, gmail_thread_id],
            |r| r.get(0),
        )
        .optional()?)
}

/// Removes every cached thread of an account (before a full resync).
pub fn clear_account_mail(conn: &Connection, account: AccountId) -> Result<()> {
    conn.execute("DELETE FROM threads WHERE account_id = ?1", [account])?;
    Ok(())
}

pub fn thread_ids_for_account(conn: &Connection, account: AccountId) -> Result<HashSet<String>> {
    let mut stmt = conn.prepare("SELECT gmail_thread_id FROM threads WHERE account_id = ?1")?;
    let rows = stmt.query_map([account], |r| r.get::<_, String>(0))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// The Gmail ID pair for a local message, used when talking to the API.
pub fn message_gmail_ref(conn: &Connection, message: MessageId) -> Result<(AccountId, String)> {
    conn.query_row(
        "SELECT account_id, gmail_message_id FROM messages WHERE id = ?1",
        [message],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .optional()?
    .ok_or_else(|| CoreError::NotFound(format!("message {}", message.0)))
}

// ---- Bodies ----

#[derive(Debug, Clone, PartialEq)]
pub struct StoredBody {
    pub html: Option<String>,
    pub text: Option<String>,
}

/// Which attachment rules cached bodies were read with. Bodies stored
/// with an older version count as missing, so they're fetched again (once)
/// to record their attachments. Bump when attachment parsing changes.
pub const PARTS_VERSION: i64 = 1;

/// One attachment part of a fetched message, parsed from its MIME tree.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct IncomingAttachment {
    /// MIME part ID within the message (stable, unlike Gmail's attachment ID).
    pub part_id: String,
    /// Absent for small parts whose data came inline with the message.
    pub gmail_attachment_id: Option<String>,
    pub filename: String,
    pub mime_type: String,
    pub size: u64,
    /// Without angle brackets.
    pub content_id: Option<String>,
    /// The HTML body shows it itself (`cid:`), so it isn't listed as a file.
    pub inline: bool,
}

/// A cached body, or `None` if it was never fetched (or was fetched before
/// attachments were recorded).
pub fn get_body(conn: &Connection, message: MessageId) -> Result<Option<StoredBody>> {
    Ok(conn
        .query_row(
            "SELECT html, text FROM message_bodies WHERE message_id = ?1 AND parts_version >= ?2",
            params![message, PARTS_VERSION],
            |r| {
                Ok(StoredBody {
                    html: r.get(0)?,
                    text: r.get(1)?,
                })
            },
        )
        .optional()?)
}

/// A message's calendar part: `Some(None)` if its body was read and has
/// none, `None` if it hasn't been looked for (not fetched, or cached
/// before the app kept calendar parts).
pub fn calendar(conn: &Connection, message: MessageId) -> Result<Option<Option<String>>> {
    Ok(conn
        .query_row(
            "SELECT calendar FROM message_bodies WHERE message_id = ?1 AND calendar_read",
            [message],
            |r| r.get(0),
        )
        .optional()?)
}

/// Records what a fetched body's calendar part is (or that it has none).
/// The body must already be stored.
pub fn set_calendar(conn: &Connection, message: MessageId, ics: Option<&str>) -> Result<()> {
    conn.execute(
        "UPDATE message_bodies SET calendar = ?2, calendar_read = 1 WHERE message_id = ?1",
        params![message, ics],
    )?;
    Ok(())
}

/// Whether a message has an `.ics` file attached (Google's invitations
/// do): worth re-reading a body cached before calendar parts were kept.
pub fn has_calendar_attachment(conn: &Connection, message: MessageId) -> Result<bool> {
    Ok(conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM attachments WHERE message_id = ?1 AND
           (lower(mime_type) IN ('text/calendar', 'application/ics') OR lower(filename) LIKE '%.ics'))",
        [message],
        |r| r.get(0),
    )?)
}

/// Stores a fetched body and its attachment parts. Attachments already
/// downloaded keep their cached file (matched by part ID).
pub fn set_body(
    conn: &mut Connection,
    message: MessageId,
    body: &StoredBody,
    attachments: &[IncomingAttachment],
) -> Result<()> {
    let (account, _) = message_gmail_ref(conn, message)?;
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO message_bodies (message_id, account_id, html, text, fetched_at, parts_version) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT (message_id) DO UPDATE SET html = excluded.html, text = excluded.text,
           fetched_at = excluded.fetched_at, parts_version = excluded.parts_version",
        params![message, account, body.html, body.text, now_millis(), PARTS_VERSION],
    )?;
    tx.execute(
        "UPDATE messages_fts SET body = ?2 WHERE rowid = ?1",
        params![message, body.text.as_deref().unwrap_or("")],
    )?;
    let mut kept: Vec<String> = Vec::new();
    for a in attachments {
        tx.execute(
            "INSERT INTO attachments (account_id, message_id, part_id, gmail_attachment_id, filename, mime_type, size, content_id, inline)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT (account_id, message_id, part_id) DO UPDATE SET
               gmail_attachment_id = excluded.gmail_attachment_id, filename = excluded.filename,
               mime_type = excluded.mime_type, size = excluded.size,
               content_id = excluded.content_id, inline = excluded.inline",
            params![
                account,
                message,
                a.part_id,
                a.gmail_attachment_id,
                a.filename,
                a.mime_type,
                a.size as i64,
                a.content_id,
                a.inline
            ],
        )?;
        kept.push(a.part_id.clone());
    }
    let sql = format!(
        "DELETE FROM attachments WHERE message_id = ? AND part_id NOT IN ({})",
        placeholders(kept.len().max(1))
    );
    let none = String::new();
    let mut values: Vec<&dyn rusqlite::ToSql> = vec![&message];
    if kept.is_empty() {
        values.push(&none);
    } else {
        values.extend(kept.iter().map(|k| k as &dyn rusqlite::ToSql));
    }
    tx.execute(&sql, values.as_slice())?;
    // The real answer for the paperclip, replacing sync's header-only guess.
    tx.execute(
        "UPDATE messages SET has_attachments =
           EXISTS (SELECT 1 FROM attachments WHERE message_id = ?1 AND NOT inline)
         WHERE id = ?1",
        [message],
    )?;
    let thread: ThreadId = tx.query_row(
        "SELECT thread_id FROM messages WHERE id = ?1",
        [message],
        |r| r.get(0),
    )?;
    refresh_thread(&tx, account, thread)?;
    tx.commit()?;
    Ok(())
}

/// Marks cached messages (by Gmail ID) as having attachments, unless their
/// body was fetched (then its attachment list already decided), and
/// updates their threads. Returns how many messages changed.
pub fn mark_messages_with_attachments(
    conn: &mut Connection,
    account: AccountId,
    gmail_message_ids: &[String],
) -> Result<usize> {
    let tx = conn.transaction()?;
    let mut changed = 0;
    {
        let mut stmt = tx.prepare(
            "UPDATE messages SET has_attachments = 1
             WHERE account_id = ?1 AND gmail_message_id = ?2 AND NOT has_attachments
               AND NOT EXISTS (SELECT 1 FROM message_bodies b
                               WHERE b.message_id = messages.id AND b.parts_version >= ?3)",
        )?;
        for id in gmail_message_ids {
            changed += stmt.execute(params![account, id, PARTS_VERSION])?;
        }
    }
    tx.execute(
        "UPDATE threads SET has_attachments =
           EXISTS (SELECT 1 FROM messages m WHERE m.thread_id = threads.id AND m.has_attachments)
         WHERE account_id = ?1",
        [account],
    )?;
    tx.commit()?;
    Ok(changed)
}

/// A message's attachments that are files (inline images left out), in
/// the order they appear in the message.
pub fn attachments_for(conn: &Connection, message: MessageId) -> Result<Vec<Attachment>> {
    let mut stmt = conn.prepare(
        "SELECT id, message_id, filename, mime_type, size FROM attachments
         WHERE message_id = ?1 AND NOT inline ORDER BY id",
    )?;
    let rows = stmt.query_map([message], |r| {
        Ok(Attachment {
            id: r.get(0)?,
            message_id: r.get(1)?,
            filename: r.get(2)?,
            mime_type: r.get(3)?,
            size: r.get::<_, i64>(4)?.max(0) as u64,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Everything needed to download one attachment.
#[derive(Debug, Clone, PartialEq)]
pub struct AttachmentRef {
    pub id: AttachmentId,
    pub account: AccountId,
    pub message: MessageId,
    pub gmail_message_id: String,
    pub part_id: String,
    pub gmail_attachment_id: Option<String>,
    pub filename: String,
    pub mime_type: String,
    pub size: u64,
    pub content_id: Option<String>,
    pub cached_path: Option<String>,
}

const ATTACHMENT_REF_SQL: &str =
    "SELECT a.id, a.account_id, a.message_id, m.gmail_message_id, a.part_id,
       a.gmail_attachment_id, a.filename, a.mime_type, a.size, a.content_id, a.cached_path
     FROM attachments a JOIN messages m ON m.id = a.message_id AND m.account_id = a.account_id";

fn attachment_ref_from_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<AttachmentRef> {
    Ok(AttachmentRef {
        id: r.get(0)?,
        account: r.get(1)?,
        message: r.get(2)?,
        gmail_message_id: r.get(3)?,
        part_id: r.get(4)?,
        gmail_attachment_id: r.get(5)?,
        filename: r.get(6)?,
        mime_type: r.get(7)?,
        size: r.get::<_, i64>(8)?.max(0) as u64,
        content_id: r.get(9)?,
        cached_path: r.get(10)?,
    })
}

pub fn attachment_ref(conn: &Connection, id: AttachmentId) -> Result<AttachmentRef> {
    conn.query_row(
        &format!("{ATTACHMENT_REF_SQL} WHERE a.id = ?1"),
        [id],
        attachment_ref_from_row,
    )
    .optional()?
    .ok_or_else(|| CoreError::NotFound(format!("attachment {}", id.0)))
}

/// A message's inline parts (`cid:` images the body shows).
pub fn inline_parts(conn: &Connection, message: MessageId) -> Result<Vec<AttachmentRef>> {
    let mut stmt = conn.prepare(&format!(
        "{ATTACHMENT_REF_SQL} WHERE a.message_id = ?1 AND a.inline ORDER BY a.id"
    ))?;
    let rows = stmt.query_map([message], attachment_ref_from_row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn set_attachment_cached_path(conn: &Connection, id: AttachmentId, path: &str) -> Result<()> {
    conn.execute(
        "UPDATE attachments SET cached_path = ?2 WHERE id = ?1",
        params![id, path],
    )?;
    Ok(())
}

/// Messages without a cached body, newest first (for prefetching).
pub fn messages_missing_body(
    conn: &Connection,
    account: AccountId,
    limit: u32,
) -> Result<Vec<MessageId>> {
    let mut stmt = conn.prepare(
        "SELECT m.id FROM messages m LEFT JOIN message_bodies b ON b.message_id = m.id
         WHERE m.account_id = ?1 AND (b.message_id IS NULL OR b.parts_version < ?3)
         ORDER BY m.internal_date DESC LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![account, limit, PARTS_VERSION], |r| r.get(0))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Of these just-added messages (Gmail IDs), the ones now unread in the
/// Inbox, excluding your own sent mail and drafts: what notifications are
/// about.
pub fn new_inbox_messages(
    conn: &Connection,
    account: AccountId,
    gmail_ids: &[String],
) -> Result<Vec<MessageId>> {
    if gmail_ids.is_empty() {
        return Ok(Vec::new());
    }
    let has = |label: &str| {
        format!(
            "EXISTS (SELECT 1 FROM message_labels ml JOIN labels l ON l.id = ml.label_id
                     WHERE ml.message_id = m.id AND l.gmail_label_id = '{label}')"
        )
    };
    let sql = format!(
        "SELECT m.id FROM messages m
         WHERE m.account_id = ? AND m.gmail_message_id IN ({})
           AND {} AND {} AND NOT {} AND NOT {}
         ORDER BY m.internal_date",
        placeholders(gmail_ids.len()),
        has("INBOX"),
        has("UNREAD"),
        has("SENT"),
        has("DRAFT"),
    );
    let mut values: Vec<&dyn rusqlite::ToSql> = vec![&account];
    values.extend(gmail_ids.iter().map(|g| g as &dyn rusqlite::ToSql));
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(values.as_slice(), |r| r.get(0))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Of these just-added messages (Gmail IDs), the ones now unread
/// anywhere but Spam and Trash, excluding your own sent mail and drafts:
/// what notifies when every new email should.
pub fn new_unread_messages(
    conn: &Connection,
    account: AccountId,
    gmail_ids: &[String],
) -> Result<Vec<MessageId>> {
    if gmail_ids.is_empty() {
        return Ok(Vec::new());
    }
    let has = |label: &str| {
        format!(
            "EXISTS (SELECT 1 FROM message_labels ml JOIN labels l ON l.id = ml.label_id
                     WHERE ml.message_id = m.id AND l.gmail_label_id = '{label}')"
        )
    };
    let sql = format!(
        "SELECT m.id FROM messages m
         WHERE m.account_id = ? AND m.gmail_message_id IN ({})
           AND {} AND NOT {} AND NOT {} AND NOT {} AND NOT {}
         ORDER BY m.internal_date",
        placeholders(gmail_ids.len()),
        has("UNREAD"),
        has("SENT"),
        has("DRAFT"),
        has("SPAM"),
        has("TRASH"),
    );
    let mut values: Vec<&dyn rusqlite::ToSql> = vec![&account];
    values.extend(gmail_ids.iter().map(|g| g as &dyn rusqlite::ToSql));
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(values.as_slice(), |r| r.get(0))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Forgets everything cached from an account's mail (conversations,
/// bodies, attachments' records, drafts, search hits, AI summaries) and
/// its sync progress, so its next sync starts from scratch, as when it was
/// added. The account, its labels and settings stay. Stop its worker first.
pub fn clear_mail(conn: &mut Connection, account: AccountId) -> Result<()> {
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM drafts WHERE account_id = ?1", [account])?;
    // Messages, their labels, bodies, attachments, search hits and AI
    // summaries go with their conversations (ON DELETE CASCADE).
    tx.execute("DELETE FROM threads WHERE account_id = ?1", [account])?;
    tx.execute("DELETE FROM sync_state WHERE account_id = ?1", [account])?;
    tx.execute("INSERT INTO sync_state (account_id) VALUES (?1)", [account])?;
    tx.commit()?;
    Ok(())
}

// ---- Sync state ----

pub fn history_id(conn: &Connection, account: AccountId) -> Result<Option<u64>> {
    Ok(conn
        .query_row(
            "SELECT history_id FROM sync_state WHERE account_id = ?1",
            [account],
            |r| r.get::<_, Option<i64>>(0),
        )
        .optional()?
        .flatten()
        .map(|h| h as u64))
}

/// A full sync in progress: (historyId it started from, start time ms).
pub fn pending_full_sync(conn: &Connection, account: AccountId) -> Result<Option<(u64, i64)>> {
    Ok(conn
        .query_row(
            "SELECT full_sync_history_id, full_sync_started_at FROM sync_state WHERE account_id = ?1",
            [account],
            |r| Ok((r.get::<_, Option<i64>>(0)?, r.get::<_, Option<i64>>(1)?)),
        )
        .optional()?
        .and_then(|(h, t)| Some((h? as u64, t?))))
}

pub fn begin_full_sync(conn: &Connection, account: AccountId, history_id: u64) -> Result<i64> {
    let started_at = now_millis();
    conn.execute(
        "UPDATE sync_state SET full_sync_history_id = ?2, full_sync_started_at = ?3 WHERE account_id = ?1",
        params![account, history_id as i64, started_at],
    )?;
    Ok(started_at)
}

/// Gmail thread IDs written at or after `since` (ms).
pub fn threads_synced_since(
    conn: &Connection,
    account: AccountId,
    since: i64,
) -> Result<HashSet<String>> {
    let mut stmt = conn
        .prepare("SELECT gmail_thread_id FROM threads WHERE account_id = ?1 AND synced_at >= ?2")?;
    let rows = stmt.query_map(params![account, since], |r| r.get::<_, String>(0))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Records the sync cursor. Finishing a full sync also clears its
/// in-progress marker.
pub fn set_history_id(
    conn: &Connection,
    account: AccountId,
    history_id: Option<u64>,
    full_sync: bool,
) -> Result<()> {
    let now = now_millis();
    conn.execute(
        "UPDATE sync_state SET history_id = ?2, last_sync_at = ?3,
           last_full_sync_at = CASE WHEN ?4 THEN ?3 ELSE last_full_sync_at END,
           full_sync_history_id = CASE WHEN ?4 THEN NULL ELSE full_sync_history_id END,
           full_sync_started_at = CASE WHEN ?4 THEN NULL ELSE full_sync_started_at END
         WHERE account_id = ?1",
        params![account, history_id.map(|h| h as i64), now, full_sync],
    )?;
    Ok(())
}

pub fn set_sync_status(
    conn: &Connection,
    account: AccountId,
    status: SyncStatus,
    error: Option<(&str, &str)>,
) -> Result<()> {
    let failed = matches!(
        status,
        SyncStatus::Backoff | SyncStatus::Error | SyncStatus::AuthError
    );
    conn.execute(
        // While a retry is running, keep showing the error that caused it;
        // it is cleared once a pass succeeds ('idle').
        "UPDATE sync_state SET status = ?2,
           error_kind = CASE WHEN ?2 = 'syncing' THEN error_kind ELSE ?3 END,
           error_message = CASE WHEN ?2 = 'syncing' THEN error_message ELSE ?4 END,
           consecutive_failures = CASE WHEN ?5 THEN consecutive_failures + 1
                                       WHEN ?2 = 'idle' THEN 0 ELSE consecutive_failures END
         WHERE account_id = ?1",
        params![
            account,
            status.as_str(),
            error.map(|e| e.0),
            error.map(|e| e.1),
            failed
        ],
    )?;
    Ok(())
}

pub fn sync_states(conn: &Connection) -> Result<Vec<AccountSyncState>> {
    let mut stmt = conn.prepare(
        "SELECT account_id, status, error_kind, error_message, last_sync_at FROM sync_state ORDER BY account_id",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(AccountSyncState {
            account_id: r.get(0)?,
            status: SyncStatus::parse(&r.get::<_, String>(1)?),
            error_kind: r.get(2)?,
            error_message: r.get(3)?,
            last_sync_at: r.get(4)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

// ---- Sender image preferences (global by design) ----

/// The saved choice for a sender's images: `Some(true)` load, `Some(false)`
/// block, `None` if the user never chose (the default applies).
pub fn sender_image_choice(conn: &Connection, sender_email: &str) -> Result<Option<bool>> {
    Ok(conn
        .query_row(
            "SELECT allow_images FROM sender_image_prefs WHERE sender_email = ?1",
            [sender_email],
            |r| r.get::<_, bool>(0),
        )
        .optional()?)
}

/// Whether a message is in Spam and whether it is in Trash. Labels are per
/// account, so this joins through the message's own account.
pub fn message_spam_trash(conn: &Connection, message: MessageId) -> Result<(bool, bool)> {
    Ok(conn.query_row(
        "SELECT
           EXISTS (SELECT 1 FROM message_labels ml JOIN labels l ON l.id = ml.label_id
                   WHERE ml.message_id = ?1 AND l.kind = 'system' AND l.gmail_label_id = 'SPAM'),
           EXISTS (SELECT 1 FROM message_labels ml JOIN labels l ON l.id = ml.label_id
                   WHERE ml.message_id = ?1 AND l.kind = 'system' AND l.gmail_label_id = 'TRASH')",
        [message],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?)
}

pub fn set_sender_allows_images(conn: &Connection, sender_email: &str, allow: bool) -> Result<()> {
    conn.execute(
        "INSERT INTO sender_image_prefs (sender_email, allow_images, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT (sender_email) DO UPDATE SET allow_images = excluded.allow_images, updated_at = excluded.updated_at",
        params![sender_email, allow, now_millis()],
    )?;
    Ok(())
}

/// Whether the sender's emails open with their original colors (the
/// reader's "Original colors"), remembered by address for every account.
pub fn sender_wants_original_colors(conn: &Connection, sender_email: &str) -> Result<bool> {
    Ok(conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM sender_color_prefs WHERE sender_email = ?1)",
        [sender_email],
        |r| r.get(0),
    )?)
}

/// Remembers (or forgets) that a sender's emails open with their original
/// colors.
pub fn set_sender_original_colors(
    conn: &Connection,
    sender_email: &str,
    original: bool,
) -> Result<()> {
    if original {
        conn.execute(
            "INSERT INTO sender_color_prefs (sender_email, updated_at) VALUES (?1, ?2)
             ON CONFLICT (sender_email) DO UPDATE SET updated_at = excluded.updated_at",
            params![sender_email, now_millis()],
        )?;
    } else {
        conn.execute(
            "DELETE FROM sender_color_prefs WHERE sender_email = ?1",
            [sender_email],
        )?;
    }
    Ok(())
}

// ---- Local label changes for actions (applied optimistically) ----

/// The owning account and Gmail ID of a local thread.
pub fn thread_gmail_ref(conn: &Connection, thread: ThreadId) -> Result<(AccountId, String)> {
    conn.query_row(
        "SELECT account_id, gmail_thread_id FROM threads WHERE id = ?1",
        [thread],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .optional()?
    .ok_or_else(|| CoreError::NotFound(format!("thread {}", thread.0)))
}

/// The owning account, Gmail ID and kind of a local label.
pub fn label_ref(conn: &Connection, label: LabelId) -> Result<(AccountId, String, LabelKind)> {
    conn.query_row(
        "SELECT account_id, gmail_label_id, kind FROM labels WHERE id = ?1",
        [label],
        |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                LabelKind::parse(&r.get::<_, String>(2)?),
            ))
        },
    )
    .optional()?
    .ok_or_else(|| CoreError::NotFound(format!("label {}", label.0)))
}

/// Which of a thread's messages currently carry a Gmail label.
#[derive(Debug, Clone, PartialEq)]
pub struct LabelSnapshot {
    pub thread: ThreadId,
    pub gmail_label_id: String,
    pub messages_with_label: Vec<MessageId>,
}

pub fn label_snapshot(
    conn: &Connection,
    thread: ThreadId,
    gmail_label_id: &str,
) -> Result<LabelSnapshot> {
    let mut stmt = conn.prepare(
        "SELECT m.id FROM messages m
         JOIN message_labels ml ON ml.message_id = m.id
         JOIN labels l ON l.id = ml.label_id
         WHERE m.thread_id = ?1 AND l.gmail_label_id = ?2",
    )?;
    let messages_with_label = stmt
        .query_map(params![thread, gmail_label_id], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(LabelSnapshot {
        thread,
        gmail_label_id: gmail_label_id.to_string(),
        messages_with_label,
    })
}

/// Adds or removes a Gmail label on every message of a thread, locally.
/// Moves an account's cached Spam messages to Trash, as "Empty Spam" did
/// in Gmail: per message (spam is), then each touched thread's labels.
pub fn spam_to_trash(conn: &mut Connection, account: AccountId) -> Result<()> {
    let tx = conn.transaction()?;
    let spam = label_id(&tx, account, "SPAM")?;
    let trash = label_id(&tx, account, "TRASH")?;
    let threads: Vec<ThreadId> = {
        let mut stmt = tx.prepare(
            "SELECT DISTINCT m.thread_id FROM messages m JOIN message_labels ml ON ml.message_id = m.id
             WHERE ml.account_id = ?1 AND ml.label_id = ?2",
        )?;
        let rows = stmt.query_map(params![account, spam], |r| r.get(0))?;
        rows.collect::<rusqlite::Result<_>>()?
    };
    tx.execute(
        "INSERT OR IGNORE INTO message_labels (account_id, message_id, label_id)
         SELECT ?1, message_id, ?3 FROM message_labels WHERE account_id = ?1 AND label_id = ?2",
        params![account, spam, trash],
    )?;
    tx.execute(
        "DELETE FROM message_labels WHERE account_id = ?1 AND label_id = ?2",
        params![account, spam],
    )?;
    for thread in threads {
        refresh_thread(&tx, account, thread)?;
    }
    tx.commit()?;
    Ok(())
}

pub fn set_thread_label(
    conn: &mut Connection,
    thread: ThreadId,
    gmail_label_id: &str,
    present: bool,
) -> Result<()> {
    let (account, _) = thread_gmail_ref(conn, thread)?;
    let tx = conn.transaction()?;
    let label = label_id(&tx, account, gmail_label_id)?;
    if present {
        tx.execute(
            "INSERT OR IGNORE INTO message_labels (account_id, message_id, label_id)
             SELECT ?1, id, ?2 FROM messages WHERE thread_id = ?3",
            params![account, label, thread],
        )?;
    } else {
        tx.execute(
            "DELETE FROM message_labels WHERE label_id = ?1
             AND message_id IN (SELECT id FROM messages WHERE thread_id = ?2)",
            params![label, thread],
        )?;
    }
    refresh_thread(&tx, account, thread)?;
    tx.commit()?;
    Ok(())
}

/// Puts a label back exactly as a snapshot recorded it (undo after a failed action).
pub fn restore_label_snapshot(conn: &mut Connection, snapshot: &LabelSnapshot) -> Result<()> {
    let (account, _) = thread_gmail_ref(conn, snapshot.thread)?;
    let tx = conn.transaction()?;
    let label = label_id(&tx, account, &snapshot.gmail_label_id)?;
    tx.execute(
        "DELETE FROM message_labels WHERE label_id = ?1
         AND message_id IN (SELECT id FROM messages WHERE thread_id = ?2)",
        params![label, snapshot.thread],
    )?;
    for message in &snapshot.messages_with_label {
        tx.execute(
            "INSERT OR IGNORE INTO message_labels (account_id, message_id, label_id) VALUES (?1, ?2, ?3)",
            params![account, message, label],
        )?;
    }
    refresh_thread(&tx, account, snapshot.thread)?;
    tx.commit()?;
    Ok(())
}

// ---- Sync scope ----

/// Whether an account's cache has had its one-time attachment catch-up
/// (`sync::engine::ATTACHMENTS_VERSION`).
pub fn attachments_version(conn: &Connection, account: AccountId) -> Result<u32> {
    Ok(conn
        .query_row(
            "SELECT attachments_version FROM sync_state WHERE account_id = ?1",
            [account],
            |r| r.get(0),
        )
        .optional()?
        .unwrap_or(0))
}

pub fn set_attachments_version(conn: &Connection, account: AccountId, version: u32) -> Result<()> {
    conn.execute(
        "UPDATE sync_state SET attachments_version = ?2 WHERE account_id = ?1",
        params![account, version],
    )?;
    Ok(())
}

pub fn scope_version(conn: &Connection, account: AccountId) -> Result<u32> {
    Ok(conn
        .query_row(
            "SELECT scope_version FROM sync_state WHERE account_id = ?1",
            [account],
            |r| r.get(0),
        )
        .optional()?
        .unwrap_or(0))
}

pub fn set_scope_version(conn: &Connection, account: AccountId, version: u32) -> Result<()> {
    conn.execute(
        "UPDATE sync_state SET scope_version = ?2 WHERE account_id = ?1",
        params![account, version],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn original_colors_are_remembered_per_sender_whatever_the_case() {
        let db = crate::db::Db::open_in_memory().unwrap();
        let conn = db.conn();
        assert!(!sender_wants_original_colors(&conn, "news@key.example").unwrap());
        set_sender_original_colors(&conn, "News@key.example", true).unwrap();
        set_sender_original_colors(&conn, "news@key.example", true).unwrap();
        assert!(sender_wants_original_colors(&conn, "news@key.example").unwrap());
        assert!(!sender_wants_original_colors(&conn, "other@key.example").unwrap());
        set_sender_original_colors(&conn, "news@key.example", false).unwrap();
        assert!(!sender_wants_original_colors(&conn, "NEWS@key.example").unwrap());
    }
}
