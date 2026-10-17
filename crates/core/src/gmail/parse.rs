//! Turns Gmail API messages into the store's input types.

use base64::alphabet;
use base64::engine::{DecodePaddingMode, GeneralPurpose, GeneralPurposeConfig};
use base64::Engine;

use super::types::{Message, MessagePart, Thread};
use crate::db::store::{IncomingAttachment, IncomingMessage, IncomingThread, StoredBody};
use crate::model::Address;

/// Gmail encodes bodies as base64url, sometimes with and sometimes without padding.
const B64URL: GeneralPurpose = GeneralPurpose::new(
    &alphabet::URL_SAFE,
    GeneralPurposeConfig::new().with_decode_padding_mode(DecodePaddingMode::Indifferent),
);

pub fn decode_base64url(data: &str) -> Option<Vec<u8>> {
    B64URL.decode(data.trim()).ok()
}

/// base64url with padding, as Gmail's `raw` fields take it.
pub fn encode_base64url(data: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE.encode(data)
}

pub fn header<'a>(part: &'a MessagePart, name: &str) -> Option<&'a str> {
    part.headers
        .iter()
        .find(|h| h.name.eq_ignore_ascii_case(name))
        .map(|h| h.value.as_str())
}

pub fn thread_to_incoming(thread: &Thread) -> IncomingThread {
    IncomingThread {
        gmail_thread_id: thread.id.clone(),
        messages: thread.messages.iter().map(message_to_incoming).collect(),
    }
}

pub fn message_to_incoming(msg: &Message) -> IncomingMessage {
    let part = msg.payload.as_ref();
    let h = |name: &str| part.and_then(|p| header(p, name)).map(str::to_string);
    IncomingMessage {
        gmail_message_id: msg.id.clone(),
        label_ids: msg.label_ids.clone(),
        internal_date: msg.internal_date.unwrap_or(0) as i64,
        snippet: decode_entities(&msg.snippet),
        subject: h("Subject").unwrap_or_default(),
        from: h("From").and_then(|v| parse_address_list(&v).into_iter().next()),
        to: h("To").map(|v| parse_address_list(&v)).unwrap_or_default(),
        cc: h("Cc").map(|v| parse_address_list(&v)).unwrap_or_default(),
        reply_to: h("Reply-To")
            .map(|v| parse_address_list(&v))
            .unwrap_or_default(),
        rfc822_message_id: h("Message-ID"),
        in_reply_to: h("In-Reply-To"),
        references: h("References"),
        has_attachments: part.is_some_and(has_attachments),
    }
}

/// Sync only fetches headers (`format=metadata`), which leave out the
/// message's parts, so a `multipart/mixed` message counts as having
/// attachments (that's how mail clients send files). Once the body is
/// fetched, the real attachment list replaces this guess
/// (`store::set_body`). Full payloads are checked part by part.
fn has_attachments(part: &MessagePart) -> bool {
    part.mime_type.eq_ignore_ascii_case("multipart/mixed") || has_attachment_parts(part)
}

fn has_attachment_parts(part: &MessagePart) -> bool {
    let inline = header(part, "Content-Disposition")
        .is_some_and(|d| d.trim_start().to_ascii_lowercase().starts_with("inline"));
    (!part.filename.is_empty() && !inline) || part.parts.iter().any(has_attachment_parts)
}

/// Gmail snippets arrive HTML-escaped ("&#39;", "&amp;").
fn decode_entities(s: &str) -> String {
    s.replace("&#39;", "'")
        .replace("&quot;", "\"")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

/// Parses an address header such as
/// `"Doe, Jane" <jane@x.com>, bob@y.com, Ann <ann@z.com>`.
/// Headers from the Gmail API are already decoded to UTF-8.
pub fn parse_address_list(value: &str) -> Vec<Address> {
    let mut items = Vec::new();
    let mut current = String::new();
    let (mut in_quotes, mut in_angle) = (false, false);
    for c in value.chars() {
        match c {
            '"' if !in_angle => in_quotes = !in_quotes,
            '<' if !in_quotes => in_angle = true,
            '>' if !in_quotes => in_angle = false,
            ',' | ';' if !in_quotes && !in_angle => {
                items.push(std::mem::take(&mut current));
                continue;
            }
            _ => {}
        }
        current.push(c);
    }
    items.push(current);
    items
        .iter()
        .filter_map(|item| parse_address(item))
        .collect()
}

fn parse_address(item: &str) -> Option<Address> {
    let item = item.trim();
    // Drop RFC 5322 group names such as "undisclosed-recipients:".
    let item = match item.split_once(':') {
        Some((group, rest)) if !group.contains('@') && !group.contains('<') => rest.trim(),
        _ => item,
    };
    if let (Some(start), Some(end)) = (item.rfind('<'), item.rfind('>')) {
        if start < end {
            let email = item[start + 1..end].trim().to_string();
            let name = item[..start]
                .trim()
                .trim_matches('"')
                .trim()
                .replace("\\\"", "\"");
            return email.contains('@').then(|| Address {
                name: (!name.is_empty()).then_some(name),
                email,
            });
        }
    }
    let email = item.trim_matches('"').trim();
    email.contains('@').then(|| Address {
        name: None,
        email: email.to_string(),
    })
}

/// Pulls the HTML and plain-text bodies out of a `format=full` payload.
pub fn extract_body(payload: &MessagePart) -> StoredBody {
    let mut html = None;
    let mut text = None;
    walk_bodies(payload, &mut html, &mut text);
    let text = text.or_else(|| html.as_deref().map(html_to_text));
    StoredBody { html, text }
}

fn walk_bodies(part: &MessagePart, html: &mut Option<String>, text: &mut Option<String>) {
    let mime = part.mime_type.to_ascii_lowercase();
    let is_attachment = !part.filename.is_empty();
    if !is_attachment && (mime == "text/html" || mime == "text/plain") {
        let slot = if mime == "text/html" {
            &mut *html
        } else {
            &mut *text
        };
        if slot.is_none() {
            if let Some(bytes) = part
                .body
                .as_ref()
                .and_then(|b| b.data.as_deref())
                .and_then(decode_base64url)
            {
                let charset = header(part, "Content-Type").and_then(charset_of);
                *slot = Some(decode_charset(&bytes, charset.as_deref()));
            }
        }
    }
    for child in &part.parts {
        walk_bodies(child, html, text);
    }
}

/// The calendar part of a message (a meeting invitation, update,
/// cancellation or answer), if it came inline. Read by `mail::invite`.
pub fn extract_calendar(payload: &MessagePart) -> Option<String> {
    if payload.mime_type.eq_ignore_ascii_case("text/calendar") {
        if let Some(bytes) = payload
            .body
            .as_ref()
            .and_then(|b| b.data.as_deref())
            .and_then(decode_base64url)
        {
            let charset = header(payload, "Content-Type").and_then(charset_of);
            return Some(decode_charset(&bytes, charset.as_deref()));
        }
    }
    payload.parts.iter().find_map(extract_calendar)
}

/// The attachment parts of a `format=full` payload: every part with a file
/// name, plus unnamed parts with a Content-ID (inline images). A part is
/// `inline` when the HTML body refers to it as `cid:…`; those are shown in
/// the email rather than listed as files.
pub fn extract_attachments(payload: &MessagePart, html: Option<&str>) -> Vec<IncomingAttachment> {
    let html = html.map(str::to_ascii_lowercase).unwrap_or_default();
    let mut out = Vec::new();
    walk_attachments(payload, &html, &mut out);
    out
}

fn walk_attachments(part: &MessagePart, html_lower: &str, out: &mut Vec<IncomingAttachment>) {
    let content_id = header(part, "Content-ID")
        .or_else(|| header(part, "X-Attachment-Id"))
        .map(|v| {
            v.trim()
                .trim_start_matches('<')
                .trim_end_matches('>')
                .trim()
                .to_string()
        })
        .filter(|v| !v.is_empty());
    let mime = part.mime_type.to_ascii_lowercase();
    let is_container = mime.starts_with("multipart/");
    let has_data = part
        .body
        .as_ref()
        .is_some_and(|b| b.attachment_id.is_some() || b.data.is_some());
    let named = !part.filename.is_empty();
    if !is_container && has_data && (named || content_id.is_some()) {
        let referenced = content_id
            .as_deref()
            .is_some_and(|cid| html_lower.contains(&format!("cid:{}", cid.to_ascii_lowercase())));
        if let Some(part_id) = part.part_id.clone() {
            out.push(IncomingAttachment {
                part_id,
                gmail_attachment_id: part.body.as_ref().and_then(|b| b.attachment_id.clone()),
                filename: if named {
                    part.filename.clone()
                } else {
                    content_id.clone().unwrap_or_default()
                },
                mime_type: part.mime_type.clone(),
                size: part.body.as_ref().map_or(0, |b| b.size),
                content_id,
                inline: referenced,
            });
        }
    }
    for child in &part.parts {
        walk_attachments(child, html_lower, out);
    }
}

/// The decoded data of one part, if it came inline in the payload (small
/// parts do; larger ones need `messages.attachments.get`).
pub fn part_data(payload: &MessagePart, part_id: &str) -> Option<Vec<u8>> {
    if payload.part_id.as_deref() == Some(part_id) {
        return payload
            .body
            .as_ref()
            .and_then(|b| b.data.as_deref())
            .and_then(decode_base64url);
    }
    payload.parts.iter().find_map(|p| part_data(p, part_id))
}

/// The Gmail attachment ID a part has in this fetch (they change between
/// fetches).
pub fn part_attachment_id(payload: &MessagePart, part_id: &str) -> Option<String> {
    if payload.part_id.as_deref() == Some(part_id) {
        return payload.body.as_ref().and_then(|b| b.attachment_id.clone());
    }
    payload
        .parts
        .iter()
        .find_map(|p| part_attachment_id(p, part_id))
}

fn charset_of(content_type: &str) -> Option<String> {
    content_type.split(';').skip(1).find_map(|p| {
        let (k, v) = p.split_once('=')?;
        k.trim()
            .eq_ignore_ascii_case("charset")
            .then(|| v.trim().trim_matches('"').to_string())
    })
}

fn decode_charset(bytes: &[u8], charset: Option<&str>) -> String {
    let encoding = charset
        .and_then(|c| encoding_rs::Encoding::for_label(c.as_bytes()))
        .unwrap_or(encoding_rs::UTF_8);
    encoding.decode(bytes).0.into_owned()
}

/// Crude HTML → text for the search index only (never displayed).
pub fn html_to_text(html: &str) -> String {
    let mut out = String::with_capacity(html.len() / 2);
    let mut in_tag = false;
    let lower = html.to_ascii_lowercase();
    let mut skip_until: Option<&str> = None;
    let mut i = 0;
    let bytes = html.as_bytes();
    while i < bytes.len() {
        if let Some(end) = skip_until {
            match lower[i..].find(end) {
                Some(pos) => {
                    i += pos + end.len();
                    skip_until = None;
                    in_tag = false;
                    continue;
                }
                None => break,
            }
        }
        let c = bytes[i];
        if c == b'<' {
            if lower[i..].starts_with("<style") {
                skip_until = Some("</style>");
            } else if lower[i..].starts_with("<script") {
                skip_until = Some("</script>");
            }
            in_tag = true;
            out.push(' ');
        } else if c == b'>' && in_tag {
            in_tag = false;
        } else if !in_tag {
            // Push the whole UTF-8 character starting here.
            let ch_len = html[i..].chars().next().map_or(1, char::len_utf8);
            out.push_str(&html[i..i + ch_len]);
            i += ch_len;
            continue;
        }
        i += 1;
    }
    decode_entities(&out.replace("&nbsp;", " "))
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_tricky_address_lists() {
        let list =
            parse_address_list(r#""Doe, Jane" <jane@x.com>, bob@y.com, Ann Lee <ann@z.com>"#);
        assert_eq!(
            list,
            vec![
                Address {
                    name: Some("Doe, Jane".into()),
                    email: "jane@x.com".into()
                },
                Address {
                    name: None,
                    email: "bob@y.com".into()
                },
                Address {
                    name: Some("Ann Lee".into()),
                    email: "ann@z.com".into()
                },
            ]
        );
        assert!(parse_address_list("undisclosed-recipients:;").is_empty());
        assert_eq!(parse_address_list("<solo@x.com>")[0].email, "solo@x.com");
    }

    #[test]
    fn multipart_mixed_headers_count_as_attachments() {
        let msg = |mime: &str| -> Message {
            serde_json::from_value(serde_json::json!({
                "id": "m", "threadId": "t", "payload": { "mimeType": mime, "headers": [] }
            }))
            .unwrap()
        };
        assert!(message_to_incoming(&msg("multipart/mixed")).has_attachments);
        assert!(!message_to_incoming(&msg("multipart/alternative")).has_attachments);
        assert!(!message_to_incoming(&msg("multipart/related")).has_attachments);
    }

    #[test]
    fn finds_an_inline_calendar_part() {
        let ics = encode_base64url(b"BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n");
        let payload: MessagePart = serde_json::from_value(serde_json::json!({
            "mimeType": "multipart/mixed",
            "parts": [
                { "mimeType": "multipart/alternative", "parts": [
                    { "mimeType": "text/plain", "body": { "data": encode_base64url(b"hi") } },
                    { "mimeType": "text/calendar",
                      "headers": [{ "name": "Content-Type", "value": "text/calendar; charset=\"UTF-8\"; method=REQUEST" }],
                      "body": { "data": ics } }
                ]},
                { "mimeType": "application/ics", "filename": "invite.ics",
                  "body": { "attachmentId": "A1", "size": 900 } }
            ]
        }))
        .unwrap();
        assert_eq!(
            extract_calendar(&payload).as_deref(),
            Some("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n")
        );
        let plain: MessagePart =
            serde_json::from_value(serde_json::json!({ "mimeType": "text/plain" })).unwrap();
        assert_eq!(extract_calendar(&plain), None);
    }

    #[test]
    fn decodes_base64url_with_or_without_padding() {
        assert_eq!(decode_base64url("aGk").unwrap(), b"hi");
        assert_eq!(decode_base64url("aGk=").unwrap(), b"hi");
        assert_eq!(decode_base64url("Pz8-").unwrap(), b"??>");
    }

    #[test]
    fn html_to_text_drops_tags_styles_and_scripts() {
        let t =
            html_to_text("<style>p{}</style><p>Hello&nbsp;<b>wörld</b></p><script>x()</script>!");
        assert_eq!(t, "Hello wörld !");
    }

    #[test]
    fn decodes_latin1_bodies() {
        assert_eq!(
            decode_charset(&[0x63, 0x61, 0x66, 0xe9], Some("iso-8859-1")),
            "café"
        );
        assert_eq!(
            charset_of("text/plain; charset=\"ISO-8859-1\"").unwrap(),
            "ISO-8859-1"
        );
    }
}
