//! The made-up Google, served over HTTP on this computer only
//! (127.0.0.1, a port the system picks), so the app's own Gmail client
//! talks to it exactly as it talks to Google. Each request names its
//! account by its access token (the account's address, see
//! `DemoTokens`).

use std::collections::{BTreeSet, HashMap};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use super::data::{self, AttachmentData, Conversation, DemoData, Person};
use super::mailbox::Mailbox;
use crate::ai::summaries::SummaryKind;
use crate::db::now_millis;
use crate::error::{CoreError, Result};
use crate::gmail::types::{Filter, Vacation};

/// Told which account (by address) has new mail, so the app syncs it now
/// rather than at its next scheduled pass.
/// A conversation's ready-made summary.
#[derive(Debug, Clone)]
pub struct Summary {
    pub account: String,
    /// Its Gmail thread ID.
    pub thread: String,
    pub kind: SummaryKind,
    pub text: String,
}

pub type OnChange = Arc<dyn Fn(&str) + Send + Sync>;

#[derive(Debug, Clone)]
pub struct Timing {
    /// How long after you send a message its answer arrives.
    pub reply_after: Duration,
    /// Scales `arriveAfterSeconds` (tests make it zero).
    pub arrivals: f64,
}

impl Default for Timing {
    fn default() -> Self {
        Self {
            reply_after: Duration::from_secs(8),
            arrivals: 1.0,
        }
    }
}

struct State {
    data: DemoData,
    mailboxes: HashMap<String, Mailbox>,
    /// (account, thread) → what the other person answers.
    replies: HashMap<(String, String), String>,
    summaries: Vec<Summary>,
}

#[derive(Clone)]
pub struct FakeGoogle {
    state: Arc<Mutex<State>>,
    on_change: Arc<Mutex<Option<OnChange>>>,
    timing: Timing,
    base_url: String,
}

impl FakeGoogle {
    /// Fills the accounts with the demo mail, dated relative to now, and
    /// starts answering. Must run inside a Tokio runtime.
    pub async fn start(data: DemoData, timing: Timing) -> Result<Self> {
        let now = now_millis() as u64;
        let mut state = State {
            data: data.clone(),
            mailboxes: HashMap::new(),
            replies: HashMap::new(),
            summaries: Vec::new(),
        };
        let mut arrivals = Vec::new();
        for (n, account) in data.accounts.iter().enumerate() {
            let mut mailbox = Mailbox::new(&account.email, &account.name, n as u64);
            for l in &account.labels {
                mailbox.create_label(&l.name, l.background.clone(), l.text.clone());
            }
            mailbox.signature = account.signature.clone();
            mailbox.vacation = Vacation::default();
            for key in &account.contacts {
                let p = data.person(key, account)?;
                mailbox.contacts.push((p.name, p.email));
            }
            state.mailboxes.insert(account.email.clone(), mailbox);
            for c in &account.conversations {
                match c.arrive_after_seconds {
                    Some(after) => arrivals.push((account.email.clone(), c.clone(), after)),
                    None => state.add_conversation(&account.email, c, now)?,
                }
            }
        }
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| CoreError::Other(format!("demo: {e}")))?;
        let port = listener
            .local_addr()
            .map_err(|e| CoreError::Other(format!("demo: {e}")))?
            .port();
        let google = Self {
            state: Arc::new(Mutex::new(state)),
            on_change: Arc::new(Mutex::new(None)),
            timing,
            base_url: format!("http://127.0.0.1:{port}"),
        };
        let serving = google.clone();
        tokio::spawn(async move {
            while let Ok((socket, _)) = listener.accept().await {
                let google = serving.clone();
                tokio::spawn(async move {
                    let _ = google.serve(socket).await;
                });
            }
        });
        for (email, conversation, after) in arrivals {
            let google = google.clone();
            let wait = Duration::from_secs_f64(after as f64 * google.timing.arrivals);
            tokio::spawn(async move {
                tokio::time::sleep(wait).await;
                let now = now_millis() as u64;
                let added =
                    google
                        .state
                        .lock()
                        .unwrap()
                        .add_conversation(&email, &conversation, now);
                if added.is_ok() {
                    google.changed(&email);
                }
            });
        }
        Ok(google)
    }

    /// Where the app's Gmail client should send its requests.
    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    pub fn on_change(&self, f: OnChange) {
        *self.on_change.lock().unwrap() = Some(f);
    }

    fn changed(&self, email: &str) {
        let f = self.on_change.lock().unwrap().clone();
        if let Some(f) = f {
            f(email);
        }
    }

    /// The conversations' summaries, for the list and the reader.
    pub fn summaries(&self) -> Vec<Summary> {
        self.state.lock().unwrap().summaries.clone()
    }

    async fn serve(&self, mut socket: TcpStream) -> std::io::Result<()> {
        let mut buf = Vec::new();
        let mut chunk = [0u8; 16 * 1024];
        let head_end = loop {
            let n = socket.read(&mut chunk).await?;
            if n == 0 {
                return Ok(());
            }
            buf.extend_from_slice(&chunk[..n]);
            if let Some(i) = find(&buf, b"\r\n\r\n") {
                break i;
            }
        };
        let head = String::from_utf8_lossy(&buf[..head_end]).to_string();
        let mut lines = head.split("\r\n");
        let request_line = lines.next().unwrap_or_default().to_string();
        let headers: HashMap<String, String> = lines
            .filter_map(|l| l.split_once(':'))
            .map(|(k, v)| (k.trim().to_ascii_lowercase(), v.trim().to_string()))
            .collect();
        let length: usize = headers
            .get("content-length")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0);
        let mut body = buf[head_end + 4..].to_vec();
        while body.len() < length {
            let n = socket.read(&mut chunk).await?;
            if n == 0 {
                break;
            }
            body.extend_from_slice(&chunk[..n]);
        }
        let mut parts = request_line.split_whitespace();
        let method = parts.next().unwrap_or_default().to_string();
        let target = parts.next().unwrap_or("/").to_string();
        let (status, content_type, payload) = self.respond(&method, &target, &headers, &body);
        let head = format!(
            "HTTP/1.1 {status} {}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            reason(status),
            payload.len()
        );
        socket.write_all(head.as_bytes()).await?;
        socket.write_all(&payload).await?;
        socket.shutdown().await
    }

    fn respond(
        &self,
        method: &str,
        target: &str,
        headers: &HashMap<String, String>,
        body: &[u8],
    ) -> (u16, String, Vec<u8>) {
        let account = headers
            .get("authorization")
            .and_then(|a| a.strip_prefix("Bearer "))
            .map(str::to_string)
            .unwrap_or_default();
        if !self.state.lock().unwrap().mailboxes.contains_key(&account) {
            return json_reply(Err(error(401, "Not signed in")));
        }
        let Ok(url) = url::Url::parse(&format!("http://demo{target}")) else {
            return json_reply(Err(error(400, "Bad request")));
        };
        let query = Query::new(&url);
        let path = url.path().to_string();
        let content_type = headers.get("content-type").cloned().unwrap_or_default();
        if path == "/batch/gmail/v1" {
            return self.batch(&account, &content_type, body);
        }
        let reply = if let Some(rest) = path.strip_prefix("/upload/gmail/v1/users/me/") {
            self.upload(&account, method, rest, &content_type, body)
        } else if let Some(rest) = path.strip_prefix("/gmail/v1/users/me/") {
            self.gmail(&account, method, rest, &query, body)
        } else if let Some(rest) = path.strip_prefix("/calendar/v3/calendars/primary/") {
            self.calendar(&account, method, rest, &query, body)
        } else if path == "/v1/people/me/connections" || path == "/v1/otherContacts" {
            Ok(self.people(&account, path == "/v1/otherContacts"))
        } else {
            Err(error(404, "Not found"))
        };
        json_reply(reply)
    }

    fn gmail(
        &self,
        account: &str,
        method: &str,
        rest: &str,
        q: &Query,
        body: &[u8],
    ) -> std::result::Result<Value, (u16, Value)> {
        let segments: Vec<String> = rest
            .split('/')
            .map(|s| {
                percent_encoding::percent_decode_str(s)
                    .decode_utf8_lossy()
                    .to_string()
            })
            .collect();
        let seg: Vec<&str> = segments.iter().map(String::as_str).collect();
        let body: Value = serde_json::from_slice(body).unwrap_or(Value::Null);
        let now = now_millis() as u64;
        let mut state = self.state.lock().unwrap();
        let mb = state
            .mailboxes
            .get_mut(account)
            .ok_or_else(|| error(401, "Not signed in"))?;
        let not_found = || error(404, "Requested entity was not found.");
        let strings = |v: &Value| -> Vec<String> {
            v.as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|s| s.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default()
        };
        match (method, seg.as_slice()) {
            ("GET", ["profile"]) => Ok(json!({
                "emailAddress": mb.email,
                "historyId": mb.history_id.to_string(),
                "messagesTotal": mb.messages.len(),
            })),
            ("GET", ["labels"]) => Ok(mb.labels_json()),
            ("POST", ["labels"]) => {
                let name = body["name"].as_str().unwrap_or_default();
                if name.is_empty() || mb.labels.iter().any(|l| l.name == name) {
                    return Err(error(409, "Label name exists or conflicts"));
                }
                let id = mb.create_label(name, None, None);
                mb.label_json(&id).ok_or_else(not_found)
            }
            ("PATCH", ["labels", id]) => {
                let label = mb.labels.iter_mut().find(|l| l.id == *id);
                let label = label.ok_or_else(not_found)?;
                if let Some(name) = body["name"].as_str() {
                    label.name = name.to_string();
                }
                mb.label_json(id).ok_or_else(not_found)
            }
            ("DELETE", ["labels", id]) => match mb.delete_label(id) {
                true => Ok(json!({})),
                false => Err(not_found()),
            },
            ("GET", ["threads"]) => {
                let ids = mb.find_threads(q.label(), q.get("q"), q.spam_trash(), now);
                Ok(page(ids, q, "threads", |id| json!({ "id": id })))
            }
            ("GET", ["threads", id]) => mb
                .thread_json(
                    id,
                    q.get("format").unwrap_or("full"),
                    &q.all("metadataHeaders"),
                )
                .ok_or_else(not_found),
            ("POST", ["threads", id, action]) => {
                let ids = mb.thread_message_ids(id);
                if ids.is_empty() {
                    return Err(not_found());
                }
                let (add, remove) = match *action {
                    "modify" => (
                        strings(&body["addLabelIds"]),
                        strings(&body["removeLabelIds"]),
                    ),
                    "trash" => (vec!["TRASH".to_string()], Vec::new()),
                    "untrash" => (Vec::new(), vec!["TRASH".to_string()]),
                    _ => return Err(not_found()),
                };
                mb.modify(&ids, &add, &remove);
                Ok(json!({ "id": id }))
            }
            ("GET", ["messages"]) => {
                let found: Vec<(String, String)> = mb
                    .find(q.label(), q.get("q"), q.spam_trash(), now)
                    .into_iter()
                    .map(|m| (m.id.clone(), m.thread_id.clone()))
                    .collect();
                Ok(page(
                    found,
                    q,
                    "messages",
                    |(id, thread)| json!({ "id": id, "threadId": thread }),
                ))
            }
            ("POST", ["messages", "batchModify"]) => {
                let ids = strings(&body["ids"]);
                mb.modify(
                    &ids,
                    &strings(&body["addLabelIds"]),
                    &strings(&body["removeLabelIds"]),
                );
                Ok(json!({}))
            }
            ("GET", ["messages", id]) => mb
                .message_json(
                    id,
                    q.get("format").unwrap_or("full"),
                    &q.all("metadataHeaders"),
                )
                .ok_or_else(not_found),
            ("GET", ["messages", id, "attachments", attachment]) => {
                let bytes = mb.attachment(id, attachment).ok_or_else(not_found)?;
                Ok(json!({
                    "size": bytes.len(),
                    "data": crate::gmail::parse::encode_base64url(bytes),
                }))
            }
            ("GET", ["drafts"]) => Ok(mb.drafts_json()),
            ("DELETE", ["drafts", id]) => match mb.delete_draft(id) {
                true => Ok(json!({})),
                false => Err(not_found()),
            },
            ("GET", ["history"]) => {
                let start = q
                    .get("startHistoryId")
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(0);
                Ok(mb.history_json(start))
            }
            ("GET", ["settings", "sendAs"]) => Ok(json!({ "sendAs": [send_as(mb)] })),
            ("PATCH", ["settings", "sendAs", email]) if *email == mb.email => {
                mb.signature = body["signature"].as_str().map(str::to_string);
                Ok(send_as(mb))
            }
            ("GET", ["settings", "vacation"]) => Ok(json!(mb.vacation)),
            ("PUT", ["settings", "vacation"]) => {
                mb.vacation = serde_json::from_value(body).unwrap_or_default();
                Ok(json!(mb.vacation))
            }
            ("GET", ["settings", "filters"]) => Ok(json!({ "filter": mb.filters })),
            ("GET", ["settings", "filters", id]) => mb
                .filters
                .iter()
                .find(|f| f.id.as_deref() == Some(*id))
                .map(|f| json!(f))
                .ok_or_else(not_found),
            ("POST", ["settings", "filters"]) => {
                let mut filter: Filter = serde_json::from_value(body).unwrap_or_default();
                filter.id = Some(format!("ANe1Bmj{}", mb.filters.len() + 1));
                mb.filters.push(filter.clone());
                Ok(json!(filter))
            }
            ("DELETE", ["settings", "filters", id]) => {
                let before = mb.filters.len();
                mb.filters.retain(|f| f.id.as_deref() != Some(*id));
                match mb.filters.len() < before {
                    true => Ok(json!({})),
                    false => Err(not_found()),
                }
            }
            _ => Err(not_found()),
        }
    }

    /// Sending and saving drafts: JSON metadata, then the message.
    fn upload(
        &self,
        account: &str,
        method: &str,
        rest: &str,
        content_type: &str,
        body: &[u8],
    ) -> std::result::Result<Value, (u16, Value)> {
        let bad = || error(400, "Bad upload");
        let boundary = boundary(content_type).ok_or_else(bad)?;
        let parts = multipart(body, &boundary);
        let metadata: Value = parts
            .first()
            .and_then(|p| serde_json::from_slice(p).ok())
            .unwrap_or(Value::Null);
        let raw = parts.get(1).ok_or_else(bad)?.to_vec();
        let now = now_millis() as u64;
        match (method, rest) {
            ("POST", "messages/send") => {
                let thread = metadata["threadId"].as_str();
                let (id, thread_id) = {
                    let mut state = self.state.lock().unwrap();
                    let mb = state.mailboxes.get_mut(account).ok_or_else(bad)?;
                    mb.add(raw, thread, BTreeSet::from(["SENT".to_string()]), now)
                };
                self.answer_later(account, &id);
                Ok(json!({ "id": id, "threadId": thread_id, "labelIds": ["SENT"] }))
            }
            ("POST", "drafts") | ("PUT", _) => {
                let draft = rest.strip_prefix("drafts/");
                let thread = metadata["message"]["threadId"].as_str();
                let mut state = self.state.lock().unwrap();
                let mb = state.mailboxes.get_mut(account).ok_or_else(bad)?;
                Ok(mb.save_draft(draft, raw, thread, now))
            }
            _ => Err(error(404, "Not found")),
        }
    }

    /// The person you wrote to answers a little later: with the
    /// conversation's scripted reply, or the general one.
    fn answer_later(&self, account: &str, sent: &str) {
        let google = self.clone();
        let account = account.to_string();
        let sent = sent.to_string();
        tokio::spawn(async move {
            tokio::time::sleep(google.timing.reply_after).await;
            let answered = google.state.lock().unwrap().answer(&account, &sent);
            if answered.is_ok_and(|a| a) {
                google.changed(&account);
            }
        });
    }

    fn batch(&self, account: &str, content_type: &str, body: &[u8]) -> (u16, String, Vec<u8>) {
        let Some(boundary) = boundary(content_type) else {
            return json_reply(Err(error(400, "Bad batch")));
        };
        let mut out = String::new();
        for (i, part) in multipart(body, &boundary).iter().enumerate() {
            let text = String::from_utf8_lossy(part);
            let target = text
                .lines()
                .find_map(|l| l.strip_prefix("GET "))
                .map(|t| t.split_whitespace().next().unwrap_or_default().to_string())
                .unwrap_or_default();
            let headers =
                HashMap::from([("authorization".to_string(), format!("Bearer {account}"))]);
            let (status, _, json) = self.respond("GET", &target, &headers, &[]);
            out.push_str(&format!(
                "--batch_demo\r\nContent-Type: application/http\r\nContent-ID: <response-item{i}>\r\n\r\nHTTP/1.1 {status} {}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{}\r\n",
                reason(status),
                String::from_utf8_lossy(&json)
            ));
        }
        out.push_str("--batch_demo--\r\n");
        (
            200,
            "multipart/mixed; boundary=batch_demo".into(),
            out.into_bytes(),
        )
    }

    fn people(&self, account: &str, others: bool) -> Value {
        let state = self.state.lock().unwrap();
        let Some(mb) = state.mailboxes.get(account) else {
            return json!({});
        };
        let person = |name: &str, email: &str| json!({ "names": [{ "displayName": name }], "emailAddresses": [{ "value": email }] });
        if others {
            let saved: Vec<&str> = mb.contacts.iter().map(|(_, e)| e.as_str()).collect();
            let mut seen = BTreeSet::new();
            let list: Vec<Value> = state
                .data
                .people
                .values()
                .filter(|p| !saved.contains(&p.email.as_str()))
                .filter(|p| {
                    mb.messages
                        .values()
                        .any(|m| m.from_email == p.email || m.to_emails.contains(&p.email))
                })
                .filter(|p| seen.insert(p.email.clone()))
                .map(|p| person(&p.name, &p.email))
                .collect();
            json!({ "otherContacts": list })
        } else {
            let list: Vec<Value> = mb.contacts.iter().map(|(n, e)| person(n, e)).collect();
            json!({ "connections": list })
        }
    }

    fn calendar(
        &self,
        account: &str,
        method: &str,
        rest: &str,
        q: &Query,
        body: &[u8],
    ) -> std::result::Result<Value, (u16, Value)> {
        let mut state = self.state.lock().unwrap();
        let mb = state
            .mailboxes
            .get_mut(account)
            .ok_or_else(|| error(401, "Not signed in"))?;
        let mut body: Value = serde_json::from_slice(body).unwrap_or(Value::Null);
        let not_found = || error(404, "Not Found");
        let segments: Vec<&str> = rest.split('/').collect();
        match (method, segments.as_slice()) {
            ("GET", ["events"]) => {
                let items: Vec<&Value> = match q.get("iCalUID") {
                    Some(uid) => mb.events.iter().filter(|e| e["iCalUID"] == uid).collect(),
                    None => {
                        let (from, to) = (q.get("timeMin"), q.get("timeMax"));
                        mb.events.iter().filter(|e| overlaps(e, from, to)).collect()
                    }
                };
                Ok(json!({ "items": items }))
            }
            ("POST", ["events", "import"]) => {
                body["id"] = json!(format!("demoevent{}", mb.events.len() + 1));
                body["status"] = json!("confirmed");
                mb.events.push(body.clone());
                Ok(body)
            }
            ("PATCH", ["events", id]) => {
                let event = mb.events.iter_mut().find(|e| e["id"] == *id);
                let event = event.ok_or_else(not_found)?;
                let answer = body["attendees"][0]["responseStatus"].clone();
                if let Some(attendees) = event["attendees"].as_array_mut() {
                    for a in attendees {
                        if a["email"] == account {
                            a["responseStatus"] = answer.clone();
                        }
                    }
                }
                Ok(event.clone())
            }
            ("DELETE", ["events", id]) => {
                mb.events.retain(|e| e["id"] != *id);
                Ok(json!({}))
            }
            _ => Err(not_found()),
        }
    }
}

impl State {
    fn add_conversation(&mut self, email: &str, c: &Conversation, now: u64) -> Result<()> {
        let account = self
            .data
            .accounts
            .iter()
            .find(|a| a.email == email)
            .cloned()
            .ok_or_else(|| CoreError::Invalid(format!("demo mail: no account {email}")))?;
        let people = |keys: &[String]| -> Result<Vec<Person>> {
            keys.iter().map(|k| self.data.person(k, &account)).collect()
        };
        let first_subject = c
            .messages
            .first()
            .and_then(|m| m.subject.clone())
            .unwrap_or_default();
        // Whoever you're writing with: the first other sender, or the
        // first person you wrote to.
        let other = c
            .messages
            .iter()
            .find(|m| m.from != "me")
            .map(|m| m.from.clone())
            .or_else(|| {
                c.messages
                    .iter()
                    .find_map(|m| m.to.as_ref().and_then(|t| t.first().cloned()))
            })
            .unwrap_or_else(|| "me".into());
        let mut references: Vec<String> = Vec::new();
        let mut thread: Option<String> = None;
        let last = c.messages.len().saturating_sub(1);
        for (i, m) in c.messages.iter().enumerate() {
            let mine = m.from == "me";
            let from = self.data.person(&m.from, &account)?;
            let to = match &m.to {
                Some(keys) => people(keys)?,
                None if mine => people(std::slice::from_ref(&other))?,
                None => people(&["me".to_string()])?,
            };
            let cc = people(&m.cc)?;
            let subject = match &m.subject {
                Some(s) => s.clone(),
                None => format!("Re: {first_subject}"),
            };
            let date_ms = now.saturating_sub(data::ago_ms(&m.ago)?);
            let domain = from
                .email
                .rsplit_once('@')
                .map_or("demo.example", |(_, d)| d);
            let message_id = format!("{:016x}.{i}@{domain}", fastrand::u64(..));
            let raw = data::build(
                &data::Draft {
                    from: &from,
                    to: &to,
                    cc: &cc,
                    subject: &subject,
                    date_ms,
                    message_id: &message_id,
                    references: &references,
                    text: &m.text,
                    html: m.html.as_deref(),
                    attachments: &m.attachments,
                },
                now,
            )?;
            let mailbox = self
                .mailboxes
                .get_mut(email)
                .ok_or_else(|| CoreError::Invalid(format!("demo mail: no account {email}")))?;
            let mut labels = BTreeSet::new();
            if m.draft {
                labels.insert("DRAFT".to_string());
            } else {
                for l in &c.labels {
                    let id = mailbox.label_id(l);
                    let keep = match id.as_str() {
                        "STARRED" => i == last,
                        "INBOX" | "IMPORTANT" => !mine,
                        id if id.starts_with("CATEGORY_") => !mine,
                        _ => true,
                    };
                    if keep {
                        labels.insert(id);
                    }
                }
                if mine {
                    labels.insert("SENT".to_string());
                }
                if m.unread {
                    labels.insert("UNREAD".to_string());
                }
            }
            let (id, thread_id) = mailbox.add(raw, thread.as_deref(), labels, date_ms);
            if m.draft {
                mailbox.register_draft(&id);
            }
            thread = Some(thread_id);
            references.push(message_id);
        }
        if let Some(thread) = &thread {
            let brief: Vec<String> = c.brief.iter().map(|p| format!("- {p}")).collect();
            let kinds = [
                (SummaryKind::Line, c.summary.clone()),
                (
                    SummaryKind::Full,
                    (!brief.is_empty()).then(|| brief.join("\n")),
                ),
            ];
            for (kind, text) in kinds {
                if let Some(text) = text {
                    self.summaries.push(Summary {
                        account: email.to_string(),
                        thread: thread.clone(),
                        kind,
                        text,
                    });
                }
            }
        }
        if let (Some(reply), Some(thread)) = (&c.reply, thread) {
            self.replies
                .insert((email.to_string(), thread), reply.clone());
        }
        Ok(())
    }

    /// Adds the answer to a message you sent. False if nobody known would
    /// answer it.
    fn answer(&mut self, email: &str, sent: &str) -> Result<bool> {
        let Some(mailbox) = self.mailboxes.get(email) else {
            return Ok(false);
        };
        let Some(m) = mailbox.messages.get(sent) else {
            return Ok(false);
        };
        // Answering an invitation tells the organizer; nobody writes back.
        if find(&m.raw, b"text/calendar").is_some() {
            return Ok(false);
        }
        let thread = m.thread_id.clone();
        let responder = m.to_emails.iter().find_map(|address| {
            self.data
                .people
                .values()
                .find(|p| p.email.eq_ignore_ascii_case(address))
                .cloned()
        });
        let script = self
            .replies
            .get(&(email.to_string(), thread.clone()))
            .cloned()
            .or_else(|| self.data.default_reply.clone());
        let (Some(responder), Some(text)) = (responder, script) else {
            return Ok(false);
        };
        let me = Person {
            name: mailbox.name.clone(),
            email: mailbox.email.clone(),
        };
        let subject = if m.subject_text.to_lowercase().starts_with("re:") {
            m.subject_text.clone()
        } else {
            format!("Re: {}", m.subject_text)
        };
        let mut references = m.references.clone();
        references.extend(m.message_id.clone());
        let now = now_millis() as u64;
        let domain = responder
            .email
            .rsplit_once('@')
            .map_or("demo.example", |(_, d)| d);
        let raw = data::build(
            &data::Draft {
                from: &responder,
                to: std::slice::from_ref(&me),
                cc: &[],
                subject: &subject,
                date_ms: now,
                message_id: &format!("{:016x}.reply@{domain}", fastrand::u64(..)),
                references: &references,
                text: &text.replace("{name}", first_name(&me.name)),
                html: None,
                attachments: &Vec::<AttachmentData>::new(),
            },
            now,
        )?;
        let labels = BTreeSet::from(["INBOX".to_string(), "UNREAD".to_string()]);
        if let Some(mailbox) = self.mailboxes.get_mut(email) {
            mailbox.add(raw, Some(&thread), labels, now);
        }
        Ok(true)
    }
}

fn first_name(name: &str) -> &str {
    name.split_whitespace().next().unwrap_or(name)
}

fn send_as(mb: &Mailbox) -> Value {
    json!({
        "sendAsEmail": mb.email,
        "displayName": mb.name,
        "signature": mb.signature,
        "isPrimary": true,
        "isDefault": true,
    })
}

/// Whether an event's start falls between two RFC 3339 times.
fn overlaps(event: &Value, from: Option<&str>, to: Option<&str>) -> bool {
    let parse = |s: &str| chrono::DateTime::parse_from_rfc3339(s).ok();
    let Some(start) = event["start"]["dateTime"].as_str().and_then(parse) else {
        return false;
    };
    from.and_then(parse).is_none_or(|f| start >= f) && to.and_then(parse).is_none_or(|t| start < t)
}

struct Query(Vec<(String, String)>);

impl Query {
    fn new(url: &url::Url) -> Self {
        Self(
            url.query_pairs()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
        )
    }

    fn get(&self, key: &str) -> Option<&str> {
        self.0
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.as_str())
    }

    fn all(&self, key: &str) -> Vec<String> {
        self.0
            .iter()
            .filter(|(k, _)| k == key)
            .map(|(_, v)| v.clone())
            .collect()
    }

    fn label(&self) -> Option<&str> {
        self.get("labelIds")
    }

    fn spam_trash(&self) -> bool {
        self.get("includeSpamTrash") == Some("true")
    }
}

/// One page of a list (`pageToken` is how far in it starts).
fn page<T>(items: Vec<T>, q: &Query, key: &str, to_json: impl Fn(&T) -> Value) -> Value {
    let start: usize = q.get("pageToken").and_then(|t| t.parse().ok()).unwrap_or(0);
    let size: usize = q
        .get("maxResults")
        .and_then(|m| m.parse().ok())
        .unwrap_or(100)
        .max(1);
    let end = (start + size).min(items.len());
    let shown: Vec<Value> = items
        .get(start..end)
        .unwrap_or_default()
        .iter()
        .map(to_json)
        .collect();
    let mut out = json!({ key: shown, "resultSizeEstimate": items.len() });
    if end < items.len() {
        out["nextPageToken"] = json!(end.to_string());
    }
    out
}

fn error(status: u16, message: &str) -> (u16, Value) {
    (
        status,
        json!({ "error": { "code": status, "message": message, "errors": [{ "reason": "demo" }] } }),
    )
}

fn json_reply(reply: std::result::Result<Value, (u16, Value)>) -> (u16, String, Vec<u8>) {
    let (status, value) = match reply {
        Ok(v) => (200, v),
        Err(e) => e,
    };
    (
        status,
        "application/json; charset=UTF-8".into(),
        value.to_string().into_bytes(),
    )
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        409 => "Conflict",
        _ => "Error",
    }
}

fn boundary(content_type: &str) -> Option<String> {
    content_type.split(';').find_map(|p| {
        let (k, v) = p.split_once('=')?;
        k.trim()
            .eq_ignore_ascii_case("boundary")
            .then(|| v.trim().trim_matches('"').to_string())
    })
}

/// The bodies of a multipart body's parts (each part's headers dropped).
fn multipart<'a>(body: &'a [u8], boundary: &str) -> Vec<&'a [u8]> {
    let delimiter = format!("--{boundary}");
    let mut parts = Vec::new();
    let mut rest = body;
    let Some(first) = find(rest, delimiter.as_bytes()) else {
        return parts;
    };
    rest = &rest[first + delimiter.len()..];
    while !rest.starts_with(b"--") {
        let end = find(rest, delimiter.as_bytes()).unwrap_or(rest.len());
        let part = &rest[..end];
        let part = part.strip_prefix(b"\r\n").unwrap_or(part);
        let part = part.strip_suffix(b"\r\n").unwrap_or(part);
        if let Some(i) = find(part, b"\r\n\r\n") {
            parts.push(&part[i + 4..]);
        }
        if end >= rest.len() {
            break;
        }
        rest = &rest[end + delimiter.len()..];
    }
    parts
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}
