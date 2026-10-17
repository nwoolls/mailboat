//! Loading mail older than the cache on demand (`sync::older`), against
//! Gmail fixtures on a mock server.

mod common;

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};

use common::*;
use mailboat_core::db::{accounts, store, Db};
use mailboat_core::gmail::{parse, types::Thread};
use mailboat_core::model::*;
use mailboat_core::sync::{load_older, OlderCursor};
use wiremock::matchers::{method, path, query_param, query_param_is_missing};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn add_account(db: &Db, sub: &str) -> AccountId {
    accounts::upsert(
        &db.conn(),
        &accounts::NewAccount {
            google_sub: sub,
            email: &format!("{sub}@x.com"),
            display_name: None,
            avatar_url: None,
            oauth_client: "default",
        },
    )
    .unwrap()
    .id
}

/// Puts a fixture thread in the cache, as an earlier sync would have.
fn cache(db: &Db, account: AccountId, file: &str) {
    let thread: Thread = serde_json::from_str(&fixture(file)).unwrap();
    store::upsert_thread(&mut db.conn(), account, &parse::thread_to_incoming(&thread)).unwrap();
}

fn cached_ids(db: &Db, account: AccountId) -> Vec<String> {
    let mut ids: Vec<String> = store::thread_ids_for_account(&db.conn(), account)
        .unwrap()
        .into_iter()
        .collect();
    ids.sort();
    ids
}

fn batch() -> BatchResponder {
    BatchResponder(HashMap::from([
        ("t1", "thread_t1.json"),
        ("t2", "thread_t2.json"),
        ("t4", "thread_t4.json"),
    ]))
}

fn json(file: &str) -> ResponseTemplate {
    ResponseTemplate::new(200).set_body_raw(fixture(file), "application/json")
}

async fn list_calls(server: &MockServer) -> usize {
    server
        .received_requests()
        .await
        .unwrap_or_default()
        .iter()
        .filter(|r| r.url.path() == "/gmail/v1/users/me/threads")
        .count()
}

const ALL_MAIL: MailView = MailView::AllMail;

#[tokio::test]
async fn skips_cached_threads_and_resumes_where_it_stopped() {
    let server = MockServer::start().await;
    // All Mail, newest first: t2, t4, t1. Only t2 is cached.
    Mock::given(path("/gmail/v1/users/me/threads"))
        .and(query_param_is_missing("labelIds"))
        .respond_with(json("threads_allmail.json"))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/batch/gmail/v1"))
        .respond_with(batch())
        .mount(&server)
        .await;
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db, "a");
    cache(&db, a, "thread_t2.json");
    let (gmail, _) = client(&server.uri());
    let chunks = AtomicUsize::new(0);
    let on_chunk = || {
        chunks.fetch_add(1, Ordering::SeqCst);
    };
    let mut cursor = OlderCursor::default();

    // One at a time: the first missing thread in Gmail's order is t4.
    let added = load_older(&db, &gmail, a, &ALL_MAIL, 1, &mut cursor, &on_chunk)
        .await
        .unwrap();
    assert_eq!(added, 1);
    assert_eq!(cached_ids(&db, a), ["t2", "t4"]);
    assert!(!cursor.exhausted);
    assert_eq!(chunks.load(Ordering::SeqCst), 1);

    // The next load carries on from the remembered page: no new listing.
    let added = load_older(&db, &gmail, a, &ALL_MAIL, 25, &mut cursor, &on_chunk)
        .await
        .unwrap();
    assert_eq!(added, 1);
    assert_eq!(cached_ids(&db, a), ["t1", "t2", "t4"]);
    assert!(cursor.exhausted, "Gmail has nothing older");
    assert_eq!(list_calls(&server).await, 1);

    // Exhausted: nothing more is asked of Gmail.
    let added = load_older(&db, &gmail, a, &ALL_MAIL, 25, &mut cursor, &on_chunk)
        .await
        .unwrap();
    assert_eq!(added, 0);
    assert_eq!(list_calls(&server).await, 1);
}

#[tokio::test]
async fn follows_gmail_pages_for_a_label() {
    let server = MockServer::start().await;
    mount_mailbox(&server).await; // INBOX: page 1 has t1, page 2 has t2.
    Mock::given(method("POST"))
        .and(path("/batch/gmail/v1"))
        .respond_with(batch())
        .mount(&server)
        .await;
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db, "a");
    let (gmail, _) = client(&server.uri());
    let mut cursor = OlderCursor::default();
    let inbox = MailView::System {
        label: SystemLabel::Inbox,
    };

    let added = load_older(&db, &gmail, a, &inbox, 25, &mut cursor, &|| {})
        .await
        .unwrap();
    assert_eq!(added, 2);
    assert_eq!(cached_ids(&db, a), ["t1", "t2"]);
    assert!(cursor.exhausted);
}

#[tokio::test]
async fn archive_asks_gmail_for_mail_outside_the_inbox() {
    let server = MockServer::start().await;
    Mock::given(path("/gmail/v1/users/me/threads"))
        .and(query_param("q", "-in:inbox"))
        .and(query_param_is_missing("labelIds"))
        .respond_with(ResponseTemplate::new(200).set_body_raw(
            r#"{"threads":[{"id":"t4","historyId":"8995"}]}"#,
            "application/json",
        ))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/batch/gmail/v1"))
        .respond_with(batch())
        .mount(&server)
        .await;
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db, "a");
    let (gmail, _) = client(&server.uri());
    let mut cursor = OlderCursor::default();

    let added = load_older(&db, &gmail, a, &MailView::Archive, 25, &mut cursor, &|| {})
        .await
        .unwrap();
    assert_eq!(added, 1);
    assert_eq!(cached_ids(&db, a), ["t4"]);
}

/// Local search and other accounts' labels have nothing to load (rule 1:
/// a label ID from account B never becomes a Gmail query in account A).
#[tokio::test]
async fn other_accounts_labels_load_nothing() {
    let server = MockServer::start().await;
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db, "a");
    let b = add_account(&db, "b");
    store::sync_labels(
        &mut db.conn(),
        b,
        &[store::IncomingLabel {
            gmail_label_id: "Label_1".into(),
            name: "Work".into(),
            kind: LabelKind::User,
            color_bg: None,
            color_fg: None,
        }],
    )
    .unwrap();
    let b_label =
        mailboat_core::db::query::user_labels(&db.conn(), &AccountFilter::All).unwrap()[0].id;
    let (gmail, _) = client(&server.uri());

    // (Search asks Gmail since Milestone 5: see the search test below.)
    for view in [MailView::UserLabel { label_id: b_label }] {
        let mut cursor = OlderCursor::default();
        let added = load_older(&db, &gmail, a, &view, 25, &mut cursor, &|| {})
            .await
            .unwrap();
        assert_eq!(added, 0);
        assert!(cursor.exhausted);
    }
    assert!(server.received_requests().await.unwrap().is_empty());
}

/// If fetching fails, the threads it was about to add are tried again by
/// the next load instead of being skipped.
#[tokio::test]
async fn a_failed_fetch_is_retried_next_time() {
    let server = MockServer::start().await;
    Mock::given(path("/gmail/v1/users/me/threads"))
        .and(query_param_is_missing("labelIds"))
        .respond_with(json("threads_allmail.json"))
        .mount(&server)
        .await;
    // Google is down for the first fetch (and its retries).
    Mock::given(method("POST"))
        .and(path("/batch/gmail/v1"))
        .respond_with(ResponseTemplate::new(503))
        .up_to_n_times(4)
        .with_priority(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/batch/gmail/v1"))
        .respond_with(batch())
        .mount(&server)
        .await;
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db, "a");
    let (gmail, _) = client(&server.uri());
    let mut cursor = OlderCursor::default();

    let first = load_older(&db, &gmail, a, &ALL_MAIL, 25, &mut cursor, &|| {}).await;
    assert!(first.is_err());
    assert!(cached_ids(&db, a).is_empty());

    let added = load_older(&db, &gmail, a, &ALL_MAIL, 25, &mut cursor, &|| {})
        .await
        .unwrap();
    assert_eq!(added, 3);
    assert_eq!(cached_ids(&db, a), ["t1", "t2", "t4"]);
    assert!(cursor.exhausted);
}

#[tokio::test]
async fn searching_gmail_shows_what_it_matched_in_the_search_view() {
    use mailboat_core::db::query;
    let server = MockServer::start().await;
    // Gmail's search for "zebra" matches t1 (cached, but on a word only in
    // its body) and t2 (not cached yet).
    Mock::given(path("/gmail/v1/users/me/threads"))
        .and(query_param("q", "Zebra"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "threads": [{ "id": "t2" }, { "id": "t1" }]
        })))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/batch/gmail/v1"))
        .respond_with(batch())
        .mount(&server)
        .await;
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db, "a");
    cache(&db, a, "thread_t1.json");
    let view = MailView::Search {
        text: "Zebra".into(),
    };
    let list = |db: &Db| {
        query::list_threads(
            &db.conn(),
            &ListQuery {
                accounts: AccountFilter::All,
                view: view.clone(),
                cursor: None,
                limit: 50,
            },
        )
        .unwrap()
        .threads
        .len()
    };
    assert_eq!(list(&db), 0, "nothing local mentions zebra");

    let (gmail, _) = client(&server.uri());
    let mut cursor = OlderCursor::default();
    let added = load_older(&db, &gmail, a, &view, 25, &mut cursor, &|| {})
        .await
        .unwrap();
    assert_eq!(added, 1, "t2 fetched");
    assert_eq!(
        list(&db),
        2,
        "both Gmail matches show, whatever the case typed"
    );
    assert!(cursor.exhausted);
}
