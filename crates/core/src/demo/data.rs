//! The made-up mail, read from `demo/mail.json` at the top of the
//! repository (shared with anything else that needs made-up mail), and
//! turned into real RFC 5322 messages dated relative to now.

use std::collections::HashMap;

use chrono::{Local, TimeZone};
use mail_builder::headers::address::Address as MimeAddress;
use mail_builder::MessageBuilder;
use serde::Deserialize;

use crate::error::{CoreError, Result};

const BUILTIN: &str = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../demo/mail.json"));

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DemoData {
    /// Everyone who writes, by a short key (`"maya"`). `"me"` is the
    /// account itself.
    pub people: HashMap<String, Person>,
    pub accounts: Vec<AccountData>,
    /// What someone answers to mail that has no reply of its own.
    #[serde(default)]
    pub default_reply: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Person {
    pub name: String,
    pub email: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountData {
    pub email: String,
    pub name: String,
    #[serde(default)]
    pub color: Option<String>,
    /// HTML, as Gmail keeps it.
    #[serde(default)]
    pub signature: Option<String>,
    #[serde(default)]
    pub labels: Vec<LabelData>,
    /// Saved contacts, by person key.
    #[serde(default)]
    pub contacts: Vec<String>,
    #[serde(default)]
    pub conversations: Vec<Conversation>,
    /// Gmail filters the account starts with (what the app calls rules).
    #[serde(default)]
    pub rules: Vec<RuleData>,
    /// The vacation reply the account starts with.
    #[serde(default)]
    pub vacation: Option<VacationData>,
}

/// A filter, written the way the app shows a rule: what it matches, then
/// what it does. Labels are named (they must exist on the account).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleData {
    #[serde(default)]
    pub from: Option<String>,
    #[serde(default)]
    pub to: Option<String>,
    #[serde(default)]
    pub subject: Option<String>,
    /// "Has the words": a Gmail search.
    #[serde(default)]
    pub query: Option<String>,
    #[serde(default)]
    pub has_attachment: bool,
    /// Labels to add (user labels by name, or STARRED, IMPORTANT).
    #[serde(default)]
    pub add_labels: Vec<String>,
    /// Skip the inbox.
    #[serde(default)]
    pub archive: bool,
    /// Mark as read.
    #[serde(default)]
    pub mark_read: bool,
}

/// A vacation reply, with its days counted from today.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VacationData {
    pub subject: String,
    pub body: String,
    #[serde(default)]
    pub restrict_to_contacts: bool,
    /// Days from now (negative: it already started).
    pub starts_in_days: i64,
    pub ends_in_days: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LabelData {
    pub name: String,
    /// Gmail's label colors (`#a4c2f4`-style background, text).
    #[serde(default)]
    pub background: Option<String>,
    #[serde(default)]
    pub text: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    /// Gmail label IDs (`INBOX`, `STARRED`, `IMPORTANT`, `SPAM`, `TRASH`)
    /// and user labels by name. Messages you wrote get `SENT` instead of
    /// `INBOX`; `STARRED` goes on the newest message.
    #[serde(default)]
    pub labels: Vec<String>,
    /// The one-line summary shown in the list.
    #[serde(default)]
    pub summary: Option<String>,
    /// The points of the summary above the opened conversation. Short
    /// conversations get none by themselves, so the demo brings its own.
    #[serde(default)]
    pub brief: Vec<String>,
    /// What the other person answers when you reply.
    #[serde(default)]
    pub reply: Option<String>,
    /// Arrives this long after the demo starts, instead of being there
    /// from the start (a sign-in code arriving, say).
    #[serde(default)]
    pub arrive_after_seconds: Option<u64>,
    pub messages: Vec<MessageData>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageData {
    pub from: String,
    /// Defaults to you, or for mail you wrote, the other person.
    #[serde(default)]
    pub to: Option<Vec<String>>,
    #[serde(default)]
    pub cc: Vec<String>,
    /// How long ago it was sent: `"25m"`, `"3h"`, `"2d"`, `"1w"`.
    #[serde(default = "just_now")]
    pub ago: String,
    /// Defaults to the conversation's first subject, with "Re: ".
    #[serde(default)]
    pub subject: Option<String>,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub html: Option<String>,
    #[serde(default)]
    pub unread: bool,
    /// A draft you haven't sent.
    #[serde(default)]
    pub draft: bool,
    #[serde(default)]
    pub attachments: Vec<AttachmentData>,
}

fn just_now() -> String {
    "0m".into()
}

#[derive(Debug, Clone, Deserialize)]
pub struct AttachmentData {
    pub name: String,
    #[serde(rename = "type")]
    pub mime_type: String,
    /// The file's content, as text. `{{ics:+1d 10:00}}` becomes that local
    /// time as a calendar's UTC time (tomorrow at 10:00).
    pub text: String,
}

impl DemoData {
    /// The made-up mail that ships with the app.
    pub fn builtin() -> Self {
        // Checked by a test, so this can't fail in a build that passed.
        serde_json::from_str(BUILTIN).expect("demo/mail.json is valid")
    }

    pub fn person(&self, key: &str, account: &AccountData) -> Result<Person> {
        if key == "me" {
            return Ok(Person {
                name: account.name.clone(),
                email: account.email.clone(),
            });
        }
        self.people
            .get(key)
            .cloned()
            .ok_or_else(|| CoreError::Invalid(format!("demo mail: nobody called \"{key}\"")))
    }
}

/// `"25m"` → milliseconds.
pub fn ago_ms(ago: &str) -> Result<u64> {
    let bad = || CoreError::Invalid(format!("demo mail: \"{ago}\" isn't like 25m, 3h or 2d"));
    let unit: u64 = match ago.chars().last().ok_or_else(bad)? {
        'm' => 60_000,
        'h' => 3_600_000,
        'd' => 86_400_000,
        'w' => 7 * 86_400_000,
        _ => return Err(bad()),
    };
    let n: u64 = ago[..ago.len() - 1].parse().map_err(|_| bad())?;
    Ok(n * unit)
}

/// One message to build.
pub struct Draft<'a> {
    pub from: &'a Person,
    pub to: &'a [Person],
    pub cc: &'a [Person],
    pub subject: &'a str,
    pub date_ms: u64,
    pub message_id: &'a str,
    /// The conversation so far, oldest first (Message-IDs, no brackets).
    pub references: &'a [String],
    pub text: &'a str,
    pub html: Option<&'a str>,
    pub attachments: &'a [AttachmentData],
}

pub fn build(d: &Draft<'_>, now_ms: u64) -> Result<Vec<u8>> {
    let address = |p: &Person| MimeAddress::new_address(Some(p.name.clone()), p.email.clone());
    let list = |people: &[Person]| MimeAddress::new_list(people.iter().map(address).collect());
    let mut builder = MessageBuilder::new()
        .from(address(d.from))
        .subject(d.subject.to_string())
        .date((d.date_ms / 1000) as i64)
        .message_id(d.message_id.to_string())
        .text_body(d.text.replace("\r\n", "\n").replace('\n', "\r\n"));
    if !d.to.is_empty() {
        builder = builder.to(list(d.to));
    }
    if !d.cc.is_empty() {
        builder = builder.cc(list(d.cc));
    }
    if let Some(html) = d.html {
        builder = builder.html_body(html.to_string());
    }
    if let Some(last) = d.references.last() {
        builder = builder
            .in_reply_to(last.clone())
            .references(d.references.to_vec());
    }
    for a in d.attachments {
        let content = expand(&a.text, now_ms);
        builder = builder.attachment(a.mime_type.clone(), a.name.clone(), content.into_bytes());
    }
    builder
        .write_to_vec()
        .map_err(|e| CoreError::Other(format!("demo mail: {e}")))
}

/// Fills in `{{ics:+1d 10:00}}` placeholders.
fn expand(text: &str, now_ms: u64) -> String {
    let mut out = String::new();
    let mut rest = text;
    while let Some(start) = rest.find("{{ics:") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 6..];
        let Some(end) = after.find("}}") else {
            rest = &rest[start..];
            break;
        };
        out.push_str(&ics_time(&after[..end], now_ms).unwrap_or_default());
        rest = &after[end + 2..];
    }
    out.push_str(rest);
    out
}

/// `+1d 10:00` → `20261027T150000Z`: that many days from today, at that
/// local time.
fn ics_time(spec: &str, now_ms: u64) -> Option<String> {
    let (days, time) = spec.trim().split_once(' ')?;
    let days: i64 = days
        .trim_start_matches('+')
        .trim_end_matches('d')
        .parse()
        .ok()?;
    let (hour, minute) = time.split_once(':')?;
    let today = Local
        .timestamp_millis_opt(now_ms as i64)
        .single()?
        .date_naive();
    let day = today + chrono::Duration::days(days);
    let local = day.and_hms_opt(hour.parse().ok()?, minute.parse().ok()?, 0)?;
    let at = Local.from_local_datetime(&local).earliest()?;
    Some(
        at.with_timezone(&chrono::Utc)
            .format("%Y%m%dT%H%M%SZ")
            .to_string(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_builtin_mail_reads_and_everyone_in_it_is_known() {
        let data = DemoData::builtin();
        assert!(
            data.accounts.len() >= 2,
            "a unified inbox needs two accounts"
        );
        for account in &data.accounts {
            for c in &account.conversations {
                for m in &c.messages {
                    data.person(&m.from, account).unwrap();
                    for key in m.to.iter().flatten().chain(&m.cc) {
                        data.person(key, account).unwrap();
                    }
                    ago_ms(&m.ago).unwrap();
                }
            }
            for key in &account.contacts {
                data.person(key, account).unwrap();
            }
        }
    }

    #[test]
    fn times_are_relative_to_now() {
        assert_eq!(ago_ms("25m").unwrap(), 25 * 60_000);
        assert_eq!(ago_ms("2d").unwrap(), 2 * 86_400_000);
        assert!(ago_ms("soon").is_err());
        let now = 1_800_000_000_000;
        let filled = expand("DTSTART:{{ics:+1d 10:00}}\r\nX", now);
        assert!(filled.starts_with("DTSTART:20"), "{filled}");
        assert!(filled.ends_with("00Z\r\nX"), "{filled}");
    }
}
