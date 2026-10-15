//! Gmail REST client for one account. Handles auth headers, retries with
//! exponential backoff (429, 5xx, rate-limit 403s) and batch requests.

use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use reqwest::{Method, RequestBuilder, Response, StatusCode};
use serde::de::DeserializeOwned;

use super::batch;
use super::pacer::{cost, QuotaPacer};
use super::types::{ErrorEnvelope, HistoryList, LabelList, Message, Profile, Thread, ThreadList};
use crate::error::{CoreError, Result};

pub const GMAIL_BASE_URL: &str = "https://gmail.googleapis.com";

/// Headers requested with `format=metadata`.
pub const METADATA_HEADERS: [&str; 8] = [
    "From",
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

/// How many requests go into one batch call. Google allows 100, but advises
/// smaller batches to stay under per-user rate limits.
pub const BATCH_SIZE: usize = 40;

#[derive(Clone)]
pub struct GmailClient {
    http: reqwest::Client,
    base_url: String,
    tokens: Arc<dyn TokenSource>,
    retry: RetryPolicy,
    /// Shared by every clone of this client, so all calls for the account
    /// draw from one quota budget.
    pacer: QuotaPacer,
}

impl GmailClient {
    pub fn new(http: reqwest::Client, tokens: Arc<dyn TokenSource>) -> Self {
        Self::with_base_url(http, tokens, GMAIL_BASE_URL)
    }

    pub fn with_base_url(
        http: reqwest::Client,
        tokens: Arc<dyn TokenSource>,
        base_url: &str,
    ) -> Self {
        Self {
            http,
            base_url: base_url.trim_end_matches('/').to_string(),
            tokens,
            retry: RetryPolicy::default(),
            pacer: QuotaPacer::default(),
        }
    }

    pub fn with_pacer(mut self, pacer: QuotaPacer) -> Self {
        self.pacer = pacer;
        self
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

    pub async fn list_threads(
        &self,
        label: &str,
        page_token: Option<&str>,
        max_results: u32,
    ) -> Result<ThreadList> {
        let max = max_results.to_string();
        let mut query = vec![("labelIds", label), ("maxResults", max.as_str())];
        if let Some(token) = page_token {
            query.push(("pageToken", token));
        }
        self.get_json(&self.url("threads"), &query, cost::THREADS_LIST)
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
                for (slot, &index) in pending.iter().enumerate() {
                    match parts.get(slot) {
                        Some(part) if part.status == 200 => {
                            results[index] = Some(Some(serde_json::from_str(&part.body)?));
                        }
                        Some(part) if part.status == 404 => results[index] = Some(None),
                        Some(part) if part.status == 0 || is_retryable(part.status, &part.body) => {
                            retry_later.push(index)
                        }
                        Some(part) => return Err(api_error(part.status, &part.body)),
                        None => retry_later.push(index),
                    }
                }
                pending = retry_later;
                if !pending.is_empty() {
                    self.pacer.drain().await;
                    if attempt >= self.retry.max_retries {
                        return Err(CoreError::RateLimited(format!(
                            "{} batch items still failing after retries",
                            pending.len()
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
        self.pacer
            .acquire(cost::THREADS_GET * paths.len() as u32)
            .await;
        let boundary = format!("mailboat_batch_{}", fastrand::u64(..));
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
        self.pacer.acquire(units).await;
        let response = self
            .send(|| self.http.request(Method::GET, url).query(query))
            .await?;
        response.json::<T>().await.map_err(net_error)
    }

    /// Sends a request, adding auth and retrying transient failures.
    async fn send(&self, build: impl Fn() -> RequestBuilder) -> Result<Response> {
        let mut attempt = 0;
        let mut refreshed = false;
        loop {
            let token = self.tokens.access_token().await?;
            let result = build().bearer_auth(token).send().await;
            let response = match result {
                Ok(r) => r,
                Err(e)
                    if attempt < self.retry.max_retries && (e.is_timeout() || e.is_connect()) =>
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
            if is_retryable(status.as_u16(), &body) {
                if matches!(status.as_u16(), 403 | 429) {
                    self.pacer.drain().await;
                }
                if attempt >= self.retry.max_retries {
                    return Err(if status.as_u16() == 429 || status.as_u16() == 403 {
                        CoreError::RateLimited(error_message(&body))
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

fn error_message(body: &str) -> String {
    serde_json::from_str::<ErrorEnvelope>(body)
        .map(|e| e.error.message)
        .unwrap_or_else(|_| body.chars().take(200).collect())
}

fn api_error(status: u16, body: &str) -> CoreError {
    CoreError::Api {
        status,
        message: error_message(body),
    }
}

fn net_error(e: reqwest::Error) -> CoreError {
    CoreError::Network(e.to_string())
}
