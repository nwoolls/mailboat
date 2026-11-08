#![no_main]
//! A Gmail `messages.get` response, read into the store's types
//! (`gmail::parse`): headers into addresses, the parts' bodies and charsets,
//! attachment names, the calendar part. The first byte picks the input: raw
//! JSON text, or a tree of parts built from the rest (so the fuzzer reaches
//! the parser without first learning JSON). See `parse_check`.

use libfuzzer_sys::arbitrary::{Arbitrary, Unstructured};
use libfuzzer_sys::fuzz_target;
use mail_core::gmail::parse::encode_base64url;
use mail_core::parse_check;
use serde_json::{json, Value};

/// Types a message's parts commonly have, so the parser's branches are reached.
const MIME_TYPES: &[&str] = &[
    "text/plain",
    "text/html",
    "text/calendar",
    "multipart/mixed",
    "multipart/alternative",
    "application/pdf",
    "application/ics",
    "image/png",
];

#[derive(Arbitrary, Debug)]
struct Part {
    mime: u8,
    mime_text: Option<String>,
    filename: String,
    headers: Vec<(String, String)>,
    data: Option<Vec<u8>>,
    attachment_id: Option<String>,
    parts: Vec<Part>,
}

impl Part {
    fn json(&self, id: &mut u32) -> Value {
        *id += 1;
        let mime = self
            .mime_text
            .clone()
            .unwrap_or_else(|| MIME_TYPES[self.mime as usize % MIME_TYPES.len()].to_string());
        let mut body = serde_json::Map::new();
        body.insert("size".into(), json!(self.data.as_ref().map_or(0, Vec::len)));
        if let Some(data) = &self.data {
            body.insert("data".into(), json!(encode_base64url(data)));
        }
        if let Some(attachment) = &self.attachment_id {
            body.insert("attachmentId".into(), json!(attachment));
        }
        json!({
            "partId": id.to_string(),
            "mimeType": mime,
            "filename": self.filename,
            "headers": self.headers.iter().map(|(n, v)| json!({"name": n, "value": v})).collect::<Vec<_>>(),
            "body": body,
            "parts": self.parts.iter().map(|p| p.json(id)).collect::<Vec<_>>(),
        })
    }
}

fuzz_target!(|data: &[u8]| {
    let Some((&mode, rest)) = data.split_first() else {
        return;
    };
    let json = if mode & 1 == 0 {
        String::from_utf8_lossy(rest).into_owned()
    } else {
        let Ok(part) = Part::arbitrary(&mut Unstructured::new(rest)) else {
            return;
        };
        let mut id = 0;
        json!({
            "id": "m1", "threadId": "t1", "snippet": "", "internalDate": "0",
            "payload": part.json(&mut id),
        })
        .to_string()
    };
    let problems = parse_check::message_problems(&json);
    assert!(problems.is_empty(), "{problems:#?}\nfrom {json}");
});
