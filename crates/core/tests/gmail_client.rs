//! Gmail client behavior against a mock server serving recorded-shape JSON.

mod common;

use std::sync::atomic::Ordering;

use common::*;
use mail_core::gmail::parse;
use mail_core::CoreError;
use wiremock::matchers::{header, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn ok_json(name: &str) -> ResponseTemplate {
    ResponseTemplate::new(200).set_body_raw(fixture(name), "application/json")
}

#[tokio::test]
async fn reads_profile_and_labels() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/gmail/v1/users/me/profile"))
        .and(header("authorization", "Bearer token-0"))
        .respond_with(ok_json("profile.json"))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/gmail/v1/users/me/labels"))
        .respond_with(ok_json("labels.json"))
        .mount(&server)
        .await;
    let (gmail, _) = client(&server.uri());

    let profile = gmail.profile().await.unwrap();
    assert_eq!(profile.email_address, "me@gmail.com");
    assert_eq!(profile.history_id, 9000);
    let labels = gmail.labels().await.unwrap().labels;
    let work = labels.iter().find(|l| l.id == "Label_1").unwrap();
    assert_eq!(work.name, "Work");
    assert_eq!(work.label_type.as_deref(), Some("user"));
}

#[tokio::test]
async fn sends_paging_parameters() {
    let server = MockServer::start().await;
    Mock::given(path("/gmail/v1/users/me/threads"))
        .and(query_param("labelIds", "INBOX"))
        .and(query_param("pageToken", "page2"))
        .respond_with(ok_json("threads_inbox_page2.json"))
        .mount(&server)
        .await;
    let (gmail, _) = client(&server.uri());
    let page = gmail
        .list_threads(Some("INBOX"), Some("page2"), 100)
        .await
        .unwrap();
    assert_eq!(page.threads[0].id, "t2");
    assert!(page.next_page_token.is_none());
}

#[tokio::test]
async fn retries_429_and_rate_limit_403_then_succeeds() {
    let server = MockServer::start().await;
    Mock::given(path("/gmail/v1/users/me/profile"))
        .respond_with(ResponseTemplate::new(429))
        .up_to_n_times(1)
        .with_priority(1)
        .mount(&server)
        .await;
    Mock::given(path("/gmail/v1/users/me/profile"))
        .respond_with(
            ResponseTemplate::new(403)
                .set_body_raw(fixture("error_rate_limit_403.json"), "application/json"),
        )
        .up_to_n_times(1)
        .with_priority(2)
        .mount(&server)
        .await;
    Mock::given(path("/gmail/v1/users/me/profile"))
        .respond_with(ok_json("profile.json"))
        .with_priority(3)
        .mount(&server)
        .await;
    let (gmail, _) = client(&server.uri());

    assert_eq!(gmail.profile().await.unwrap().history_id, 9000);
    assert_eq!(server.received_requests().await.unwrap().len(), 3);
}

#[tokio::test]
async fn gives_up_after_max_retries_with_rate_limited_error() {
    let server = MockServer::start().await;
    Mock::given(path("/gmail/v1/users/me/profile"))
        .respond_with(ResponseTemplate::new(429))
        .mount(&server)
        .await;
    let (gmail, _) = client(&server.uri());
    let err = gmail.profile().await.unwrap_err();
    assert!(matches!(err, CoreError::RateLimited(_)), "{err:?}");
    // 1 try + 3 retries
    assert_eq!(server.received_requests().await.unwrap().len(), 4);
}

#[tokio::test]
async fn server_errors_are_retried_but_client_errors_are_not() {
    let server = MockServer::start().await;
    Mock::given(path("/gmail/v1/users/me/profile"))
        .respond_with(ResponseTemplate::new(503))
        .up_to_n_times(2)
        .with_priority(1)
        .mount(&server)
        .await;
    Mock::given(path("/gmail/v1/users/me/profile"))
        .respond_with(ok_json("profile.json"))
        .with_priority(2)
        .mount(&server)
        .await;
    Mock::given(path("/gmail/v1/users/me/labels"))
        .respond_with(ResponseTemplate::new(400))
        .mount(&server)
        .await;
    let (gmail, _) = client(&server.uri());
    assert!(gmail.profile().await.is_ok());
    assert!(matches!(
        gmail.labels().await,
        Err(CoreError::Api { status: 400, .. })
    ));
}

#[tokio::test]
async fn refreshes_token_once_on_401() {
    let server = MockServer::start().await;
    Mock::given(path("/gmail/v1/users/me/profile"))
        .and(header("authorization", "Bearer token-0"))
        .respond_with(
            ResponseTemplate::new(401).set_body_raw(fixture("error_401.json"), "application/json"),
        )
        .mount(&server)
        .await;
    Mock::given(path("/gmail/v1/users/me/profile"))
        .and(header("authorization", "Bearer token-1"))
        .respond_with(ok_json("profile.json"))
        .mount(&server)
        .await;
    let (gmail, tokens) = client(&server.uri());
    assert!(gmail.profile().await.is_ok());
    assert_eq!(tokens.invalidations.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn persistent_401_is_an_auth_error() {
    let server = MockServer::start().await;
    Mock::given(path("/gmail/v1/users/me/profile"))
        .respond_with(
            ResponseTemplate::new(401).set_body_raw(fixture("error_401.json"), "application/json"),
        )
        .mount(&server)
        .await;
    let (gmail, _) = client(&server.uri());
    assert!(matches!(gmail.profile().await, Err(CoreError::Auth(_))));
}

#[tokio::test]
async fn expired_history_id_is_reported() {
    let server = MockServer::start().await;
    Mock::given(path("/gmail/v1/users/me/history"))
        .respond_with(
            ResponseTemplate::new(404).set_body_raw(fixture("error_404.json"), "application/json"),
        )
        .mount(&server)
        .await;
    let (gmail, _) = client(&server.uri());
    assert!(matches!(
        gmail.history(1, None).await,
        Err(CoreError::HistoryExpired)
    ));
}

#[tokio::test]
async fn batch_fetches_threads_and_retries_rate_limited_parts() {
    let server = MockServer::start().await;
    // First call: t1 ok, t2 rate limited, t-gone missing.
    Mock::given(method("POST"))
        .and(path("/batch/gmail/v1"))
        .respond_with(batch_response(&[
            (200, fixture("thread_t1.json")),
            (429, "{}".into()),
            (404, fixture("error_404.json")),
        ]))
        .up_to_n_times(1)
        .with_priority(1)
        .mount(&server)
        .await;
    // Retry contains only t2.
    Mock::given(method("POST"))
        .and(path("/batch/gmail/v1"))
        .respond_with(batch_response(&[(200, fixture("thread_t2.json"))]))
        .with_priority(2)
        .mount(&server)
        .await;
    let (gmail, _) = client(&server.uri());

    let ids = vec!["t1".to_string(), "t2".to_string(), "t-gone".to_string()];
    let threads = gmail.batch_thread_metadata(&ids).await.unwrap();
    assert_eq!(threads[0].as_ref().unwrap().messages.len(), 2);
    assert_eq!(threads[1].as_ref().unwrap().id, "t2");
    assert!(threads[2].is_none());

    let requests = server.received_requests().await.unwrap();
    assert_eq!(requests.len(), 2);
    let second = String::from_utf8(requests[1].body.clone()).unwrap();
    assert!(second.contains("/threads/t2?format=metadata"));
    assert!(!second.contains("/threads/t1?"));
}

#[test]
fn parses_thread_metadata_into_store_input() {
    let thread: mail_core::gmail::types::Thread =
        serde_json::from_str(&fixture("thread_t1.json")).unwrap();
    let incoming = parse::thread_to_incoming(&thread);
    assert_eq!(incoming.messages.len(), 2);
    let reply = &incoming.messages[1];
    assert_eq!(reply.subject, "Re: Lunch Friday");
    assert_eq!(
        reply.from.as_ref().unwrap().name.as_deref(),
        Some("Bob Smith")
    );
    assert_eq!(reply.cc[0].name.as_deref(), Some("Doe, Jane"));
    assert_eq!(reply.snippet, "Yes! See you at noon & bring the plan.");
    assert_eq!(reply.internal_date, 1_760_003_600_000);
    assert_eq!(reply.in_reply_to.as_deref(), Some("<a1@example.com>"));
    assert!(reply.label_ids.contains(&"UNREAD".to_string()));
}

#[test]
fn extracts_bodies_and_attachments_from_full_message() {
    let msg: mail_core::gmail::types::Message =
        serde_json::from_str(&fixture("message_m3_full.json")).unwrap();
    let payload = msg.payload.as_ref().unwrap();
    let body = parse::extract_body(payload);
    assert!(body.html.as_deref().unwrap().contains("<b>there</b>"));
    assert!(body.text.as_deref().unwrap().starts_with("Hi there,"));
    assert!(parse::message_to_incoming(&msg).has_attachments);
}

#[tokio::test]
async fn reads_a_message_as_it_arrived() {
    let server = MockServer::start().await;
    let raw = "Subject: Hi\r\nFrom: a@x.com\r\n\r\nHello\r\n";
    Mock::given(method("GET"))
        .and(path("/gmail/v1/users/me/messages/m1"))
        .and(query_param("format", "raw"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": "m1",
            "raw": parse::encode_base64url(raw.as_bytes()),
        })))
        .expect(1)
        .mount(&server)
        .await;
    let (gmail, _) = client(&server.uri());
    assert_eq!(gmail.message_raw("m1").await.unwrap(), raw.as_bytes());
}
