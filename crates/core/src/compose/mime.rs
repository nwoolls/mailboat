//! Builds the RFC 5322 message Gmail sends, with `mail-builder` (Stalwart's
//! maintained builder) doing the encoding: RFC 2047 for non-ASCII names and
//! subjects, quoted-printable bodies, line folding.

use mail_builder::headers::address::Address as MimeAddress;
use mail_builder::MessageBuilder;

use crate::error::{CoreError, Result};
use crate::model::Address;

/// What goes into one outgoing message, already checked.
#[derive(Debug, Clone, Default)]
pub struct MimeMessage {
    pub from: Address,
    pub to: Vec<Address>,
    pub cc: Vec<Address>,
    pub bcc: Vec<Address>,
    pub subject: String,
    pub text: String,
    /// The formatted version; sent alongside the text as
    /// `multipart/alternative`, so plain-text readers still get the text.
    pub html: Option<String>,
    /// Files: (name, MIME type, bytes).
    pub attachments: Vec<(String, String, Vec<u8>)>,
    /// Message-IDs (with angle brackets) of the message being answered.
    pub in_reply_to: Option<String>,
    /// The whole chain, oldest first, ending with `in_reply_to`.
    pub references: Vec<String>,
}

/// Serializes the message. Gmail reads Bcc from the raw message for
/// delivery and strips it before anyone else sees it.
pub fn build(msg: &MimeMessage) -> Result<Vec<u8>> {
    let mut builder = MessageBuilder::new()
        .from(mime_address(&msg.from))
        .subject(one_line(&msg.subject))
        .message_id(new_message_id(&msg.from.email))
        .text_body(normalize_newlines(&msg.text));
    if let Some(html) = msg.html.as_deref().filter(|h| !h.trim().is_empty()) {
        builder = builder.html_body(html.to_string());
    }
    for (name, mime_type, bytes) in &msg.attachments {
        builder = builder.attachment(mime_type.clone(), one_line(name), bytes.clone());
    }
    if !msg.to.is_empty() {
        builder = builder.to(mime_list(&msg.to));
    }
    if !msg.cc.is_empty() {
        builder = builder.cc(mime_list(&msg.cc));
    }
    if !msg.bcc.is_empty() {
        builder = builder.bcc(mime_list(&msg.bcc));
    }
    if let Some(id) = &msg.in_reply_to {
        builder = builder.in_reply_to(bare_id(id));
    }
    if !msg.references.is_empty() {
        builder = builder.references(
            msg.references
                .iter()
                .map(|r| bare_id(r))
                .collect::<Vec<_>>(),
        );
    }
    builder
        .write_to_vec()
        .map_err(|e| CoreError::Other(format!("could not build the message: {e}")))
}

/// The Message-IDs in a References or In-Reply-To header, in order.
pub fn message_ids(header: &str) -> Vec<String> {
    header
        .split(|c: char| c.is_whitespace() || c == ',')
        .map(str::trim)
        .filter(|s| s.starts_with('<') && s.ends_with('>') && s.len() > 2)
        .map(str::to_string)
        .collect()
}

/// Header text can't hold line breaks (they would start new headers).
pub fn one_line(s: &str) -> String {
    s.split(['\r', '\n'])
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// A usable email address: one `@`, something either side, and nothing
/// that could break out of the header (spaces, brackets, commas, controls).
pub fn valid_email(email: &str) -> bool {
    let Some((local, domain)) = email.split_once('@') else {
        return false;
    };
    !local.is_empty()
        && !domain.is_empty()
        && !domain.contains('@')
        && !email
            .chars()
            .any(|c| c.is_whitespace() || c.is_control() || "<>,;:\"()[]\\".contains(c))
}

fn mime_address(a: &Address) -> MimeAddress<'static> {
    let name = a
        .name
        .as_deref()
        .map(one_line)
        .filter(|n| !n.trim().is_empty());
    MimeAddress::new_address(name, a.email.clone())
}

fn mime_list(list: &[Address]) -> MimeAddress<'static> {
    MimeAddress::new_list(list.iter().map(mime_address).collect())
}

/// `mail-builder` adds the angle brackets itself.
fn bare_id(id: &str) -> String {
    id.trim()
        .trim_start_matches('<')
        .trim_end_matches('>')
        .to_string()
}

fn new_message_id(from_email: &str) -> String {
    let domain = from_email.rsplit_once('@').map_or("mailboat", |(_, d)| d);
    format!(
        "mailboat.{:016x}{:016x}@{domain}",
        fastrand::u64(..),
        fastrand::u64(..)
    )
}

/// Bodies come from a text area (`\n`); mail lines end in CRLF.
fn normalize_newlines(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\n', "\r\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn addr(name: Option<&str>, email: &str) -> Address {
        Address {
            name: name.map(str::to_string),
            email: email.to_string(),
        }
    }

    fn built(msg: &MimeMessage) -> String {
        String::from_utf8(build(msg).unwrap()).unwrap()
    }

    #[test]
    fn plain_message_has_the_expected_headers() {
        let raw = built(&MimeMessage {
            from: addr(Some("Me Myself"), "me@x.com"),
            to: vec![addr(None, "a@y.com"), addr(Some("Bee"), "b@y.com")],
            cc: vec![addr(None, "c@y.com")],
            bcc: vec![addr(None, "secret@y.com")],
            subject: "Hello".into(),
            text: "Line one\nLine two".into(),
            ..Default::default()
        });
        assert!(raw.contains("From: \"Me Myself\" <me@x.com>"), "{raw}");
        assert!(raw.contains("To: <a@y.com>, \"Bee\" <b@y.com>"), "{raw}");
        assert!(raw.contains("Cc: <c@y.com>"), "{raw}");
        assert!(raw.contains("Bcc: <secret@y.com>"), "{raw}");
        assert!(raw.contains("Subject: Hello"), "{raw}");
        assert!(raw.contains("Message-ID: <mailboat."), "{raw}");
        assert!(raw.contains("@x.com>"), "{raw}");
        assert!(raw.contains("Line one\r\nLine two"), "{raw}");
        assert!(!raw.contains("In-Reply-To"), "{raw}");
    }

    #[test]
    fn replies_carry_threading_headers() {
        let raw = built(&MimeMessage {
            from: addr(None, "me@x.com"),
            to: vec![addr(None, "a@y.com")],
            subject: "Re: Plans".into(),
            text: "ok".into(),
            in_reply_to: Some("<two@y.com>".into()),
            references: vec!["<one@y.com>".into(), "<two@y.com>".into()],
            ..Default::default()
        });
        assert!(raw.contains("In-Reply-To: <two@y.com>"), "{raw}");
        assert!(raw.contains("References: <one@y.com> <two@y.com>"), "{raw}");
    }

    #[test]
    fn line_breaks_cannot_inject_headers() {
        let raw = built(&MimeMessage {
            from: addr(Some("Evil\r\nBcc: x@evil.com"), "me@x.com"),
            to: vec![addr(None, "a@y.com")],
            subject: "Hi\r\nBcc: victim@evil.com".into(),
            text: "body".into(),
            ..Default::default()
        });
        assert!(!raw.contains("\r\nBcc:"), "{raw}");
    }

    #[test]
    fn non_ascii_subjects_and_names_are_encoded() {
        let raw = built(&MimeMessage {
            from: addr(Some("Zoë"), "me@x.com"),
            to: vec![addr(None, "a@y.com")],
            subject: "Café ☕".into(),
            text: "Grüße".into(),
            ..Default::default()
        });
        assert!(raw.contains("Subject: =?utf-8?"), "{raw}");
        assert!(raw.contains("From: =?utf-8?"), "{raw}");
        assert!(raw.is_ascii(), "the whole message is 7-bit after encoding");
    }

    #[test]
    fn attachments_are_attached() {
        let raw = built(&MimeMessage {
            from: addr(None, "me@x.com"),
            to: vec![addr(None, "a@y.com")],
            subject: "Files".into(),
            text: "see attached".into(),
            attachments: vec![(
                "report.pdf".into(),
                "application/pdf".into(),
                b"%PDF-1".to_vec(),
            )],
            ..Default::default()
        });
        assert!(raw.contains("multipart/mixed"), "{raw}");
        assert!(raw.contains("application/pdf"), "{raw}");
        assert!(raw.contains("report.pdf"), "{raw}");
    }

    #[test]
    fn formatted_mail_carries_both_versions() {
        let raw = built(&MimeMessage {
            from: addr(None, "me@x.com"),
            to: vec![addr(None, "a@y.com")],
            subject: "Hi".into(),
            text: "Hello there".into(),
            html: Some("<p>Hello <b>there</b></p>".into()),
            ..Default::default()
        });
        assert!(raw.contains("multipart/alternative"), "{raw}");
        assert!(raw.contains("text/plain"), "{raw}");
        assert!(raw.contains("text/html"), "{raw}");
        assert!(raw.contains("<b>there</b>"), "{raw}");
    }

    #[test]
    fn message_ids_are_read_from_headers() {
        assert_eq!(
            message_ids("<a@x>  <b@y>\r\n <c@z>"),
            vec!["<a@x>", "<b@y>", "<c@z>"]
        );
        assert!(message_ids("").is_empty());
    }

    #[test]
    fn email_validation_rejects_header_breakers() {
        assert!(valid_email("a.b+c@example.co.uk"));
        for bad in [
            "",
            "a",
            "@x.com",
            "a@",
            "a b@x.com",
            "a@x.com>",
            "a@x.com,b@y",
            "a\r\n@x",
        ] {
            assert!(!valid_email(bad), "{bad:?}");
        }
    }
}
