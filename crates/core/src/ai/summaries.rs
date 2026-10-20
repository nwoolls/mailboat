//! Cached summaries, per conversation (and so per account: thread IDs are
//! surrogate IDs, and rows carry the thread's account).

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use specta::Type;

use super::AiProvider;
use crate::db::now_millis;
use crate::error::Result;
use crate::model::{MessageId, ThreadId};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum SummaryKind {
    /// One line, in the conversation list.
    Line,
    /// A few points, above the opened conversation.
    Full,
}

impl SummaryKind {
    fn as_str(self) -> &'static str {
        match self {
            SummaryKind::Line => "line",
            SummaryKind::Full => "full",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub thread_id: ThreadId,
    pub text: String,
    pub provider: AiProvider,
    pub created_at: i64,
}

/// The conversation's newest message that isn't a draft: a summary made
/// before it arrived is out of date.
pub fn newest_message(conn: &Connection, thread: ThreadId) -> Result<Option<MessageId>> {
    Ok(conn
        .query_row(
            "SELECT m.id FROM messages m WHERE m.thread_id = ?1
               AND NOT EXISTS (SELECT 1 FROM message_labels ml JOIN labels l ON l.id = ml.label_id
                               WHERE ml.message_id = m.id AND l.gmail_label_id = 'DRAFT')
             ORDER BY m.internal_date DESC, m.id DESC LIMIT 1",
            [thread],
            |r| r.get(0),
        )
        .optional()?)
}

/// The cached summary, if it still covers the newest message.
pub fn current(conn: &Connection, thread: ThreadId, kind: SummaryKind) -> Result<Option<Summary>> {
    let Some(newest) = newest_message(conn, thread)? else {
        return Ok(None);
    };
    Ok(conn
        .query_row(
            "SELECT text, provider, created_at FROM ai_summaries
             WHERE thread_id = ?1 AND kind = ?2 AND newest_message_id = ?3",
            params![thread, kind.as_str(), newest],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)?,
                ))
            },
        )
        .optional()?
        .and_then(|(text, provider, created_at)| {
            Some(Summary {
                thread_id: thread,
                text,
                provider: AiProvider::parse(&provider)?,
                created_at,
            })
        }))
}

/// Current one-line summaries for these conversations (those without one
/// are left out).
pub fn current_lines(conn: &Connection, threads: &[ThreadId]) -> Result<Vec<Summary>> {
    let mut out = Vec::new();
    for &t in threads {
        if let Some(s) = current(conn, t, SummaryKind::Line)? {
            out.push(s);
        }
    }
    Ok(out)
}

pub fn store(
    conn: &Connection,
    thread: ThreadId,
    kind: SummaryKind,
    provider: AiProvider,
    newest: MessageId,
    text: &str,
) -> Result<Summary> {
    let now = now_millis();
    conn.execute(
        "INSERT INTO ai_summaries (account_id, thread_id, kind, provider, newest_message_id, text, created_at)
         SELECT account_id, id, ?2, ?3, ?4, ?5, ?6 FROM threads WHERE id = ?1
         ON CONFLICT (account_id, thread_id, kind) DO UPDATE SET
           provider = excluded.provider, newest_message_id = excluded.newest_message_id,
           text = excluded.text, created_at = excluded.created_at",
        params![thread, kind.as_str(), provider.as_str(), newest, text, now],
    )?;
    Ok(Summary {
        thread_id: thread,
        text: text.to_string(),
        provider,
        created_at: now,
    })
}

/// Whether a conversation is in Spam or Trash: never summarized on its
/// own (spam is where emails written to steer a model live).
pub fn in_spam_or_trash(conn: &Connection, thread: ThreadId) -> Result<bool> {
    Ok(conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM thread_labels tl JOIN labels l ON l.id = tl.label_id
                        WHERE tl.thread_id = ?1 AND l.gmail_label_id IN ('SPAM', 'TRASH'))",
        [thread],
        |r| r.get(0),
    )?)
}

/// Removes every cached summary and suggestion (Settings → AI → Clear).
pub fn clear(conn: &Connection) -> Result<()> {
    conn.execute("DELETE FROM ai_summaries", [])?;
    conn.execute("DELETE FROM ai_reply_ideas", [])?;
    Ok(())
}

/// The writing assistant's saved chips for a conversation, if they still
/// cover its newest message.
pub fn current_ideas(
    conn: &Connection,
    thread: ThreadId,
    forward: bool,
) -> Result<Option<Vec<String>>> {
    let Some(newest) = newest_message(conn, thread)? else {
        return Ok(None);
    };
    let json: Option<String> = conn
        .query_row(
            "SELECT ideas FROM ai_reply_ideas
             WHERE thread_id = ?1 AND forward = ?2 AND newest_message_id = ?3",
            params![thread, forward, newest],
            |r| r.get(0),
        )
        .optional()?;
    Ok(json.and_then(|j| serde_json::from_str(&j).ok()))
}

pub fn store_ideas(
    conn: &Connection,
    thread: ThreadId,
    forward: bool,
    ideas: &[String],
) -> Result<()> {
    let Some(newest) = newest_message(conn, thread)? else {
        return Ok(());
    };
    conn.execute(
        "INSERT INTO ai_reply_ideas (account_id, thread_id, forward, newest_message_id, ideas, created_at)
         SELECT account_id, id, ?2, ?3, ?4, ?5 FROM threads WHERE id = ?1
         ON CONFLICT (account_id, thread_id, forward) DO UPDATE SET
           newest_message_id = excluded.newest_message_id, ideas = excluded.ideas,
           created_at = excluded.created_at",
        params![thread, forward, newest, serde_json::to_string(ideas)?, now_millis()],
    )?;
    Ok(())
}
