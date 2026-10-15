//! Shared test helpers: fixtures and a fake token source.
#![allow(dead_code)]

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use mailboat_core::gmail::{GmailClient, RetryPolicy, TokenSource};
use mailboat_core::Result;

pub fn fixture(name: &str) -> String {
    let path = format!("{}/tests/fixtures/gmail/{name}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("fixture {path}: {e}"))
}

pub fn fixture_json(name: &str) -> serde_json::Value {
    serde_json::from_str(&fixture(name)).unwrap()
}

#[derive(Default)]
pub struct FakeTokens {
    pub invalidations: AtomicUsize,
}

#[async_trait]
impl TokenSource for FakeTokens {
    async fn access_token(&self) -> Result<String> {
        Ok(format!(
            "token-{}",
            self.invalidations.load(Ordering::SeqCst)
        ))
    }
    async fn invalidate(&self) {
        self.invalidations.fetch_add(1, Ordering::SeqCst);
    }
}

/// Retries quickly so tests don't sleep.
pub fn fast_retry() -> RetryPolicy {
    RetryPolicy {
        max_retries: 3,
        base_delay: Duration::from_millis(1),
        max_delay: Duration::from_millis(5),
    }
}

pub fn client(base_url: &str) -> (GmailClient, Arc<FakeTokens>) {
    let tokens = Arc::new(FakeTokens::default());
    let client = GmailClient::with_base_url(reqwest::Client::new(), tokens.clone(), base_url)
        .with_retry(fast_retry());
    (client, tokens)
}

/// A Google batch response with one part per (status, body), in order.
pub fn batch_response(parts: &[(u16, String)]) -> wiremock::ResponseTemplate {
    let mut body = String::new();
    for (i, (status, json)) in parts.iter().enumerate() {
        body.push_str(&format!(
            "--batch_test\r\nContent-Type: application/http\r\nContent-ID: <response-item{i}>\r\n\r\nHTTP/1.1 {status} X\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{json}\r\n"
        ));
    }
    body.push_str("--batch_test--\r\n");
    wiremock::ResponseTemplate::new(200).set_body_raw(body, "multipart/mixed; boundary=batch_test")
}

/// Answers Gmail batch calls by looking up each requested thread ID in a
/// map of fixture files. Unknown IDs get a 404 part (thread deleted).
pub struct BatchResponder(pub std::collections::HashMap<&'static str, &'static str>);

impl wiremock::Respond for BatchResponder {
    fn respond(&self, request: &wiremock::Request) -> ResponseTemplate {
        let body = String::from_utf8_lossy(&request.body);
        let parts: Vec<(u16, String)> = body
            .split("/threads/")
            .skip(1)
            .map(|rest| {
                let id = rest.split('?').next().unwrap_or_default();
                match self.0.get(id) {
                    Some(file) => (200, fixture(file)),
                    None => (404, fixture("error_404.json")),
                }
            })
            .collect();
        batch_response(&parts)
    }
}

use wiremock::ResponseTemplate;

/// Mounts profile, labels and thread listings for the standard scenario.
pub async fn mount_mailbox(server: &wiremock::MockServer) {
    use wiremock::matchers::{path, query_param, query_param_is_missing};
    use wiremock::Mock;
    let json = |f: &str| ResponseTemplate::new(200).set_body_raw(fixture(f), "application/json");
    Mock::given(path("/gmail/v1/users/me/profile"))
        .respond_with(json("profile.json"))
        .mount(server)
        .await;
    Mock::given(path("/gmail/v1/users/me/labels"))
        .respond_with(json("labels.json"))
        .mount(server)
        .await;
    Mock::given(path("/gmail/v1/users/me/threads"))
        .and(query_param("labelIds", "INBOX"))
        .and(query_param_is_missing("pageToken"))
        .respond_with(json("threads_inbox_page1.json"))
        .mount(server)
        .await;
    Mock::given(path("/gmail/v1/users/me/threads"))
        .and(query_param("labelIds", "INBOX"))
        .and(query_param("pageToken", "page2"))
        .respond_with(json("threads_inbox_page2.json"))
        .mount(server)
        .await;
    Mock::given(path("/gmail/v1/users/me/threads"))
        .and(query_param("labelIds", "STARRED"))
        .respond_with(json("threads_starred.json"))
        .mount(server)
        .await;
    Mock::given(path("/gmail/v1/users/me/threads"))
        .and(query_param("labelIds", "SENT"))
        .respond_with(json("threads_sent.json"))
        .mount(server)
        .await;
}
