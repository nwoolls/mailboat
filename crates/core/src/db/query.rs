//! The single query layer behind every list view. A unified view (All
//! Inboxes) and a single-account view are the same query with a different
//! `AccountFilter`.

use rusqlite::types::Value;
use rusqlite::{params_from_iter, Connection, OptionalExtension, Row};

use super::placeholders;
use crate::error::{CoreError, Result};
use crate::model::{
    AccountFilter, Address, Label, LabelId, LabelKind, LabelUnread, ListCursor, ListQuery,
    MailView, MessageMeta, SystemLabel, ThreadDetail, ThreadId, ThreadPage, ThreadSummary,
};

const MAX_LIMIT: u32 = 500;

/// How a search's text is stored with Gmail's hits for it.
pub fn search_key(text: &str) -> String {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// The thread has at least one message that isn't in Spam or Trash, which is
/// what puts a conversation in Gmail's All Mail.
const IN_ALL_MAIL: &str =
    "EXISTS (SELECT 1 FROM messages m WHERE m.thread_id = t.id AND NOT EXISTS (
    SELECT 1 FROM message_labels ml JOIN labels l ON l.id = ml.label_id
    WHERE ml.message_id = m.id AND l.kind = 'system' AND l.gmail_label_id IN ('SPAM', 'TRASH')))";

const IN_INBOX: &str = "EXISTS (SELECT 1 FROM thread_labels tl JOIN labels l ON l.id = tl.label_id
    WHERE tl.thread_id = t.id AND l.kind = 'system' AND l.gmail_label_id = 'INBOX')";

const THREAD_COLUMNS: &str =
    "t.id, t.account_id, t.subject, t.snippet, t.senders_json, t.last_message_at,
  t.message_count, t.unread_count > 0,
  EXISTS (SELECT 1 FROM thread_labels tl JOIN labels l ON l.id = tl.label_id
          WHERE tl.thread_id = t.id AND l.gmail_label_id = 'STARRED'),
  t.has_attachments,
  EXISTS (SELECT 1 FROM thread_labels tl JOIN labels l ON l.id = tl.label_id
          WHERE tl.thread_id = t.id AND l.gmail_label_id = 'INBOX'),
  NOT EXISTS (SELECT 1 FROM messages m WHERE m.thread_id = t.id AND NOT EXISTS (
    SELECT 1 FROM message_labels ml JOIN labels l ON l.id = ml.label_id
    WHERE ml.message_id = m.id AND l.gmail_label_id = 'TRASH')),
  (SELECT group_concat(tl.label_id) FROM thread_labels tl JOIN labels l ON l.id = tl.label_id
   WHERE tl.thread_id = t.id AND l.kind = 'user'),
  EXISTS (SELECT 1 FROM thread_labels tl JOIN labels l ON l.id = tl.label_id
          WHERE tl.thread_id = t.id AND l.gmail_label_id = 'DRAFT')
  AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.thread_id = t.id AND NOT EXISTS (
    SELECT 1 FROM message_labels ml JOIN labels l ON l.id = ml.label_id
    WHERE ml.message_id = m.id AND l.gmail_label_id = 'DRAFT')),
  EXISTS (SELECT 1 FROM thread_labels tl JOIN labels l ON l.id = tl.label_id
          WHERE tl.thread_id = t.id AND l.gmail_label_id = 'SPAM')";

/// How long a sign-in code is worth showing on its row: codes expire in
/// minutes, so an old one is only noise.
const CODE_SHOWN_FOR_MS: i64 = 24 * 60 * 60 * 1000;

fn thread_from_row(row: &Row<'_>) -> rusqlite::Result<ThreadSummary> {
    let senders: String = row.get(4)?;
    let subject: String = row.get(2)?;
    let snippet: String = row.get(3)?;
    let last_message_at: i64 = row.get(5)?;
    let in_spam: bool = row.get(14)?;
    // From the subject and Gmail's snippet (the body may not be downloaded
    // yet); never in Spam, where codes are bait.
    let sign_in_code = (!in_spam && crate::db::now_millis() - last_message_at < CODE_SHOWN_FOR_MS)
        .then(|| crate::mail::codes::find(&subject, &snippet))
        .flatten();
    Ok(ThreadSummary {
        id: row.get(0)?,
        account_id: row.get(1)?,
        subject,
        snippet,
        senders: serde_json::from_str(&senders).unwrap_or_default(),
        last_message_at,
        message_count: row.get(6)?,
        unread: row.get(7)?,
        starred: row.get(8)?,
        has_attachments: row.get(9)?,
        in_inbox: row.get(10)?,
        in_trash: row.get(11)?,
        label_ids: row
            .get::<_, Option<String>>(12)?
            .unwrap_or_default()
            .split(',')
            .filter_map(|id| id.parse().ok().map(LabelId))
            .collect(),
        only_draft: row.get(13)?,
        in_spam,
        sign_in_code,
    })
}

/// Lists threads for any view across any set of accounts, newest first,
/// with keyset paging.
pub fn list_threads(conn: &Connection, query: &ListQuery) -> Result<ThreadPage> {
    let limit = query.limit.clamp(1, MAX_LIMIT);
    let mut clauses: Vec<String> = Vec::new();
    let mut values: Vec<Value> = Vec::new();

    match &query.accounts {
        AccountFilter::All => {}
        AccountFilter::Only(ids) if ids.is_empty() => {
            return Ok(ThreadPage {
                threads: vec![],
                next_cursor: None,
            })
        }
        AccountFilter::Only(ids) => {
            clauses.push(format!("t.account_id IN ({})", placeholders(ids.len())));
            values.extend(ids.iter().map(|id| Value::Integer(id.0)));
        }
    }

    match &query.view {
        MailView::System { label } => {
            // Matches the system label in every account: this is what makes
            // INBOX/STARRED/... unified views.
            clauses.push(
                "EXISTS (SELECT 1 FROM thread_labels tl JOIN labels l ON l.id = tl.label_id
                         WHERE tl.thread_id = t.id AND l.kind = 'system' AND l.gmail_label_id = ?)"
                    .into(),
            );
            values.push(Value::Text(label.gmail_id().into()));
            // As in Gmail, every view but Spam and Trash leaves out
            // conversations that are wholly in Spam or Trash (a trashed
            // thread can keep its INBOX label).
            if !matches!(label, SystemLabel::Spam | SystemLabel::Trash) {
                clauses.push(IN_ALL_MAIL.into());
            }
        }
        MailView::UserLabel { label_id } => {
            // A user label row belongs to one account, so this can never
            // match another account's same-named label.
            clauses.push("EXISTS (SELECT 1 FROM thread_labels tl WHERE tl.thread_id = t.id AND tl.label_id = ?)".into());
            values.push(Value::Integer(label_id.0));
            clauses.push(IN_ALL_MAIL.into());
        }
        MailView::AllMail => clauses.push(IN_ALL_MAIL.into()),
        MailView::Archive => {
            clauses.push(IN_ALL_MAIL.into());
            clauses.push(format!("NOT {IN_INBOX}"));
        }
        MailView::Search {
            text,
            with_spam_trash,
        } => {
            if !with_spam_trash {
                clauses.push(IN_ALL_MAIL.into());
            }
            // Matches in the cache, plus what Gmail's own search found for
            // the same text (`search_hits`, filled when Gmail is asked).
            let hits = "t.id IN (SELECT h.thread_id FROM search_hits h WHERE h.query = ?)";
            match fts_query(text) {
                Some(fts) => {
                    clauses.push(format!(
                        "(t.id IN (SELECT m.thread_id FROM messages_fts f JOIN messages m ON m.id = f.rowid
                                   WHERE messages_fts MATCH ?) OR {hits})"
                    ));
                    values.push(Value::Text(fts));
                }
                None => clauses.push(hits.into()),
            }
            values.push(Value::Text(search_key(text)));
        }
    }

    if let Some(cursor) = &query.cursor {
        clauses.push("(t.last_message_at < ? OR (t.last_message_at = ? AND t.id < ?))".into());
        values.push(Value::Integer(cursor.last_message_at));
        values.push(Value::Integer(cursor.last_message_at));
        values.push(Value::Integer(cursor.thread_id.0));
    }

    let where_sql = if clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", clauses.join(" AND "))
    };
    // Fetch one extra row to know whether another page exists.
    let sql = format!(
        "SELECT {THREAD_COLUMNS} FROM threads t {where_sql}
         ORDER BY t.last_message_at DESC, t.id DESC LIMIT {}",
        limit + 1
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut threads: Vec<ThreadSummary> = stmt
        .query_map(params_from_iter(values), thread_from_row)?
        .collect::<rusqlite::Result<_>>()?;

    let next_cursor = if threads.len() > limit as usize {
        threads.truncate(limit as usize);
        threads.last().map(|t| ListCursor {
            last_message_at: t.last_message_at,
            thread_id: t.id,
        })
    } else {
        None
    };
    Ok(ThreadPage {
        threads,
        next_cursor,
    })
}

/// Turns user input into a safe FTS5 query: every word must match, as a
/// prefix. Quotes are escaped so input can never be parsed as FTS syntax.
fn fts_query(text: &str) -> Option<String> {
    let terms: Vec<String> = text
        .split_whitespace()
        .map(|w| format!("\"{}\"*", w.replace('"', "\"\"")))
        .collect();
    if terms.is_empty() {
        None
    } else {
        Some(terms.join(" "))
    }
}

/// Whether a conversation is in All Mail: at least one of its messages
/// is outside Spam and Trash.
pub fn in_all_mail(conn: &Connection, id: ThreadId) -> Result<bool> {
    Ok(conn
        .query_row(
            &format!("SELECT {IN_ALL_MAIL} FROM threads t WHERE t.id = ?1"),
            [id],
            |r| r.get(0),
        )
        .optional()?
        .unwrap_or(false))
}

pub fn thread_summary(conn: &Connection, id: ThreadId) -> Result<ThreadSummary> {
    conn.query_row(
        &format!("SELECT {THREAD_COLUMNS} FROM threads t WHERE t.id = ?1"),
        [id],
        thread_from_row,
    )
    .optional()?
    .ok_or_else(|| CoreError::NotFound(format!("thread {}", id.0)))
}

/// A thread with its messages (oldest first) and user labels. Messages come
/// only from this thread row, which belongs to exactly one account.
pub fn thread_detail(conn: &Connection, id: ThreadId) -> Result<ThreadDetail> {
    let thread = thread_summary(conn, id)?;
    let mut stmt = conn.prepare(
        "SELECT m.id, m.account_id, m.thread_id, m.from_name, m.from_email, m.to_json, m.cc_json,
           m.subject, m.snippet, m.internal_date, m.has_attachments,
           EXISTS (SELECT 1 FROM message_labels ml JOIN labels l ON l.id = ml.label_id
                   WHERE ml.message_id = m.id AND l.gmail_label_id = 'UNREAD'),
           EXISTS (SELECT 1 FROM message_labels ml JOIN labels l ON l.id = ml.label_id
                   WHERE ml.message_id = m.id AND l.gmail_label_id = 'STARRED'),
           EXISTS (SELECT 1 FROM message_labels ml JOIN labels l ON l.id = ml.label_id
                   WHERE ml.message_id = m.id AND l.gmail_label_id = 'DRAFT')
         FROM messages m WHERE m.thread_id = ?1 ORDER BY m.internal_date, m.id",
    )?;
    let messages = stmt
        .query_map([id], |r| {
            let to: String = r.get(5)?;
            let cc: String = r.get(6)?;
            Ok(MessageMeta {
                id: r.get(0)?,
                account_id: r.get(1)?,
                thread_id: r.get(2)?,
                from: Address {
                    name: r.get(3)?,
                    email: r.get(4)?,
                },
                to: serde_json::from_str(&to).unwrap_or_default(),
                cc: serde_json::from_str(&cc).unwrap_or_default(),
                subject: r.get(7)?,
                snippet: r.get(8)?,
                internal_date: r.get(9)?,
                has_attachments: r.get(10)?,
                unread: r.get(11)?,
                starred: r.get(12)?,
                draft: r.get(13)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;

    let mut stmt = conn.prepare(
        "SELECT l.id, l.account_id, l.gmail_label_id, l.name, l.kind, l.color_bg, l.color_fg
         FROM thread_labels tl JOIN labels l ON l.id = tl.label_id
         WHERE tl.thread_id = ?1 AND l.kind = 'user' ORDER BY l.name",
    )?;
    let labels = stmt
        .query_map([id], label_from_row)?
        .collect::<rusqlite::Result<_>>()?;

    Ok(ThreadDetail {
        thread,
        messages,
        labels,
    })
}

fn label_from_row(r: &Row<'_>) -> rusqlite::Result<Label> {
    Ok(Label {
        id: r.get(0)?,
        account_id: r.get(1)?,
        gmail_label_id: r.get(2)?,
        name: r.get(3)?,
        kind: LabelKind::parse(&r.get::<_, String>(4)?),
        color_bg: r.get(5)?,
        color_fg: r.get(6)?,
    })
}

/// User labels for the sidebar, grouped by account (never merged by name).
pub fn user_labels(conn: &Connection, accounts: &AccountFilter) -> Result<Vec<Label>> {
    let (filter, values): (String, Vec<Value>) = match accounts {
        AccountFilter::All => (String::new(), vec![]),
        AccountFilter::Only(ids) => (
            format!("AND account_id IN ({})", placeholders(ids.len().max(1))),
            if ids.is_empty() {
                vec![Value::Integer(-1)]
            } else {
                ids.iter().map(|i| Value::Integer(i.0)).collect()
            },
        ),
    };
    let sql = format!(
        "SELECT id, account_id, gmail_label_id, name, kind, color_bg, color_fg
         FROM labels WHERE kind = 'user' {filter} ORDER BY account_id, name COLLATE NOCASE"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(values), label_from_row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Unread conversations per label, for sidebar counts. A label's count is
/// per account; unified counts (All Inboxes) are sums of these. Like the
/// views, every label but Spam and Trash leaves out trashed and spam
/// conversations. Drafts is the exception: its count is how many drafts
/// are saved (as Gmail shows it), unread or not, leaving out trashed ones.
pub fn unread_counts(conn: &Connection, accounts: &AccountFilter) -> Result<Vec<LabelUnread>> {
    let (filter, values): (String, Vec<Value>) = match accounts {
        AccountFilter::All => (String::new(), vec![]),
        AccountFilter::Only(ids) => (
            format!("AND l.account_id IN ({})", placeholders(ids.len().max(1))),
            if ids.is_empty() {
                vec![Value::Integer(-1)]
            } else {
                ids.iter().map(|i| Value::Integer(i.0)).collect()
            },
        ),
    };
    // The filter's values are bound once per half of the query.
    let values: Vec<Value> = values.iter().chain(values.iter()).cloned().collect();
    let sql = format!(
        "SELECT * FROM (
           SELECT l.id, l.account_id, l.gmail_label_id, COUNT(*)
           FROM labels l
           JOIN thread_labels tl ON tl.label_id = l.id AND tl.account_id = l.account_id
           JOIN threads t ON t.id = tl.thread_id AND t.account_id = l.account_id
           WHERE t.unread_count > 0 {filter}
             AND NOT (l.kind = 'system' AND l.gmail_label_id = 'DRAFT')
             AND (l.gmail_label_id IN ('SPAM', 'TRASH') OR {IN_ALL_MAIL})
           GROUP BY l.id
           UNION ALL
           SELECT l.id, l.account_id, l.gmail_label_id, COUNT(*)
           FROM labels l
           JOIN message_labels ml ON ml.label_id = l.id AND ml.account_id = l.account_id
           WHERE l.kind = 'system' AND l.gmail_label_id = 'DRAFT' {filter}
             AND NOT EXISTS (SELECT 1 FROM message_labels mt JOIN labels lt ON lt.id = mt.label_id
                             WHERE mt.message_id = ml.message_id AND lt.gmail_label_id = 'TRASH')
           GROUP BY l.id
         ) ORDER BY 2, 1"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(values), |r| {
        Ok(LabelUnread {
            label_id: r.get(0)?,
            account_id: r.get(1)?,
            gmail_label_id: r.get(2)?,
            unread: r.get(3)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Unread conversations across every account, for the Dock badge: in an
/// Inbox, or anywhere (Spam and Trash left out either way). Same rules as
/// the sidebar's counts, so All Inboxes and the badge agree.
pub fn unread_threads(conn: &Connection, inbox_only: bool) -> Result<u32> {
    let inbox = if inbox_only {
        format!("AND {IN_INBOX}")
    } else {
        String::new()
    };
    let sql = format!(
        "SELECT COUNT(*) FROM threads t WHERE t.unread_count > 0 {inbox} AND {IN_ALL_MAIL}"
    );
    Ok(conn.query_row(&sql, [], |r| r.get(0))?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fts_query_escapes_user_input() {
        assert_eq!(fts_query("  "), None);
        assert_eq!(fts_query("hello wor").unwrap(), "\"hello\"* \"wor\"*");
        assert_eq!(fts_query("a\"b OR").unwrap(), "\"a\"\"b\"* \"OR\"*");
    }
}
