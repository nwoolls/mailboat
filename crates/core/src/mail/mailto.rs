//! `mailto:` links (RFC 6068): from another app when the app is the default
//! email reader, or clicked inside an email. Each becomes a new message.

use percent_encoding::percent_decode_str;
use serde::{Deserialize, Serialize};
use specta::Type;

/// What a `mailto:` link fills in. Recipients are kept as written (a
/// comma-separated list, names allowed); the composer parses them.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Mailto {
    pub to: Vec<String>,
    pub cc: Vec<String>,
    pub bcc: Vec<String>,
    pub subject: String,
    /// Plain text.
    pub body: String,
}

/// Reads a `mailto:` link, or `None` if it isn't one. Unknown fields (and
/// `In-Reply-To` and the like) are ignored. A `+` stays a `+`: unlike web
/// forms, mailto doesn't use it for spaces, and addresses contain it.
pub fn parse(link: &str) -> Option<Mailto> {
    let link = link.trim();
    let scheme = link.get(..7)?;
    if !scheme.eq_ignore_ascii_case("mailto:") {
        return None;
    }
    let rest = &link[7..];
    let (path, query) = rest.split_once('?').unwrap_or((rest, ""));
    let mut out = Mailto::default();
    push_recipients(&mut out.to, path);
    for pair in query.split('&').filter(|p| !p.is_empty()) {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        match decode(key).to_ascii_lowercase().as_str() {
            "to" => push_recipients(&mut out.to, value),
            "cc" => push_recipients(&mut out.cc, value),
            "bcc" => push_recipients(&mut out.bcc, value),
            // The first one wins if a link repeats them.
            "subject" if out.subject.is_empty() => out.subject = decode(value),
            "body" if out.body.is_empty() => out.body = normalize_newlines(&decode(value)),
            _ => {}
        }
    }
    Some(out)
}

fn decode(s: &str) -> String {
    percent_decode_str(s).decode_utf8_lossy().into_owned()
}

/// Splits on commas outside quotes, so `"Doe, Jane" <j@x.example>` stays whole.
fn push_recipients(list: &mut Vec<String>, encoded: &str) {
    let decoded = decode(encoded);
    let mut quoted = false;
    let mut current = String::new();
    for c in decoded.chars() {
        match c {
            '"' => {
                quoted = !quoted;
                current.push(c);
            }
            ',' if !quoted => list.extend(take_trimmed(&mut current)),
            _ => current.push(c),
        }
    }
    list.extend(take_trimmed(&mut current));
}

fn take_trimmed(s: &mut String) -> Option<String> {
    let taken = std::mem::take(s);
    let trimmed = taken.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

/// Bodies use CRLF line breaks; the composer wants plain `\n`.
fn normalize_newlines(s: &str) -> String {
    s.replace("\r\n", "\n").replace('\r', "\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_address() {
        let m = parse("mailto:jane@example.com").unwrap();
        assert_eq!(m.to, vec!["jane@example.com"]);
        assert_eq!(m.subject, "");
    }

    #[test]
    fn every_field() {
        let m = parse(
            "MAILTO:a@x.example,b@x.example?cc=c@x.example&BCC=d@x.example&subject=Hello%20there&body=Line%201%0D%0ALine%202&to=e@x.example",
        )
        .unwrap();
        assert_eq!(m.to, vec!["a@x.example", "b@x.example", "e@x.example"]);
        assert_eq!(m.cc, vec!["c@x.example"]);
        assert_eq!(m.bcc, vec!["d@x.example"]);
        assert_eq!(m.subject, "Hello there");
        assert_eq!(m.body, "Line 1\nLine 2");
    }

    #[test]
    fn plus_is_not_a_space() {
        let m = parse("mailto:jane+news@example.com?subject=1+1").unwrap();
        assert_eq!(m.to, vec!["jane+news@example.com"]);
        assert_eq!(m.subject, "1+1");
    }

    #[test]
    fn names_with_commas_stay_whole() {
        let m = parse("mailto:%22Doe,%20Jane%22%20%3Cj@x.example%3E,%20k@x.example").unwrap();
        assert_eq!(m.to, vec!["\"Doe, Jane\" <j@x.example>", "k@x.example"]);
    }

    #[test]
    fn no_address_and_odd_fields() {
        let m = parse("mailto:?subject=Hi&in-reply-to=%3Cid@x%3E&subject=Ignored&cc=").unwrap();
        assert!(m.to.is_empty() && m.cc.is_empty());
        assert_eq!(m.subject, "Hi");
    }

    #[test]
    fn not_mailto() {
        assert_eq!(parse("https://example.com"), None);
        assert_eq!(parse("mail"), None);
    }
}
