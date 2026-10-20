//! The AI features end to end: read the conversation (fetching bodies
//! that aren't cached, with the owning account's Gmail client), ask the
//! provider, cache the summary, record usage.

use serde::{Deserialize, Serialize};
use specta::Type;

use super::context::{thread_text, ThreadText};
use super::prompts::{self, ChatTurn, WritingContext};
use super::summaries::{self, Summary, SummaryKind};
use super::usage::{self, Purpose};
use super::{ask, AiProvider, Answer, Programs, Prompt, Quality};
use crate::db::Db;
use crate::error::{CoreError, Result};
use crate::gmail::GmailClient;
use crate::model::ThreadId;
use crate::sync::fetch_body;

/// Below this many characters of email, a conversation is short enough to
/// read at a glance, so the reader doesn't summarize it by itself.
pub const AUTO_SUMMARY_MIN_CHARS: usize = 700;

/// The conversation's text, with missing bodies fetched first. A body
/// that can't be fetched leaves its snippet standing in.
pub async fn read_thread(
    db: &Db,
    gmail: Option<&GmailClient>,
    thread: ThreadId,
) -> Result<ThreadText> {
    let text = thread_text(&db.conn(), thread)?;
    let Some(gmail) = gmail else {
        return Ok(text);
    };
    if text.missing_bodies.is_empty() {
        return Ok(text);
    }
    for &m in &text.missing_bodies {
        let _ = fetch_body(db, gmail, m).await;
    }
    thread_text(&db.conn(), thread)
}

/// Asks and records the request's usage (and failure) either way.
async fn ask_recorded(
    db: &Db,
    programs: &Programs,
    provider: AiProvider,
    purpose: Purpose,
    prompt: &Prompt,
    on_text: &(dyn Fn(&str) + Send + Sync),
) -> Result<Answer> {
    let result = ask(programs, provider, prompt, on_text).await;
    let (ok, used) = match &result {
        Ok(a) => (true, a.usage.clone()),
        Err(_) => (false, Default::default()),
    };
    usage::record(&db.conn(), provider, purpose, ok, &used)?;
    result
}

/// What a summary request came back with.
pub enum Summarized {
    Done(Summary, Answer),
    /// Automatic, and the conversation is short (or in Spam or Trash).
    NotNeeded,
}

#[derive(Debug, Clone, Copy)]
pub struct SummaryRequest {
    pub thread: ThreadId,
    pub kind: SummaryKind,
    /// Not asked for by the owner: skips short conversations, Spam and Trash.
    pub automatic: bool,
    /// Ask again even if the cached summary is current ("Summarize again").
    pub fresh: bool,
}

/// Summarizes a conversation, or returns the cached summary if it still
/// covers the newest message.
pub async fn summarize(
    db: &Db,
    gmail: Option<&GmailClient>,
    programs: &Programs,
    provider: AiProvider,
    request: SummaryRequest,
    on_text: &(dyn Fn(&str) + Send + Sync),
) -> Result<Summarized> {
    let SummaryRequest {
        thread,
        kind,
        automatic,
        fresh,
    } = request;
    if !fresh {
        let cached = summaries::current(&db.conn(), thread, kind)?;
        if let Some(s) = cached {
            return Ok(Summarized::Done(s, Answer::default()));
        }
    }
    if automatic && summaries::in_spam_or_trash(&db.conn(), thread)? {
        return Ok(Summarized::NotNeeded);
    }
    let text = read_thread(db, gmail, thread).await?;
    let Some(newest) = text.newest() else {
        return Ok(Summarized::NotNeeded);
    };
    if automatic && kind == SummaryKind::Full && text.length() < AUTO_SUMMARY_MIN_CHARS {
        return Ok(Summarized::NotNeeded);
    }
    let (prompt, purpose) = match kind {
        SummaryKind::Line => (prompts::list_line(&text, provider), Purpose::ListSummary),
        SummaryKind::Full => (prompts::thread_summary(&text, provider), Purpose::Summary),
    };
    let answer = ask_recorded(db, programs, provider, purpose, &prompt, on_text).await?;
    let clean = match kind {
        SummaryKind::Line => prompts::clean_line(&answer.text),
        SummaryKind::Full => answer.text.trim().to_string(),
    };
    let summary = summaries::store(&db.conn(), thread, kind, provider, newest, &clean)?;
    Ok(Summarized::Done(summary, answer))
}

/// What the writing assistant is asked, from the composer.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct WriteRequest {
    /// The conversation being answered; none for a new message.
    pub thread_id: Option<ThreadId>,
    /// "reply", "reply all", "forward" or "new message".
    pub kind: String,
    pub writer: String,
    pub to: String,
    pub subject: String,
    /// The editor's text now.
    pub draft: String,
    /// The chat so far, ending with the newest request.
    pub chat: Vec<ChatTurn>,
    /// A signature follows the text (so no name in the sign-off).
    pub has_signature: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct WriteAnswer {
    /// The email as the model wrote it (Markdown), for the chat and for
    /// asking again.
    pub text: String,
    /// The same as the composer's HTML (`format::markdown_to_html`).
    pub html: String,
    /// For new mail without a subject: the one the model suggested.
    pub subject: Option<String>,
}

pub async fn write(
    db: &Db,
    gmail: Option<&GmailClient>,
    programs: &Programs,
    provider: AiProvider,
    quality: Quality,
    request: &WriteRequest,
    on_text: &(dyn Fn(&str) + Send + Sync),
) -> Result<(WriteAnswer, Answer)> {
    let thread = match request.thread_id {
        Some(t) => Some(read_thread(db, gmail, t).await?),
        None => None,
    };
    let new_message = thread.is_none();
    let ctx = WritingContext {
        thread,
        writer: request.writer.clone(),
        kind: request.kind.clone(),
        to: request.to.clone(),
        subject: request.subject.clone(),
        draft: request.draft.clone(),
        has_signature: request.has_signature,
    };
    let prompt = Prompt {
        quality,
        ..prompts::write(&ctx, &request.chat, provider)
    };
    // New mail may lead with "Subject:"; the chat shouldn't show it as text.
    let shown = |t: &str| {
        let body = if new_message {
            prompts::split_subject(t).1
        } else {
            t.trim().to_string()
        };
        on_text(&body)
    };
    let answer = ask_recorded(db, programs, provider, Purpose::Writing, &prompt, &shown).await?;
    let (subject, text) = if new_message && request.subject.trim().is_empty() {
        prompts::split_subject(&answer.text)
    } else {
        (None, prompts::split_subject(&answer.text).1)
    };
    if text.is_empty() {
        return Err(CoreError::Ai(
            "The AI didn't write anything; try asking differently.".into(),
        ));
    }
    let html = super::format::markdown_to_html(&text);
    Ok((
        WriteAnswer {
            text,
            html,
            subject,
        },
        answer,
    ))
}

/// Suggestions for the writing assistant's chips, from the conversation
/// being answered (or forwarded).
pub async fn reply_ideas(
    db: &Db,
    gmail: Option<&GmailClient>,
    programs: &Programs,
    provider: AiProvider,
    thread: ThreadId,
    forward: bool,
) -> Result<(Vec<String>, Answer)> {
    let text = read_thread(db, gmail, thread).await?;
    let prompt = prompts::reply_ideas(&text, forward, provider);
    let answer = ask_recorded(
        db,
        programs,
        provider,
        Purpose::ReplyIdeas,
        &prompt,
        &|_| {},
    )
    .await?;
    Ok((prompts::parse_ideas(&answer.text), answer))
}
