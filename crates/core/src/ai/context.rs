//! A conversation as plain text for a model: who wrote what, newest
//! messages kept whole, quoted history cut (every reply repeats the ones
//! before it), all within a size the provider can read.
//!
//! Read from the cache only; `missing_bodies` says which messages need
//! their body fetched first (the caller does that with the owning
//! account's Gmail client, then reads again).

use rusqlite::{params, Connection};

use crate::db::store::PARTS_VERSION;
use crate::error::Result;
use crate::gmail::parse::html_to_text;
use crate::model::{Address, MessageId, ThreadId};

use super::AiProvider;

/// How many characters of email a provider gets. Apple's on-device model
/// reads about 4,000 tokens in all (instructions and answer included), so
/// it gets roughly 1,700 tokens' worth; the others read far more.
pub fn budget(provider: AiProvider) -> usize {
    match provider {
        AiProvider::Apple => 7_000,
        AiProvider::Claude | AiProvider::ChatGpt => 80_000,
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ContextMessage {
    pub id: MessageId,
    pub from: Address,
    pub to: Vec<Address>,
    pub date: i64,
    /// Written by the account's owner (any of their addresses).
    pub mine: bool,
    /// The new part of the message: quoted history and signatures' "--"
    /// tails removed.
    pub text: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ThreadText {
    pub subject: String,
    /// Oldest first; drafts left out.
    pub messages: Vec<ContextMessage>,
    /// Messages whose body isn't cached (their snippet stands in).
    pub missing_bodies: Vec<MessageId>,
}

impl ThreadText {
    pub fn newest(&self) -> Option<MessageId> {
        self.messages.last().map(|m| m.id)
    }

    /// Characters of email text in the conversation (to decide whether
    /// it's long enough to be worth summarizing).
    pub fn length(&self) -> usize {
        self.messages.iter().map(|m| m.text.len()).sum()
    }
}

/// The conversation's messages from the cache.
pub fn thread_text(conn: &Connection, thread: ThreadId) -> Result<ThreadText> {
    let (account, subject): (i64, String) = conn.query_row(
        "SELECT account_id, subject FROM threads WHERE id = ?1",
        [thread],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let mut mine: Vec<String> = conn
        .prepare("SELECT lower(email) FROM send_as WHERE account_id = ?1")?
        .query_map([account], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    mine.push(conn.query_row(
        "SELECT lower(email) FROM accounts WHERE id = ?1",
        [account],
        |r| r.get(0),
    )?);
    let mut stmt = conn.prepare(
        "SELECT m.id, m.from_name, m.from_email, m.to_json, m.internal_date, m.snippet,
                b.text, b.html, b.message_id IS NOT NULL AND b.parts_version >= ?2
         FROM messages m
         LEFT JOIN message_bodies b ON b.message_id = m.id
         WHERE m.thread_id = ?1
           AND NOT EXISTS (SELECT 1 FROM message_labels ml JOIN labels l ON l.id = ml.label_id
                           WHERE ml.message_id = m.id AND l.gmail_label_id = 'DRAFT')
         ORDER BY m.internal_date, m.id",
    )?;
    let rows = stmt.query_map(params![thread, PARTS_VERSION], |r| {
        Ok((
            r.get::<_, MessageId>(0)?,
            Address {
                name: r.get(1)?,
                email: r.get(2)?,
            },
            r.get::<_, String>(3)?,
            r.get::<_, i64>(4)?,
            r.get::<_, String>(5)?,
            r.get::<_, Option<String>>(6)?,
            r.get::<_, Option<String>>(7)?,
            r.get::<_, bool>(8)?,
        ))
    })?;
    let mut messages = Vec::new();
    let mut missing_bodies = Vec::new();
    for row in rows {
        let (id, from, to_json, date, snippet, text, html, has_body) = row?;
        let body = match (has_body, text, html) {
            (true, Some(t), _) if !t.trim().is_empty() => t,
            (true, _, Some(h)) => html_to_text(&h),
            _ => {
                missing_bodies.push(id);
                snippet
            }
        };
        messages.push(ContextMessage {
            id,
            mine: mine.contains(&from.email.to_lowercase()),
            from,
            to: serde_json::from_str(&to_json).unwrap_or_default(),
            date,
            text: new_part(&body),
        });
    }
    Ok(ThreadText {
        subject,
        messages,
        missing_bodies,
    })
}

/// The part of a message its writer added: stops at the quoted history
/// ("On … wrote:", Outlook's "From: … Sent:" block, "-----Original
/// Message-----", "> " lines) and at a signature's "-- " line.
pub fn new_part(text: &str) -> String {
    let lines: Vec<&str> = text.lines().collect();
    let mut out: Vec<&str> = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        let t = line.trim();
        let next = lines.get(i + 1).map(|l| l.trim()).unwrap_or_default();
        let quote_header = (t.starts_with("On ")
            && (t.ends_with("wrote:") || next.ends_with("wrote:")))
            || t.starts_with("-----Original Message-----")
            || t.starts_with("---------- Forwarded message")
            || (t.starts_with("From:")
                && lines
                    .iter()
                    .skip(i + 1)
                    .take(4)
                    .any(|l| l.trim().starts_with("Sent:")))
            || t == "--"
            || t == "-- ";
        if quote_header {
            break;
        }
        if t.starts_with('>') {
            continue;
        }
        out.push(line.trim_end());
    }
    collapse_blank_lines(&out.join("\n"))
}

fn collapse_blank_lines(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut blank = 0;
    for line in s.lines() {
        if line.trim().is_empty() {
            blank += 1;
            if blank > 1 {
                continue;
            }
        } else {
            blank = 0;
        }
        out.push_str(line);
        out.push('\n');
    }
    out.trim().to_string()
}

fn person(a: &Address, mine: bool) -> String {
    let who = match &a.name {
        Some(n) if !n.trim().is_empty() => format!("{} <{}>", n.trim(), a.email),
        _ => a.email.clone(),
    };
    if mine {
        format!("{who} (me)")
    } else {
        who
    }
}

/// Formats a date as UTC "2026-10-20 14:05" (models don't need the zone).
fn when(millis: i64) -> String {
    chrono::DateTime::from_timestamp_millis(millis)
        .map(|d| d.format("%Y-%m-%d %H:%M UTC").to_string())
        .unwrap_or_default()
}

/// The conversation as text within `budget` characters. The newest
/// message gets the most room; older ones are shortened, then left out
/// (oldest first), with a note saying how many. In a conversation, the
/// newest is marked as such: Apple's small model summarized a one-line
/// "Sounds good." as if the long email before it were still where things
/// stood.
pub fn render(thread: &ThreadText, budget: usize) -> String {
    let mut parts: Vec<String> = Vec::new();
    let mut left = budget.saturating_sub(thread.subject.len() + 20);
    let mut dropped = 0;
    for (n, m) in thread.messages.iter().rev().enumerate() {
        let newest = n == 0 && thread.messages.len() > 1;
        let header = format!(
            "{}From: {}\nTo: {}\nDate: {}\n\n",
            if newest { "Newest message:\n" } else { "" },
            person(&m.from, m.mine),
            m.to.iter()
                .map(|a| person(a, false))
                .collect::<Vec<_>>()
                .join(", "),
            when(m.date)
        );
        // The newest may take most of the room; each older one a share.
        let cap = if n == 0 {
            left * 7 / 10
        } else {
            left.min(3_000)
        };
        if left < header.len() + 80 {
            dropped = thread.messages.len() - n;
            break;
        }
        let room = cap.saturating_sub(header.len()).max(80);
        let body = shorten(&m.text, room);
        left = left.saturating_sub(header.len() + body.len() + 8);
        parts.push(format!("{header}{body}"));
    }
    parts.reverse();
    let mut out = format!("Subject: {}\n\n", thread.subject);
    if dropped > 0 {
        out.push_str(&format!("({dropped} earlier messages left out.)\n\n"));
    }
    out.push_str(&parts.join("\n\n---\n\n"));
    out
}

/// At most `max` characters, cut at a word, with "…" when cut.
pub fn shorten(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let keep = max.saturating_sub(1);
    let cut: String = text.chars().take(keep).collect();
    // Ends on a whole word already when the next character is a space.
    let whole = text.chars().nth(keep).is_some_and(char::is_whitespace);
    let at = if whole {
        cut.len()
    } else {
        cut.rfind(char::is_whitespace).unwrap_or(cut.len())
    };
    format!("{}…", cut[..at].trim_end())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quoted_history_and_signatures_are_cut() {
        let text = "Sounds good, see you then.\n\nSam\n\nOn Mon, Oct 19, 2026 at 9:00 AM Jordan <n@x.example> wrote:\n> Thursday?\n> Jordan";
        assert_eq!(new_part(text), "Sounds good, see you then.\n\nSam");
        let wrapped =
            "Yes.\n\nOn Mon, Oct 19, 2026 at 9:00 AM Jordan Lee\n<n@x.example> wrote:\n> old";
        assert_eq!(new_part(wrapped), "Yes.");
        let outlook =
            "Fine by me.\n\nFrom: Pat <p@x.example>\nSent: Monday\nTo: Sam\nSubject: Re: x\n\nold";
        assert_eq!(new_part(outlook), "Fine by me.");
        let sig = "Thanks!\n-- \nSam Smith\nAcme";
        assert_eq!(new_part(sig), "Thanks!");
        assert_eq!(new_part("a\n> b\nc"), "a\nc");
    }

    fn msg(id: i64, text: &str) -> ContextMessage {
        ContextMessage {
            id: MessageId(id),
            from: Address {
                name: Some("Sam".into()),
                email: "sam@x.example".into(),
            },
            to: vec![Address {
                name: None,
                email: "n@x.example".into(),
            }],
            date: 1_792_000_000_000,
            mine: id % 2 == 0,
            text: text.into(),
        }
    }

    #[test]
    fn renders_oldest_first_with_people_and_marks_me() {
        let t = ThreadText {
            subject: "Lunch".into(),
            messages: vec![msg(1, "Lunch Thursday?"), msg(2, "Yes, noon.")],
            missing_bodies: vec![],
        };
        let out = render(&t, 10_000);
        assert!(out.starts_with("Subject: Lunch"));
        let first = out.find("Lunch Thursday?").unwrap();
        let second = out.find("Yes, noon.").unwrap();
        assert!(first < second);
        assert!(out.contains("Sam <sam@x.example> (me)"), "{out}");
        assert!(out.contains("Date: 2026-"));
        // The newest is marked, and only it.
        assert_eq!(out.matches("Newest message:").count(), 1);
        assert!(out.find("Newest message:").unwrap() > first);
        assert!(out.find("Newest message:").unwrap() < second);
        let alone = ThreadText {
            messages: vec![msg(1, "Lunch Thursday?")],
            ..t
        };
        assert!(!render(&alone, 10_000).contains("Newest message:"));
    }

    #[test]
    fn a_small_budget_keeps_the_newest_and_says_what_was_left_out() {
        let long = "word ".repeat(2_000);
        let t = ThreadText {
            subject: "Long".into(),
            messages: (1..=6).map(|i| msg(i, &format!("{i} {long}"))).collect(),
            missing_bodies: vec![],
        };
        let out = render(&t, 7_000);
        assert!(out.len() <= 7_400, "{}", out.len());
        assert!(out.contains("6 word"), "the newest is kept");
        assert!(out.contains("earlier messages left out"));
    }

    #[test]
    fn shorten_cuts_at_a_word() {
        assert_eq!(shorten("hello world again", 12), "hello world…");
        assert_eq!(shorten("short", 12), "short");
    }
}
