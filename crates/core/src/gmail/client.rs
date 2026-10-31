//! Gmail REST client for one account. Handles auth headers, retries with
//! exponential backoff (429, 5xx, rate-limit 403s) and batch requests.

use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use reqwest::{Method, RequestBuilder, Response, StatusCode};
use serde::de::DeserializeOwned;

use super::batch;
use super::pacer::{cost, QuotaPacer};
use super::types::{
    AttachmentBody, DraftList, DraftRef, ErrorEnvelope, Filter, FilterList, HistoryList, LabelList,
    Message, MessageList, MessageRef, PeoplePage, Profile, RawMessage, SendAs, SendAsList, Thread,
    ThreadList, Vacation,
};
use crate::error::{CoreError, Result};

pub const GMAIL_BASE_URL: &str = "https://gmail.googleapis.com";
pub const PEOPLE_BASE_URL: &str = "https://people.googleapis.com";
pub const CALENDAR_BASE_URL: &str = "https://www.googleapis.com";

/// Headers requested with `format=metadata`.
pub const METADATA_HEADERS: [&str; 9] = [
    "From",
    "Reply-To",
    "To",
    "Cc",
    "Subject",
    "Date",
    "Message-ID",
    "In-Reply-To",
    "References",
];

/// Supplies access tokens for one account. `invalidate` is called after a
/// 401 so the next `access_token` call refreshes.
#[async_trait]
pub trait TokenSource: Send + Sync {
    async fn access_token(&self) -> Result<String>;
    async fn invalidate(&self);
}

#[derive(Debug, Clone)]
pub struct RetryPolicy {
    pub max_retries: u32,
    pub base_delay: Duration,
    pub max_delay: Duration,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self {
            max_retries: 6,
            base_delay: Duration::from_secs(1),
            max_delay: Duration::from_secs(32),
        }
    }
}

impl RetryPolicy {
    /// Exponential backoff with full jitter, honoring Retry-After if given.
    pub fn delay(&self, attempt: u32, retry_after: Option<Duration>) -> Duration {
        if let Some(after) = retry_after {
            return after.min(self.max_delay);
        }
        let exp = self.base_delay.saturating_mul(1u32 << attempt.min(16));
        let capped = exp.min(self.max_delay);
        let jitter = fastrand::f64() * 0.5 + 0.5; // 50–100% of the step
        capped.mul_f64(jitter)
    }
}

/// How many requests go into one batch call. Google allows 100, but a
/// batch's requests hit the quota all at once, and the per-user limit allows
/// only about 100 units per second. 5 threads.get = 50 units fits.
pub const BATCH_SIZE: usize = 5;

/// Receives diagnostic lines (rate limits, retries) for the sync log.
pub type Logger = Arc<dyn Fn(&str) + Send + Sync>;

#[derive(Clone)]
pub struct GmailClient {
    pub(crate) http: reqwest::Client,
    base_url: String,
    /// Google's People API (contacts), with the same sign-in.
    people_base_url: String,
    /// Google Calendar API (meeting invitations), with the same sign-in.
    pub(crate) calendar_base_url: String,
    tokens: Arc<dyn TokenSource>,
    retry: RetryPolicy,
    /// Shared by every clone of this client, so all calls for the account
    /// draw from one quota budget.
    pacer: QuotaPacer,
    log: Option<Logger>,
    /// Requests the user is waiting on skip ahead of background sync.
    interactive: bool,
}

impl GmailClient {
    pub fn new(http: reqwest::Client, tokens: Arc<dyn TokenSource>) -> Self {
        Self {
            people_base_url: PEOPLE_BASE_URL.into(),
            calendar_base_url: CALENDAR_BASE_URL.into(),
            ..Self::with_base_url(http, tokens, GMAIL_BASE_URL)
        }
    }

    pub fn with_base_url(
        http: reqwest::Client,
        tokens: Arc<dyn TokenSource>,
        base_url: &str,
    ) -> Self {
        Self {
            http,
            base_url: base_url.trim_end_matches('/').to_string(),
            // Tests point both at one mock server.
            people_base_url: base_url.trim_end_matches('/').to_string(),
            calendar_base_url: base_url.trim_end_matches('/').to_string(),
            tokens,
            retry: RetryPolicy::default(),
            pacer: QuotaPacer::default(),
            log: None,
            interactive: false,
        }
    }

    pub fn with_pacer(mut self, pacer: QuotaPacer) -> Self {
        self.pacer = pacer;
        self
    }

    /// The same account and quota budget, but for things the user is
    /// waiting on (opening a message): requests go ahead of background sync.
    pub fn interactive(&self) -> Self {
        Self {
            interactive: true,
            ..self.clone()
        }
    }

    pub fn with_logger(mut self, log: Logger) -> Self {
        self.log = Some(log);
        self
    }

    fn log(&self, line: &str) {
        if let Some(log) = &self.log {
            log(line);
        }
    }

    /// Slows this account down after Google reported a rate limit.
    async fn throttle(&self, what: &str, status: u16, body: &str) {
        // A per-minute quota only resets as its one-minute window rolls
        // forward; requests sent meanwhile are refused (and may count), so
        // stop entirely for a minute. Other limits get a short pause.
        let pause = if body.contains("per minute") {
            Duration::from_secs(60)
        } else {
            Duration::from_secs(5)
        };
        let rate = self.pacer.throttle(pause).await;
        self.log(&format!(
            "rate limited ({what}, HTTP {status}): {}; pausing {}s, then {rate:.0} units/s",
            diagnostic(body),
            pause.as_secs()
        ));
    }

    /// Spends quota before a call, logging usage once a minute.
    async fn spend(&self, units: u32) {
        let report = if self.interactive {
            self.pacer.acquire_now(units).await
        } else {
            self.pacer.acquire(units).await
        };
        if let Some(report) = report {
            self.log(&format!(
                "quota: {} units used in the last minute (rate now {:.0} units/s)",
                report.units, report.rate
            ));
        }
    }

    pub fn with_retry(mut self, retry: RetryPolicy) -> Self {
        self.retry = retry;
        self
    }

    fn url(&self, path: &str) -> String {
        format!("{}/gmail/v1/users/me/{}", self.base_url, path)
    }

    pub async fn profile(&self) -> Result<Profile> {
        self.get_json(&self.url("profile"), &[], cost::PROFILE)
            .await
    }

    pub async fn labels(&self) -> Result<LabelList> {
        self.get_json(&self.url("labels"), &[], cost::LABELS_LIST)
            .await
    }

    /// `labels.create`: a new user label, shown in lists as Gmail does.
    pub async fn create_label(&self, name: &str) -> Result<super::types::Label> {
        self.spend(cost::LABELS_CHANGE).await;
        let url = self.url("labels");
        let body = serde_json::json!({
            "name": name,
            "labelListVisibility": "labelShow",
            "messageListVisibility": "show",
        });
        let response = self
            .send_with(|| self.http.post(&url).json(&body), Retry::OnlyUnsent)
            .await?;
        response.json().await.map_err(net_error)
    }

    /// `labels.patch`: renames a user label.
    pub async fn rename_label(&self, id: &str, name: &str) -> Result<()> {
        self.spend(cost::LABELS_CHANGE).await;
        let url = self.url(&format!("labels/{id}"));
        let body = serde_json::json!({ "name": name });
        self.send(|| self.http.patch(&url).json(&body)).await?;
        Ok(())
    }

    /// `labels.delete`. Already gone counts as deleted.
    pub async fn delete_label(&self, id: &str) -> Result<()> {
        self.spend(cost::LABELS_CHANGE).await;
        let url = self.url(&format!("labels/{id}"));
        match self.send(|| self.http.delete(&url)).await {
            Ok(_) | Err(CoreError::NotFound(_)) => Ok(()),
            Err(e) => Err(e),
        }
    }

    /// `threads.list`, newest first. `None` lists All Mail (everything but
    /// Spam and Trash).
    pub async fn list_threads(
        &self,
        label: Option<&str>,
        page_token: Option<&str>,
        max_results: u32,
    ) -> Result<ThreadList> {
        self.search_threads(label, None, false, page_token, max_results)
            .await
    }

    /// `threads.list` with an optional Gmail search (`q`), newest first.
    /// Spam and Trash are left out unless `spam_trash` (or the label is
    /// one of them).
    pub async fn search_threads(
        &self,
        label: Option<&str>,
        q: Option<&str>,
        spam_trash: bool,
        page_token: Option<&str>,
        max_results: u32,
    ) -> Result<ThreadList> {
        let max = max_results.to_string();
        let mut query = vec![("maxResults", max.as_str())];
        if let Some(q) = q {
            query.push(("q", q));
        }
        if let Some(label) = label {
            query.push(("labelIds", label));
        }
        if spam_trash || matches!(label, Some("SPAM" | "TRASH")) {
            query.push(("includeSpamTrash", "true"));
        }
        if let Some(token) = page_token {
            query.push(("pageToken", token));
        }
        self.get_json(&self.url("threads"), &query, cost::THREADS_LIST)
            .await
    }

    /// `messages.list` for a Gmail search, newest first (IDs only).
    pub async fn search_message_ids(
        &self,
        q: &str,
        page_token: Option<&str>,
        max_results: u32,
    ) -> Result<MessageList> {
        let max = max_results.to_string();
        let mut query = vec![("q", q), ("maxResults", max.as_str())];
        if let Some(token) = page_token {
            query.push(("pageToken", token));
        }
        self.get_json(&self.url("messages"), &query, cost::MESSAGES_LIST)
            .await
    }

    /// `messages.list` for one label, Spam and Trash included (IDs only).
    pub async fn label_message_ids(
        &self,
        label: &str,
        page_token: Option<&str>,
        max_results: u32,
    ) -> Result<MessageList> {
        let max = max_results.to_string();
        let mut query = vec![
            ("labelIds", label),
            ("includeSpamTrash", "true"),
            ("maxResults", max.as_str()),
        ];
        if let Some(token) = page_token {
            query.push(("pageToken", token));
        }
        self.get_json(&self.url("messages"), &query, cost::MESSAGES_LIST)
            .await
    }

    /// `threads.get` with `format=metadata`. `Ok(None)` if the thread is gone.
    pub async fn thread_metadata(&self, id: &str) -> Result<Option<Thread>> {
        let mut query = vec![("format", "metadata")];
        query.extend(METADATA_HEADERS.iter().map(|h| ("metadataHeaders", *h)));
        match self
            .get_json(
                &self.url(&format!("threads/{id}")),
                &query,
                cost::THREADS_GET,
            )
            .await
        {
            Ok(t) => Ok(Some(t)),
            Err(CoreError::NotFound(_)) => Ok(None),
            Err(e) => Err(e),
        }
    }

    pub async fn message_full(&self, id: &str) -> Result<Message> {
        self.get_json(
            &self.url(&format!("messages/{id}")),
            &[("format", "full")],
            cost::MESSAGES_GET,
        )
        .await
    }

    /// `messages.get` with `format=raw`: the email exactly as it arrived.
    pub async fn message_raw(&self, id: &str) -> Result<Vec<u8>> {
        let message: RawMessage = self
            .get_json(
                &self.url(&format!("messages/{id}")),
                &[("format", "raw")],
                cost::MESSAGES_GET,
            )
            .await?;
        super::parse::decode_base64url(&message.raw)
            .ok_or_else(|| CoreError::Other("the original email was not valid base64".into()))
    }

    /// `messages.get` with `format=metadata`: one message's headers.
    pub async fn message_metadata(&self, id: &str) -> Result<Message> {
        let mut query = vec![("format", "metadata")];
        query.extend(METADATA_HEADERS.iter().map(|h| ("metadataHeaders", *h)));
        self.get_json(
            &self.url(&format!("messages/{id}")),
            &query,
            cost::MESSAGES_GET,
        )
        .await
    }

    /// `settings.sendAs.list`: the main address and any aliases.
    pub async fn send_as(&self) -> Result<SendAsList> {
        self.get_json(&self.url("settings/sendAs"), &[], cost::SETTINGS_GET)
            .await
    }

    /// `settings.sendAs.patch` with only the signature (the one part of an
    /// address `gmail.settings.basic` may change).
    pub async fn set_signature(&self, email: &str, html: &str) -> Result<SendAs> {
        self.spend(cost::SEND_AS_CHANGE).await;
        let url = self.url(&format!("settings/sendAs/{}", path_segment(email)));
        let body = serde_json::json!({ "signature": html });
        let response = self.send(|| self.http.patch(&url).json(&body)).await?;
        response.json().await.map_err(net_error)
    }

    /// `settings.getVacation`: the vacation responder.
    pub async fn vacation(&self) -> Result<Vacation> {
        self.get_json(&self.url("settings/vacation"), &[], cost::SETTINGS_GET)
            .await
    }

    /// `settings.updateVacation`: replaces the vacation responder settings.
    pub async fn set_vacation(&self, vacation: &Vacation) -> Result<Vacation> {
        self.spend(cost::SETTINGS_CHANGE).await;
        let url = self.url("settings/vacation");
        let response = self.send(|| self.http.put(&url).json(vacation)).await?;
        response.json().await.map_err(net_error)
    }

    /// `settings.filters.list`: the account's rules.
    pub async fn filters(&self) -> Result<FilterList> {
        self.get_json(&self.url("settings/filters"), &[], cost::SETTINGS_GET)
            .await
    }

    /// `settings.filters.get`: one rule. `Ok(None)` if it's gone.
    pub async fn filter(&self, id: &str) -> Result<Option<Filter>> {
        match self
            .get_json(
                &self.url(&format!("settings/filters/{id}")),
                &[],
                cost::SETTINGS_GET,
            )
            .await
        {
            Ok(f) => Ok(Some(f)),
            Err(CoreError::NotFound(_)) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// `settings.filters.create`. Only retried when Google certainly
    /// didn't act, so a retry can't leave two copies.
    pub async fn create_filter(&self, filter: &Filter) -> Result<Filter> {
        self.spend(cost::SETTINGS_CHANGE).await;
        let url = self.url("settings/filters");
        let response = self
            .send_with(|| self.http.post(&url).json(filter), Retry::OnlyUnsent)
            .await?;
        response.json().await.map_err(net_error)
    }

    /// `settings.filters.delete`. Already gone counts as deleted.
    pub async fn delete_filter(&self, id: &str) -> Result<()> {
        self.spend(cost::SETTINGS_CHANGE).await;
        let url = self.url(&format!("settings/filters/{id}"));
        match self.send(|| self.http.delete(&url)).await {
            Ok(_) | Err(CoreError::NotFound(_)) => Ok(()),
            Err(e) => Err(e),
        }
    }

    /// `messages.batchModify`: add/remove labels on up to 1,000 messages.
    pub async fn batch_modify_messages(
        &self,
        ids: &[String],
        add: &[String],
        remove: &[String],
    ) -> Result<()> {
        self.spend(cost::MESSAGES_BATCH_MODIFY).await;
        let url = self.url("messages/batchModify");
        let body = serde_json::json!({
            "ids": ids,
            "addLabelIds": add,
            "removeLabelIds": remove,
        });
        self.send(|| self.http.post(&url).json(&body)).await?;
        Ok(())
    }

    /// `messages.send` with a complete RFC 5322 message. `thread_id` puts it
    /// in that Gmail thread (the subject and References must match too).
    ///
    /// Never retried after the request may have reached Google (timeouts,
    /// server errors): the mail might have gone, and a retry would send it
    /// twice. Rate limits and connection failures happen before Gmail
    /// accepts anything, so those still retry.
    pub async fn send_message(&self, raw: &[u8], thread_id: Option<&str>) -> Result<MessageRef> {
        self.spend(cost::MESSAGES_SEND).await;
        let metadata = match thread_id {
            Some(thread) => serde_json::json!({ "threadId": thread }),
            None => serde_json::json!({}),
        };
        self.upload(
            Method::POST,
            "messages/send",
            &metadata,
            raw,
            Retry::OnlyUnsent,
        )
        .await
    }

    /// `drafts.create`: saves a new draft (in `thread_id`'s conversation).
    /// A retried create could leave a second draft, so like sending it
    /// only retries when Google certainly didn't act.
    pub async fn create_draft(&self, raw: &[u8], thread_id: Option<&str>) -> Result<DraftRef> {
        self.spend(cost::DRAFTS_CREATE).await;
        let metadata = serde_json::json!({ "message": thread_message(thread_id) });
        self.upload(Method::POST, "drafts", &metadata, raw, Retry::OnlyUnsent)
            .await
    }

    /// `drafts.update`: replaces a draft's content (safe to retry).
    pub async fn update_draft(
        &self,
        id: &str,
        raw: &[u8],
        thread_id: Option<&str>,
    ) -> Result<DraftRef> {
        self.spend(cost::DRAFTS_UPDATE).await;
        let metadata = serde_json::json!({ "id": id, "message": thread_message(thread_id) });
        self.upload(
            Method::PUT,
            &format!("drafts/{id}"),
            &metadata,
            raw,
            Retry::Transient,
        )
        .await
    }

    /// People API `people.connections.list`: the account's saved contacts
    /// (names and addresses only). Not Gmail quota, so no pacing.
    pub async fn contacts_page(&self, page_token: Option<&str>) -> Result<PeoplePage> {
        let url = format!("{}/v1/people/me/connections", self.people_base_url);
        let mut query = vec![
            ("personFields", "names,emailAddresses"),
            ("pageSize", "1000"),
        ];
        if let Some(t) = page_token {
            query.push(("pageToken", t));
        }
        let response = self.send(|| self.http.get(&url).query(&query)).await?;
        response.json().await.map_err(net_error)
    }

    /// People API `otherContacts.list`: people Gmail saved automatically
    /// because the account exchanged mail with them.
    pub async fn other_contacts_page(&self, page_token: Option<&str>) -> Result<PeoplePage> {
        let url = format!("{}/v1/otherContacts", self.people_base_url);
        let mut query = vec![("readMask", "names,emailAddresses"), ("pageSize", "1000")];
        if let Some(t) = page_token {
            query.push(("pageToken", t));
        }
        let response = self.send(|| self.http.get(&url).query(&query)).await?;
        response.json().await.map_err(net_error)
    }

    /// `drafts.list`: every draft's ID with its message (one page of up to
    /// 500; more drafts than that are rare).
    pub async fn list_drafts(&self) -> Result<DraftList> {
        self.get_json(
            &self.url("drafts"),
            &[("maxResults", "500")],
            cost::DRAFTS_LIST,
        )
        .await
    }

    /// `drafts.delete`. A draft that's already gone counts as deleted.
    pub async fn delete_draft(&self, id: &str) -> Result<()> {
        self.spend(cost::DRAFTS_DELETE).await;
        let url = self.url(&format!("drafts/{id}"));
        match self.send(|| self.http.delete(&url)).await {
            Ok(_) | Err(CoreError::NotFound(_)) => Ok(()),
            Err(e) => Err(e),
        }
    }

    /// A message upload (`uploadType=multipart`: JSON metadata, then the
    /// RFC 5322 message), which takes messages up to 35 MB.
    async fn upload<T: DeserializeOwned>(
        &self,
        method: Method,
        path: &str,
        metadata: &serde_json::Value,
        raw: &[u8],
        retry: Retry,
    ) -> Result<T> {
        let url = format!(
            "{}/upload/gmail/v1/users/me/{path}?uploadType=multipart",
            self.base_url
        );
        let boundary = format!("upload_boundary_{:016x}", fastrand::u64(..));
        let mut body = format!(
            "--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{metadata}\r\n--{boundary}\r\nContent-Type: message/rfc822\r\n\r\n"
        )
        .into_bytes();
        body.extend_from_slice(raw);
        body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
        let content_type = format!("multipart/related; boundary={boundary}");
        let response = self
            .send_with(
                || {
                    self.http
                        .request(method.clone(), &url)
                        .header("Content-Type", &content_type)
                        .body(body.clone())
                },
                retry,
            )
            .await?;
        response.json().await.map_err(net_error)
    }

    /// `threads.modify`: add/remove labels on every message of a thread.
    pub async fn modify_thread(&self, id: &str, add: &[&str], remove: &[&str]) -> Result<()> {
        self.spend(cost::THREADS_MODIFY).await;
        let url = self.url(&format!("threads/{id}/modify"));
        let body = serde_json::json!({ "addLabelIds": add, "removeLabelIds": remove });
        self.send(|| self.http.post(&url).json(&body)).await?;
        Ok(())
    }

    /// `threads.trash`: moves every message of a thread to the Trash.
    pub async fn trash_thread(&self, id: &str) -> Result<()> {
        self.post_empty(&format!("threads/{id}/trash")).await
    }

    /// `threads.untrash`: takes every message of a thread out of the Trash.
    pub async fn untrash_thread(&self, id: &str) -> Result<()> {
        self.post_empty(&format!("threads/{id}/untrash")).await
    }

    async fn post_empty(&self, path: &str) -> Result<()> {
        self.spend(cost::THREADS_TRASH).await;
        let url = self.url(path);
        self.send(|| self.http.post(&url)).await?;
        Ok(())
    }

    /// `messages.attachments.get`: an attachment's bytes.
    pub async fn attachment(&self, message_id: &str, attachment_id: &str) -> Result<Vec<u8>> {
        let body: AttachmentBody = self
            .get_json(
                &self.url(&format!(
                    "messages/{message_id}/attachments/{attachment_id}"
                )),
                &[],
                cost::ATTACHMENTS_GET,
            )
            .await?;
        super::parse::decode_base64url(&body.data)
            .ok_or_else(|| CoreError::Other("attachment data was not valid base64".into()))
    }

    /// `history.list`. A 404 means the start ID is too old.
    pub async fn history(
        &self,
        start_history_id: u64,
        page_token: Option<&str>,
    ) -> Result<HistoryList> {
        let start = start_history_id.to_string();
        let mut query = vec![("startHistoryId", start.as_str()), ("maxResults", "500")];
        if let Some(token) = page_token {
            query.push(("pageToken", token));
        }
        match self
            .get_json(&self.url("history"), &query, cost::HISTORY_LIST)
            .await
        {
            Err(CoreError::NotFound(_)) => Err(CoreError::HistoryExpired),
            other => other,
        }
    }

    /// Fetches many threads' metadata using batch requests. Returns one entry
    /// per requested ID, in order; `None` for threads that no longer exist.
    /// Individual parts that were rate limited are retried with backoff.
    pub async fn batch_thread_metadata(&self, ids: &[String]) -> Result<Vec<Option<Thread>>> {
        let mut results: Vec<Option<Option<Thread>>> = vec![None; ids.len()];
        for chunk_start in (0..ids.len()).step_by(BATCH_SIZE) {
            let chunk_end = (chunk_start + BATCH_SIZE).min(ids.len());
            let mut pending: Vec<usize> = (chunk_start..chunk_end).collect();
            let mut attempt = 0;
            while !pending.is_empty() {
                let paths: Vec<String> = pending
                    .iter()
                    .map(|&i| {
                        let mut path =
                            format!("/gmail/v1/users/me/threads/{}?format=metadata", ids[i]);
                        for h in METADATA_HEADERS {
                            path.push_str("&metadataHeaders=");
                            path.push_str(h);
                        }
                        path
                    })
                    .collect();
                let parts = self.send_batch(&paths).await?;
                let mut retry_later = Vec::new();
                let mut limited: Option<(u16, String)> = None;
                for (slot, &index) in pending.iter().enumerate() {
                    match parts.get(slot) {
                        Some(part) if part.status == 200 => {
                            results[index] = Some(Some(serde_json::from_str(&part.body)?));
                        }
                        Some(part) if part.status == 404 => results[index] = Some(None),
                        Some(part) if part.status == 0 || is_retryable(part.status, &part.body) => {
                            if limited.is_none() {
                                limited = Some((part.status, part.body.clone()));
                            }
                            retry_later.push(index)
                        }
                        Some(part) => return Err(api_error(part.status, &part.body)),
                        None => retry_later.push(index),
                    }
                }
                pending = retry_later;
                if !pending.is_empty() {
                    let (status, body) = limited.unwrap_or_default();
                    self.throttle(
                        &format!("{} of {} batch items", pending.len(), paths.len()),
                        status,
                        &body,
                    )
                    .await;
                    if attempt >= self.retry.max_retries {
                        return Err(CoreError::RateLimited(format!(
                            "{} batch items still failing after retries: {}",
                            pending.len(),
                            diagnostic(&body)
                        )));
                    }
                    tokio::time::sleep(self.retry.delay(attempt, None)).await;
                    attempt += 1;
                }
            }
        }
        Ok(results.into_iter().map(|r| r.flatten()).collect())
    }

    async fn send_batch(&self, paths: &[String]) -> Result<Vec<batch::BatchPart>> {
        // Google charges each request inside a batch separately.
        self.spend(cost::THREADS_GET * paths.len() as u32).await;
        let boundary = format!("batch_boundary_{}", fastrand::u64(..));
        let body = batch::build_request(&boundary, paths);
        let url = format!("{}/batch/gmail/v1", self.base_url);
        let response = self
            .send(|| {
                self.http
                    .post(&url)
                    .header(
                        "Content-Type",
                        format!("multipart/mixed; boundary={boundary}"),
                    )
                    .body(body.clone())
            })
            .await?;
        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default()
            .to_string();
        let text = response.text().await.map_err(net_error)?;
        batch::parse_response(&content_type, &text, paths.len())
    }

    async fn get_json<T: DeserializeOwned>(
        &self,
        url: &str,
        query: &[(&str, &str)],
        units: u32,
    ) -> Result<T> {
        self.spend(units).await;
        let response = self
            .send(|| self.http.request(Method::GET, url).query(query))
            .await?;
        response.json::<T>().await.map_err(net_error)
    }

    /// Sends a request, adding auth and retrying transient failures.
    pub(crate) async fn send(&self, build: impl Fn() -> RequestBuilder) -> Result<Response> {
        self.send_with(build, Retry::Transient).await
    }

    async fn send_with(
        &self,
        build: impl Fn() -> RequestBuilder,
        retry: Retry,
    ) -> Result<Response> {
        let mut attempt = 0;
        let mut refreshed = false;
        loop {
            let token = self.tokens.access_token().await?;
            let result = build().bearer_auth(token).send().await;
            let response = match result {
                Ok(r) => r,
                Err(e)
                    if attempt < self.retry.max_retries
                        && (e.is_connect() || (e.is_timeout() && retry == Retry::Transient)) =>
                {
                    tokio::time::sleep(self.retry.delay(attempt, None)).await;
                    attempt += 1;
                    continue;
                }
                Err(e) => return Err(net_error(e)),
            };
            let status = response.status();
            if status.is_success() {
                return Ok(response);
            }
            if status == StatusCode::UNAUTHORIZED && !refreshed {
                self.tokens.invalidate().await;
                refreshed = true;
                continue;
            }
            let retry_after = response
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.trim().parse::<u64>().ok())
                .map(Duration::from_secs);
            let body = response.text().await.unwrap_or_default();
            let unsent = matches!(status.as_u16(), 403 | 429);
            if is_retryable(status.as_u16(), &body) && (retry == Retry::Transient || unsent) {
                if matches!(status.as_u16(), 403 | 429) {
                    self.throttle("request", status.as_u16(), &body).await;
                } else {
                    self.log(&format!("HTTP {status}, retrying: {}", diagnostic(&body)));
                }
                if attempt >= self.retry.max_retries {
                    return Err(if status.as_u16() == 429 || status.as_u16() == 403 {
                        CoreError::RateLimited(diagnostic(&body))
                    } else {
                        api_error(status.as_u16(), &body)
                    });
                }
                tokio::time::sleep(self.retry.delay(attempt, retry_after)).await;
                attempt += 1;
                continue;
            }
            return Err(match status {
                StatusCode::UNAUTHORIZED => CoreError::Auth(error_message(&body)),
                StatusCode::NOT_FOUND => CoreError::NotFound(error_message(&body)),
                _ => api_error(status.as_u16(), &body),
            });
        }
    }
}

/// An email address as one URL path segment (`+` and `@` are fine, but
/// anything else odd is escaped).
fn path_segment(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'@' | b'.' | b'-' | b'_' | b'+' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

fn thread_message(thread_id: Option<&str>) -> serde_json::Value {
    match thread_id {
        Some(thread) => serde_json::json!({ "threadId": thread }),
        None => serde_json::json!({}),
    }
}

/// Which failures a request may be sent again after.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Retry {
    /// Reads and idempotent changes: any transient failure.
    Transient,
    /// Sending mail: only failures where Google certainly didn't act.
    OnlyUnsent,
}

/// 429 and 5xx are retryable, and so are 403s whose reason is a rate limit
/// (Gmail reports per-user limits as 403 rateLimitExceeded).
fn is_retryable(status: u16, body: &str) -> bool {
    match status {
        429 | 500 | 502 | 503 | 504 => true,
        403 => serde_json::from_str::<ErrorEnvelope>(body).is_ok_and(|e| {
            e.error
                .errors
                .iter()
                .any(|i| i.reason == "rateLimitExceeded" || i.reason == "userRateLimitExceeded")
        }),
        _ => false,
    }
}

/// Google's documented error reason codes (Gmail, People and Calendar
/// share them). Only these are written out: plain words that aren't one
/// of them could still carry anything (code review R5-06).
const KNOWN_REASONS: &[&str] = &[
    "accessNotConfigured",
    "authError",
    "backendError",
    "badRequest",
    "conflict",
    "dailyLimitExceeded",
    "deleted",
    "domainPolicy",
    "duplicate",
    "failedPrecondition",
    "forbidden",
    "insufficientPermissions",
    "internalError",
    "invalid",
    "invalidArgument",
    "invalidParameter",
    "invalidQuery",
    "limitExceeded",
    "notFound",
    "parseError",
    "quotaExceeded",
    "rateLimitExceeded",
    "required",
    "serviceUnavailable",
    "unauthorized",
    "userRateLimitExceeded",
];

/// Google's reason codes ("rateLimitExceeded", "backendError"): the known
/// ones as they are, anything else as "other".
fn reasons(e: &ErrorEnvelope) -> Vec<&'static str> {
    let mut out: Vec<&'static str> = Vec::new();
    for item in &e.error.errors {
        if item.reason.is_empty() {
            continue;
        }
        let reason = KNOWN_REASONS
            .iter()
            .find(|k| **k == item.reason)
            .copied()
            .unwrap_or("other");
        if !out.contains(&reason) {
            out.push(reason);
        }
    }
    out
}

/// The message for a returned 4xx error, which the owner sees and the app
/// checks ("insufficient" permission, an API turned off): Google's message
/// and reason codes. Other bodies are never copied: proxy and captive
/// portal pages can echo request paths and queries into the sync log.
fn error_message(body: &str) -> String {
    match serde_json::from_str::<ErrorEnvelope>(body) {
        Ok(e) => {
            let reasons = reasons(&e);
            if reasons.is_empty() {
                e.error.message
            } else {
                format!("{} [{}]", e.error.message, reasons.join(", "))
            }
        }
        Err(_) => NOT_GMAIL.into(),
    }
}

const NOT_GMAIL: &str = "an answer that wasn't from Gmail";

/// For retry, throttle and rate-limit lines and server errors: Google's
/// reason codes only, never its message. An answer in Google's shape isn't
/// proof it came from Google (a proxy can send one, echoing the request),
/// and these say nothing the codes don't (code review R4-03).
fn diagnostic(body: &str) -> String {
    match serde_json::from_str::<ErrorEnvelope>(body) {
        Ok(e) => match reasons(&e).as_slice() {
            [] => "no reason given".into(),
            reasons => format!("[{}]", reasons.join(", ")),
        },
        Err(_) => NOT_GMAIL.into(),
    }
}

fn api_error(status: u16, body: &str) -> CoreError {
    CoreError::Api {
        status,
        message: if status >= 500 {
            format!("Gmail's servers had a problem: {}", diagnostic(body))
        } else {
            error_message(body)
        },
    }
}

/// A request that didn't get an answer, without its address: request URLs
/// carry Gmail IDs and search words, and this text reaches the sync log.
pub(crate) fn net_error(e: reqwest::Error) -> CoreError {
    CoreError::Network(e.without_url().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Proxy pages and malformed JSON can echo request paths and queries.
    /// Neither returned errors nor diagnostic detail may copy those bodies.
    #[test]
    fn error_answers_from_others_are_not_copied() {
        for body in [
            "<html>Blocked: GET /gmail/v1/users/me/messages/msgid123?q=secretword</html>",
            r#"{"message":"msgid123 secretword"}"#,
            r#"{"error":"msgid123 secretword"}"#,
            "",
        ] {
            assert_eq!(error_message(body), NOT_GMAIL);
            assert_eq!(diagnostic(body), NOT_GMAIL);
        }
        let google = r#"{"error":{"code":403,"message":"Insufficient Permission"}}"#;
        assert_eq!(error_message(google), "Insufficient Permission");
        let limited =
            r#"{"error":{"message":"Quota exceeded","errors":[{"reason":"rateLimitExceeded"}]}}"#;
        assert_eq!(error_message(limited), "Quota exceeded [rateLimitExceeded]");
    }

    /// Regression: a request that failed kept its URL in the error text,
    /// so the sync log recorded Gmail message IDs.
    #[tokio::test]
    async fn network_errors_leave_the_address_out() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let url =
            format!("http://127.0.0.1:{port}/gmail/v1/users/me/messages/msgid123?q=secretword");
        let err = reqwest::Client::new().get(&url).send().await.unwrap_err();
        assert!(
            err.to_string().contains("msgid123"),
            "reqwest's own text has it"
        );
        let text = net_error(err).to_string();
        assert!(
            !text.contains("msgid123") && !text.contains("secretword"),
            "{text}"
        );
    }
}
