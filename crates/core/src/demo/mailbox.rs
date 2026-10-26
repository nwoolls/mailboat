//! One made-up Gmail account: its messages (kept as the real RFC 5322
//! text, and shown in Gmail's JSON shapes), labels, history, drafts,
//! rules, vacation responder, contacts and calendar.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use mail_parser::{AddressList, MessageParser, MessagePart};
use serde_json::{json, Value};

use super::search::{self, Fields};
use crate::gmail::parse::encode_base64url;
use crate::gmail::types::{Filter, Vacation};

/// Gmail's system labels, as `labels.list` gives them.
const SYSTEM_LABELS: [&str; 11] = [
    "INBOX",
    "SENT",
    "DRAFT",
    "SPAM",
    "TRASH",
    "UNREAD",
    "STARRED",
    "IMPORTANT",
    "CHAT",
    "CATEGORY_PERSONAL",
    "CATEGORY_UPDATES",
];

pub(crate) struct UserLabel {
    pub id: String,
    pub name: String,
    pub background: Option<String>,
    pub text: Option<String>,
}

pub(crate) struct Stored {
    pub id: String,
    pub thread_id: String,
    pub labels: BTreeSet<String>,
    pub internal_date: u64,
    pub raw: Vec<u8>,
    /// Gmail's `payload`, attachments by ID.
    payload: Value,
    snippet: String,
    attachments: HashMap<String, Vec<u8>>,
    // For searching, lowercased.
    from: String,
    to: String,
    cc: String,
    subject: String,
    text: String,
    filenames: Vec<String>,
    /// For threading replies and the scripted answers.
    pub message_id: Option<String>,
    pub references: Vec<String>,
    pub from_email: String,
    pub to_emails: Vec<String>,
    pub subject_text: String,
}

#[derive(Default)]
pub(crate) struct Mailbox {
    pub email: String,
    pub name: String,
    pub labels: Vec<UserLabel>,
    pub messages: BTreeMap<String, Stored>,
    history: Vec<Value>,
    pub history_id: u64,
    next_id: u64,
    /// Draft ID → message ID.
    drafts: BTreeMap<String, String>,
    pub filters: Vec<Filter>,
    pub vacation: Vacation,
    pub signature: Option<String>,
    pub contacts: Vec<(String, String)>,
    pub events: Vec<Value>,
}

impl Mailbox {
    pub fn new(email: &str, name: &str, seed: u64) -> Self {
        Self {
            email: email.to_string(),
            name: name.to_string(),
            history_id: 1000,
            // Accounts get their own ID ranges, like real Gmail IDs that
            // just happen to differ (and could collide: the app copes).
            next_id: 0x18f0_0000_0000_0000 + seed * 0x1_0000_0000,
            ..Default::default()
        }
    }

    fn new_id(&mut self) -> String {
        self.next_id += 1;
        format!("{:x}", self.next_id)
    }

    /// A user label's ID by name (made if it's new), or a system label's ID.
    pub fn label_id(&mut self, name: &str) -> String {
        if SYSTEM_LABELS.contains(&name) {
            return name.to_string();
        }
        if let Some(l) = self.labels.iter().find(|l| l.name == name) {
            return l.id.clone();
        }
        self.create_label(name, None, None)
    }

    pub fn create_label(
        &mut self,
        name: &str,
        background: Option<String>,
        text: Option<String>,
    ) -> String {
        let id = format!("Label_{}", self.labels.len() + 1);
        self.labels.push(UserLabel {
            id: id.clone(),
            name: name.to_string(),
            background,
            text,
        });
        id
    }

    pub fn labels_json(&self) -> Value {
        let mut labels: Vec<Value> = SYSTEM_LABELS
            .iter()
            .map(|id| json!({ "id": id, "name": id, "type": "system" }))
            .collect();
        for l in &self.labels {
            let mut label = json!({ "id": l.id, "name": l.name, "type": "user" });
            if l.background.is_some() || l.text.is_some() {
                label["color"] = json!({ "backgroundColor": l.background, "textColor": l.text });
            }
            labels.push(label);
        }
        json!({ "labels": labels })
    }

    pub fn label_json(&self, id: &str) -> Option<Value> {
        let l = self.labels.iter().find(|l| l.id == id)?;
        Some(json!({ "id": l.id, "name": l.name, "type": "user" }))
    }

    pub fn delete_label(&mut self, id: &str) -> bool {
        let before = self.labels.len();
        self.labels.retain(|l| l.id != id);
        let ids: Vec<String> = self.messages.keys().cloned().collect();
        self.modify(&ids, &[], &[id.to_string()]);
        self.labels.len() < before
    }

    fn record(&mut self, mut entry: Value) {
        self.history_id += 1;
        entry["id"] = json!(self.history_id.to_string());
        self.history.push(entry);
    }

    /// Adds a message. `thread` puts it in that conversation.
    pub fn add(
        &mut self,
        raw: Vec<u8>,
        thread: Option<&str>,
        labels: BTreeSet<String>,
        internal_date: u64,
    ) -> (String, String) {
        let id = self.new_id();
        let thread_id = thread
            .filter(|t| self.messages.values().any(|m| m.thread_id == *t))
            .map_or_else(|| id.clone(), str::to_string);
        let stored = stored(&id, &thread_id, labels, internal_date, raw);
        let entry = json!({
            "messages": [{ "id": id, "threadId": thread_id }],
            "messagesAdded": [{ "message": message_ref(&stored) }],
        });
        self.messages.insert(id.clone(), stored);
        self.record(entry);
        (id, thread_id)
    }

    pub fn delete(&mut self, id: &str) -> bool {
        let Some(m) = self.messages.remove(id) else {
            return false;
        };
        self.record(json!({
            "messages": [{ "id": m.id, "threadId": m.thread_id }],
            "messagesDeleted": [{ "message": { "id": m.id, "threadId": m.thread_id } }],
        }));
        true
    }

    /// Adds and removes labels on messages, recording what changed.
    pub fn modify(&mut self, ids: &[String], add: &[String], remove: &[String]) {
        for id in ids {
            let Some(m) = self.messages.get_mut(id) else {
                continue;
            };
            let added: Vec<String> = add
                .iter()
                .filter(|l| m.labels.insert((*l).clone()))
                .cloned()
                .collect();
            let removed: Vec<String> = remove
                .iter()
                .filter(|l| m.labels.remove(*l))
                .cloned()
                .collect();
            let reference = message_ref(m);
            let thread = json!([{ "id": m.id, "threadId": m.thread_id }]);
            if !added.is_empty() {
                self.record(json!({
                    "messages": thread,
                    "labelsAdded": [{ "message": reference, "labelIds": added }],
                }));
            }
            if !removed.is_empty() {
                self.record(json!({
                    "messages": thread,
                    "labelsRemoved": [{ "message": reference, "labelIds": removed }],
                }));
            }
        }
    }

    pub fn thread_message_ids(&self, thread: &str) -> Vec<String> {
        self.messages
            .values()
            .filter(|m| m.thread_id == thread)
            .map(|m| m.id.clone())
            .collect()
    }

    pub fn history_json(&self, start: u64) -> Value {
        let entries: Vec<&Value> = self
            .history
            .iter()
            .filter(|h| {
                h["id"]
                    .as_str()
                    .and_then(|id| id.parse::<u64>().ok())
                    .is_some_and(|id| id > start)
            })
            .collect();
        json!({ "history": entries, "historyId": self.history_id.to_string() })
    }

    /// Messages a list or search finds, newest first. Spam and Trash are
    /// left out unless asked for.
    pub fn find(
        &self,
        label: Option<&str>,
        q: Option<&str>,
        spam_trash: bool,
        now_ms: u64,
    ) -> Vec<&Stored> {
        let mut found: Vec<&Stored> = self
            .messages
            .values()
            .filter(|m| spam_trash || !(m.labels.contains("SPAM") || m.labels.contains("TRASH")))
            .filter(|m| label.is_none_or(|l| m.labels.contains(l)))
            .filter(|m| q.is_none_or(|q| self.search(m, q, now_ms)))
            .collect();
        found.sort_by_key(|m| std::cmp::Reverse((m.internal_date, m.id.clone())));
        found
    }

    fn search(&self, m: &Stored, q: &str, now_ms: u64) -> bool {
        let mut labels: Vec<String> = m.labels.iter().cloned().collect();
        labels.extend(
            self.labels
                .iter()
                .filter(|l| m.labels.contains(&l.id))
                .map(|l| l.name.clone()),
        );
        search::matches(
            q,
            &Fields {
                from: &m.from,
                to: &m.to,
                cc: &m.cc,
                subject: &m.subject,
                text: &m.text,
                labels: &labels,
                filenames: &m.filenames,
                size: m.raw.len(),
                date_ms: m.internal_date,
                now_ms,
            },
        )
    }

    /// Thread IDs of found messages, newest conversation first.
    pub fn find_threads(
        &self,
        label: Option<&str>,
        q: Option<&str>,
        spam_trash: bool,
        now_ms: u64,
    ) -> Vec<String> {
        let mut seen = BTreeSet::new();
        self.find(label, q, spam_trash, now_ms)
            .into_iter()
            .filter(|m| seen.insert(m.thread_id.clone()))
            .map(|m| m.thread_id.clone())
            .collect()
    }

    /// `messages.get` in a format: `full`, `raw` or `metadata` (with only
    /// the asked-for headers).
    pub fn message_json(&self, id: &str, format: &str, headers: &[String]) -> Option<Value> {
        let m = self.messages.get(id)?;
        let mut out = json!({
            "id": m.id,
            "threadId": m.thread_id,
            "labelIds": m.labels,
            "snippet": m.snippet,
            "historyId": self.history_id.to_string(),
            "internalDate": m.internal_date.to_string(),
            "sizeEstimate": m.raw.len(),
        });
        match format {
            "raw" => out["raw"] = json!(encode_base64url(&m.raw)),
            "metadata" => {
                let wanted: Vec<String> = headers.iter().map(|h| h.to_lowercase()).collect();
                let kept: Vec<&Value> = m.payload["headers"]
                    .as_array()
                    .map(|all| {
                        all.iter()
                            .filter(|h| {
                                h["name"].as_str().is_some_and(|n| {
                                    wanted.is_empty() || wanted.contains(&n.to_lowercase())
                                })
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                out["payload"] = json!({
                    "partId": "",
                    "mimeType": m.payload["mimeType"],
                    "headers": kept,
                });
            }
            _ => out["payload"] = m.payload.clone(),
        }
        Some(out)
    }

    pub fn thread_json(&self, thread: &str, format: &str, headers: &[String]) -> Option<Value> {
        let mut messages: Vec<&Stored> = self
            .messages
            .values()
            .filter(|m| m.thread_id == thread)
            .collect();
        if messages.is_empty() {
            return None;
        }
        messages.sort_by_key(|m| (m.internal_date, m.id.clone()));
        let messages: Vec<Value> = messages
            .iter()
            .filter_map(|m| self.message_json(&m.id, format, headers))
            .collect();
        Some(json!({
            "id": thread,
            "historyId": self.history_id.to_string(),
            "messages": messages,
        }))
    }

    pub fn attachment(&self, message: &str, attachment: &str) -> Option<&[u8]> {
        self.messages
            .get(message)?
            .attachments
            .get(attachment)
            .map(Vec::as_slice)
    }

    pub fn save_draft(
        &mut self,
        draft: Option<&str>,
        raw: Vec<u8>,
        thread: Option<&str>,
        now_ms: u64,
    ) -> Value {
        let draft_id = match draft {
            Some(id) => {
                let old = self.drafts.get(id).cloned();
                if let Some(old) = old {
                    self.delete(&old);
                }
                id.to_string()
            }
            None => format!("r{}", self.new_id()),
        };
        let labels = BTreeSet::from(["DRAFT".to_string()]);
        let (id, thread_id) = self.add(raw, thread, labels, now_ms);
        self.drafts.insert(draft_id.clone(), id.clone());
        json!({ "id": draft_id, "message": { "id": id, "threadId": thread_id } })
    }

    pub fn drafts_json(&self) -> Value {
        let drafts: Vec<Value> = self
            .drafts
            .iter()
            .filter_map(|(draft, message)| {
                let m = self.messages.get(message)?;
                Some(json!({ "id": draft, "message": { "id": m.id, "threadId": m.thread_id } }))
            })
            .collect();
        json!({ "drafts": drafts })
    }

    pub fn delete_draft(&mut self, draft: &str) -> bool {
        match self.drafts.remove(draft) {
            Some(message) => self.delete(&message),
            None => false,
        }
    }

    /// Marks a seeded message as a draft (made by `add`).
    pub fn register_draft(&mut self, message: &str) {
        let id = format!("r{}", self.new_id());
        self.drafts.insert(id, message.to_string());
    }
}

fn message_ref(m: &Stored) -> Value {
    json!({ "id": m.id, "threadId": m.thread_id, "labelIds": m.labels })
}

/// Reads a message once, keeping what Gmail's answers and searches need.
fn stored(
    id: &str,
    thread_id: &str,
    labels: BTreeSet<String>,
    internal_date: u64,
    raw: Vec<u8>,
) -> Stored {
    let mut s = Stored {
        id: id.to_string(),
        thread_id: thread_id.to_string(),
        labels,
        internal_date,
        raw: Vec::new(),
        payload: json!({ "partId": "", "mimeType": "text/plain", "headers": [] }),
        snippet: String::new(),
        attachments: HashMap::new(),
        from: String::new(),
        to: String::new(),
        cc: String::new(),
        subject: String::new(),
        text: String::new(),
        filenames: Vec::new(),
        message_id: None,
        references: Vec::new(),
        from_email: String::new(),
        to_emails: Vec::new(),
        subject_text: String::new(),
    };
    if let Some(message) = MessageParser::new().parse(&raw) {
        let root = message.root_part();
        let mut attachments = HashMap::new();
        let mut filenames = Vec::new();
        let mut payload = part_json(&root, "", &mut attachments, &mut filenames);
        // Gmail gives the top headers decoded (names, subjects in UTF-8).
        if let Some(headers) = payload["headers"].as_array_mut() {
            for h in headers.iter_mut() {
                let name = h["name"].as_str().unwrap_or_default().to_ascii_lowercase();
                let decoded = match name.as_str() {
                    "subject" => message.subject().map(str::to_string),
                    "from" => message.from().map(addresses),
                    "to" => message.to().map(addresses),
                    "cc" => message.cc().map(addresses),
                    "reply-to" => message.reply_to().map(addresses),
                    _ => None,
                };
                if let Some(value) = decoded {
                    h["value"] = json!(value);
                }
            }
        }
        let body = message
            .body_text(0)
            .map(|t| t.to_string())
            .unwrap_or_default();
        s.snippet = escape(&collapse(&body).chars().take(180).collect::<String>());
        s.subject_text = message.subject().unwrap_or_default().to_string();
        s.subject = s.subject_text.to_lowercase();
        s.from = message
            .from()
            .map(addresses)
            .unwrap_or_default()
            .to_lowercase();
        s.to = message
            .to()
            .map(addresses)
            .unwrap_or_default()
            .to_lowercase();
        s.cc = message
            .cc()
            .map(addresses)
            .unwrap_or_default()
            .to_lowercase();
        s.text = format!(
            "{} {} {} {} {}",
            s.subject,
            s.from,
            s.to,
            s.cc,
            body.to_lowercase()
        );
        s.from_email = message
            .from()
            .and_then(|l| l.first())
            .and_then(|m| m.address().map(str::to_string))
            .unwrap_or_default();
        s.to_emails = message
            .to()
            .map(|l| {
                l.mailboxes()
                    .filter_map(|m| m.address().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        s.message_id = message.message_id().map(str::to_string);
        s.references = message
            .references()
            .map(|r| r.iter().map(str::to_string).collect())
            .unwrap_or_default();
        s.payload = payload;
        s.attachments = attachments;
        s.filenames = filenames;
    }
    s.raw = raw;
    s
}

/// One part as Gmail shows it: files get an attachment ID, text comes
/// along as base64url.
fn part_json(
    part: &MessagePart<'_>,
    part_id: &str,
    attachments: &mut HashMap<String, Vec<u8>>,
    filenames: &mut Vec<String>,
) -> Value {
    let mime_type = part
        .content_type()
        .map(|c| match c.subtype() {
            Some(sub) => format!("{}/{}", c.ctype(), sub),
            None => c.ctype().to_string(),
        })
        .unwrap_or_else(|| "text/plain".into())
        .to_ascii_lowercase();
    let filename = part.attachment_name().unwrap_or_default().to_string();
    let headers: Vec<Value> = part
        .headers()
        .iter()
        .map(|h| {
            json!({
                "name": h.raw_name(),
                "value": unfold(&String::from_utf8_lossy(h.raw_value())),
            })
        })
        .collect();
    let mut out = json!({
        "partId": part_id,
        "mimeType": mime_type,
        "filename": filename,
        "headers": headers,
    });
    if part.is_multipart() {
        let children: Vec<Value> = part
            .children()
            .enumerate()
            .map(|(i, child)| {
                let id = if part_id.is_empty() {
                    i.to_string()
                } else {
                    format!("{part_id}.{i}")
                };
                part_json(&child, &id, attachments, filenames)
            })
            .collect();
        out["body"] = json!({ "size": 0 });
        out["parts"] = json!(children);
    } else {
        let bytes = part.decoded().into_owned();
        let size = bytes.len();
        if !filename.is_empty() || !mime_type.starts_with("text/") {
            let id = format!("ANGjdJ{}", attachments.len() + 1);
            if !filename.is_empty() {
                filenames.push(filename.to_lowercase());
            }
            attachments.insert(id.clone(), bytes);
            out["body"] = json!({ "attachmentId": id, "size": size });
        } else {
            out["body"] = json!({ "data": encode_base64url(&bytes), "size": size });
        }
    }
    out
}

/// "Ann <ann@x.example>, bob@y.example"
fn addresses(list: AddressList<'_>) -> String {
    list.mailboxes()
        .map(|m| match (m.name(), m.address()) {
            (Some(name), Some(address)) if name.contains([',', '"']) => {
                format!("\"{}\" <{address}>", name.replace('"', ""))
            }
            (Some(name), Some(address)) => format!("{name} <{address}>"),
            (None, Some(address)) => address.to_string(),
            (Some(name), None) => name.to_string(),
            (None, None) => String::new(),
        })
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(", ")
}

fn unfold(value: &str) -> String {
    collapse(value)
}

fn collapse(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Gmail's snippets come HTML-escaped.
fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}
