//! "Show original": an email as it arrived (its raw source), with a
//! summary of its headers and of the checks Gmail ran on it, as Gmail's
//! own "Show original" page lays them out.

use mail_parser::{AddressList, MessageParser};
use serde::Serialize;
use specta::Type;

/// The most source shown on screen. Attachments make emails up to 25 MB
/// of base64; the full message is in the downloaded `.eml`.
pub const SHOWN_BYTES: usize = 1024 * 1024;

/// Only Gmail's own verdicts count: anyone can put an
/// `Authentication-Results` header in what they send, but Gmail adds its
/// own at the top, naming itself.
const GMAIL_AUTHSERV: &str = "mx.google.com";

/// One of the checks Gmail ran on the email as it arrived.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AuthCheck {
    /// "SPF", "DKIM" or "DMARC".
    pub method: String,
    /// As Gmail wrote it: "pass", "fail", "softfail", "neutral", "none"…
    pub result: String,
    /// What it vouches for: the domain signed for, the sending server's
    /// domain, or the From domain.
    pub detail: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Original {
    pub message_id: Option<String>,
    /// When it was written (its Date header), in ms since 1970.
    pub date: Option<f64>,
    pub from: Option<String>,
    pub to: Option<String>,
    pub cc: Option<String>,
    pub subject: Option<String>,
    pub checks: Vec<AuthCheck>,
    /// The raw message, as text, cut off at `SHOWN_BYTES`.
    pub source: String,
    /// Whether `source` stops short of the whole message.
    pub truncated: bool,
    /// The whole message's size in bytes.
    pub size: u32,
}

/// Reads an email's raw bytes (Gmail's `format=raw`).
pub fn read(raw: &[u8]) -> Original {
    let shown = &raw[..raw.len().min(SHOWN_BYTES)];
    let mut source = String::from_utf8_lossy(shown).into_owned();
    // A cut through a multi-byte character leaves a replacement mark.
    if shown.len() < raw.len() && source.ends_with('\u{FFFD}') {
        source.pop();
    }
    let mut original = Original {
        message_id: None,
        date: None,
        from: None,
        to: None,
        cc: None,
        subject: None,
        checks: Vec::new(),
        source,
        truncated: shown.len() < raw.len(),
        size: u32::try_from(raw.len()).unwrap_or(u32::MAX),
    };
    let Some(message) = MessageParser::new().parse_headers(raw) else {
        return original;
    };
    original.message_id = message.message_id().map(|id| format!("<{id}>"));
    original.date = message.date().map(|d| (d.to_timestamp() * 1000) as f64);
    original.from = message.from().map(addresses);
    original.to = message.to().map(addresses);
    original.cc = message.cc().map(addresses);
    original.subject = message.subject().map(str::to_string);
    original.checks = message
        .headers()
        // The topmost: `get` would give the last.
        .all("Authentication-Results")
        .next()
        .map(|h| gmail_checks(&String::from_utf8_lossy(h.raw_value())))
        .unwrap_or_default();
    original
}

/// "Ann <ann@x.com>, bob@y.com"
fn addresses(list: AddressList<'_>) -> String {
    list.mailboxes()
        .map(|m| match (m.name(), m.address()) {
            (Some(name), Some(address)) => format!("{name} <{address}>"),
            (None, Some(address)) => address.to_string(),
            (Some(name), None) => name.to_string(),
            (None, None) => String::new(),
        })
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(", ")
}

/// SPF, DKIM and DMARC from an `Authentication-Results` value (RFC 8601),
/// if Gmail wrote it. The first result of each kind, in that order.
fn gmail_checks(value: &str) -> Vec<AuthCheck> {
    let unfolded = value.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut parts = split_outside_comments(&unfolded, ';').into_iter();
    let authserv = parts.next().unwrap_or_default();
    if authserv.split_whitespace().next() != Some(GMAIL_AUTHSERV) {
        return Vec::new();
    }
    let results: Vec<String> = parts.collect();
    ["spf", "dkim", "dmarc"]
        .iter()
        .filter_map(|method| {
            let part = results.iter().find(|p| {
                p.split('=')
                    .next()
                    .is_some_and(|m| m.trim().eq_ignore_ascii_case(method))
            })?;
            let words = without_comments(part);
            let mut words = words.split_whitespace();
            let result = words.next()?.split_once('=')?.1.to_ascii_lowercase();
            let props: Vec<(&str, &str)> = words.filter_map(|w| w.split_once('=')).collect();
            let prop = |name: &str| {
                props
                    .iter()
                    .find(|(k, _)| k.eq_ignore_ascii_case(name))
                    .map(|(_, v)| v.trim_start_matches('@').to_string())
            };
            let detail = match *method {
                "spf" => prop("smtp.mailfrom").map(|v| domain_of(&v)),
                "dkim" => prop("header.i")
                    .or_else(|| prop("header.d"))
                    .map(|v| domain_of(&v)),
                _ => prop("header.from"),
            };
            Some(AuthCheck {
                method: method.to_ascii_uppercase(),
                result,
                detail,
            })
        })
        .collect()
}

/// "a@x.com" is x.com; a bare domain stays as it is.
fn domain_of(value: &str) -> String {
    value.rsplit('@').next().unwrap_or(value).to_string()
}

/// Splits on `sep` except inside (comments), which may hold anything.
fn split_outside_comments(s: &str, sep: char) -> Vec<String> {
    let mut parts = vec![String::new()];
    let mut depth = 0usize;
    for c in s.chars() {
        match c {
            '(' => depth += 1,
            ')' => depth = depth.saturating_sub(1),
            _ => {}
        }
        if c == sep && depth == 0 {
            parts.push(String::new());
        } else if let Some(last) = parts.last_mut() {
            last.push(c);
        }
    }
    parts.into_iter().map(|p| p.trim().to_string()).collect()
}

fn without_comments(s: &str) -> String {
    let mut out = String::new();
    let mut depth = 0usize;
    for c in s.chars() {
        match c {
            '(' => depth += 1,
            ')' => depth = depth.saturating_sub(1),
            _ if depth == 0 => out.push(c),
            _ => {}
        }
    }
    out
}

/// A name for the downloaded file: the subject, as Gmail's "Download
/// original" names it, with `.eml` so Mail opens it.
pub fn file_name(subject: Option<&str>) -> String {
    let base = subject
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("original");
    format!("{base}.eml")
}

#[cfg(test)]
mod tests {
    use super::*;

    const RAW: &str = "Delivered-To: me@gmail.com\r\n\
Authentication-Results: mx.google.com;\r\n       dkim=pass header.i=@news.example.com header.s=s1 header.b=AbC;\r\n       spf=pass (google.com: domain of bounce@mail.example.com designates 1.2.3.4 as permitted sender; really) smtp.mailfrom=bounce@mail.example.com;\r\n       dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=example.com\r\n\
Authentication-Results: mx.google.com; spf=fail smtp.mailfrom=forged.example\r\n\
Message-ID: <abc123@example.com>\r\n\
Date: Sat, 24 Oct 2026 09:15:00 -0400\r\n\
From: =?UTF-8?Q?Ren=C3=A9e?= <renee@example.com>\r\n\
To: me@gmail.com, \"Bo\" <bo@example.com>\r\n\
Subject: =?utf-8?b?SGVsbG8g4piA?=\r\n\
\r\n\
Body text\r\n";

    #[test]
    fn summarises_headers_and_gmails_checks() {
        let o = read(RAW.as_bytes());
        assert_eq!(o.message_id.as_deref(), Some("<abc123@example.com>"));
        assert_eq!(o.date, Some(1_792_847_700_000.0));
        assert_eq!(o.from.as_deref(), Some("Renée <renee@example.com>"));
        assert_eq!(o.to.as_deref(), Some("me@gmail.com, Bo <bo@example.com>"));
        assert_eq!(o.cc, None);
        assert_eq!(o.subject.as_deref(), Some("Hello ☀"));
        assert_eq!(
            o.checks,
            vec![
                AuthCheck {
                    method: "SPF".into(),
                    result: "pass".into(),
                    detail: Some("mail.example.com".into()),
                },
                AuthCheck {
                    method: "DKIM".into(),
                    result: "pass".into(),
                    detail: Some("news.example.com".into()),
                },
                AuthCheck {
                    method: "DMARC".into(),
                    result: "pass".into(),
                    detail: Some("example.com".into()),
                },
            ]
        );
        assert_eq!(o.source, RAW);
        assert!(!o.truncated);
        assert_eq!(o.size as usize, RAW.len());
    }

    #[test]
    fn ignores_checks_gmail_didnt_write() {
        let raw = "Authentication-Results: evil.example; spf=pass smtp.mailfrom=x.com\r\n\
Authentication-Results: mx.google.com; spf=fail smtp.mailfrom=x.com\r\n\r\nHi";
        assert!(read(raw.as_bytes()).checks.is_empty());
    }

    #[test]
    fn cuts_long_sources_on_a_character() {
        let mut raw = "Subject: big\r\n\r\n".to_string();
        while raw.len() < SHOWN_BYTES + 10 {
            raw.push('é');
        }
        let o = read(raw.as_bytes());
        assert!(o.truncated);
        assert!(o.source.len() <= SHOWN_BYTES);
        assert!(!o.source.ends_with('\u{FFFD}'));
        assert_eq!(o.size as usize, raw.len());
        assert_eq!(o.subject.as_deref(), Some("big"));
    }

    #[test]
    fn something_that_isnt_an_email_still_shows() {
        let o = read(b"\xff\xfe not mail");
        assert!(o.source.contains("not mail"));
        assert!(o.checks.is_empty());
    }

    #[test]
    fn names_the_file_after_the_subject() {
        assert_eq!(file_name(Some(" Hello ")), "Hello.eml");
        assert_eq!(file_name(Some("")), "original.eml");
        assert_eq!(file_name(None), "original.eml");
    }
}
