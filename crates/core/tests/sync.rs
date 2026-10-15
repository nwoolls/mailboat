//! Full sync, incremental sync and per-account worker independence, driven
//! by Gmail JSON fixtures served from a mock server.

mod common;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use common::*;
use mailboat_core::db::{accounts, query, store, Db};
use mailboat_core::model::*;
use mailboat_core::sync::*;
use wiremock::matchers::{method, path};
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

fn config() -> SyncConfig {
    SyncConfig {
        body_prefetch: 0,
        ..SyncConfig::default()
    }
}

fn inbox(db: &Db, accounts: AccountFilter) -> Vec<ThreadSummary> {
    query::list_threads(
        &db.conn(),
        &ListQuery {
            accounts,
            view: MailView::System {
                label: SystemLabel::Inbox,
            },
            cursor: None,
            limit: 100,
        },
    )
    .unwrap()
    .threads
}

async fn run(db: &Db, server: &MockServer, account: AccountId) -> mailboat_core::Result<SyncOutcome> {
    let (gmail, _) = client(&server.uri());
    let cfg = config();
    let progress = |_: SyncProgress| {};
    SyncEngine {
        db,
        gmail: &gmail,
        account,
        config: &cfg,
        progress: &progress,
    }
    .run()
    .await
}

fn initial_batch() -> BatchResponder {
    BatchResponder(HashMap::from([
        ("t1", "thread_t1.json"),
        ("t2", "thread_t2.json"),
    ]))
}

#[tokio::test]
async fn full_sync_fills_the_cache_and_records_history_id() {
    let server = MockServer::start().await;
    mount_mailbox(&server).await;
    Mock::given(method("POST"))
        .and(path("/batch/gmail/v1"))
        .respond_with(initial_batch())
        .mount(&server)
        .await;
    let db = Db::open_in_memory().unwrap();
    let account = add_account(&db, "a");

    let outcome = run(&db, &server, account).await.unwrap();
    assert_eq!(outcome.kind, SyncKind::Full);

    let threads = inbox(&db, AccountFilter::All);
    assert_eq!(
        threads
            .iter()
            .map(|t| t.subject.as_str())
            .collect::<Vec<_>>(),
        vec!["Invoice #42", "Lunch Friday"]
    );
    assert!(threads[0].starred && !threads[0].has_attachments);
    assert!(threads[1].unread);
    assert_eq!(threads[1].message_count, 2);
    assert_eq!(store::history_id(&db.conn(), account).unwrap(), Some(9000));
    let labels = query::user_labels(&db.conn(), &AccountFilter::All).unwrap();
    assert_eq!(labels[0].name, "Work");
    assert_eq!(labels[0].color_bg.as_deref(), Some("#4986e7"));
    // t2 is in both INBOX and STARRED listings but fetched once.
    let batch_calls = server
        .received_requests()
        .await
        .unwrap()
        .into_iter()
        .filter(|r| r.url.path() == "/batch/gmail/v1")
        .count();
    assert_eq!(batch_calls, 1);
}

#[tokio::test]
async fn incremental_sync_applies_history() {
    let server = MockServer::start().await;
    mount_mailbox(&server).await;
    Mock::given(method("POST"))
        .and(path("/batch/gmail/v1"))
        .respond_with(initial_batch())
        .up_to_n_times(1)
        .with_priority(1)
        .mount(&server)
        .await;
    let db = Db::open_in_memory().unwrap();
    let account = add_account(&db, "a");
    run(&db, &server, account).await.unwrap();

    // History: t3 added, t1 archived, t2's only message deleted.
    Mock::given(path("/gmail/v1/users/me/history"))
        .respond_with(
            ResponseTemplate::new(200).set_body_raw(fixture("history.json"), "application/json"),
        )
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/batch/gmail/v1"))
        .respond_with(BatchResponder(HashMap::from([
            ("t1", "thread_t1_archived.json"),
            ("t3", "thread_t3.json"),
        ])))
        .with_priority(2)
        .mount(&server)
        .await;

    let outcome = run(&db, &server, account).await.unwrap();
    assert_eq!(outcome.kind, SyncKind::Incremental);
    let threads = inbox(&db, AccountFilter::All);
    assert_eq!(threads.len(), 1);
    assert_eq!(threads[0].subject, "Hello there");
    assert_eq!(store::history_id(&db.conn(), account).unwrap(), Some(9005));
    // Archived t1 is still cached (findable by search), just not in the inbox.
    let search = query::list_threads(
        &db.conn(),
        &ListQuery {
            accounts: AccountFilter::All,
            view: MailView::Search {
                text: "lunch".into(),
            },
            cursor: None,
            limit: 10,
        },
    )
    .unwrap();
    assert_eq!(search.threads.len(), 1);
    // Deleted t2 is gone everywhere.
    let starred = query::list_threads(
        &db.conn(),
        &ListQuery {
            accounts: AccountFilter::All,
            view: MailView::System {
                label: SystemLabel::Starred,
            },
            cursor: None,
            limit: 10,
        },
    )
    .unwrap();
    assert!(starred.threads.is_empty());
}

#[tokio::test]
async fn expired_history_falls_back_to_full_resync() {
    let server = MockServer::start().await;
    mount_mailbox(&server).await;
    Mock::given(method("POST"))
        .and(path("/batch/gmail/v1"))
        .respond_with(initial_batch())
        .mount(&server)
        .await;
    Mock::given(path("/gmail/v1/users/me/history"))
        .respond_with(
            ResponseTemplate::new(404).set_body_raw(fixture("error_404.json"), "application/json"),
        )
        .mount(&server)
        .await;
    let db = Db::open_in_memory().unwrap();
    let account = add_account(&db, "a");
    store::set_history_id(&db.conn(), account, Some(1), false).unwrap();
    // A thread that no longer exists in the mailbox window must not survive the resync.
    store::upsert_thread(
        &mut db.conn(),
        account,
        &store::IncomingThread {
            gmail_thread_id: "stale".into(),
            messages: vec![store::IncomingMessage {
                gmail_message_id: "old".into(),
                label_ids: vec!["INBOX".into()],
                ..Default::default()
            }],
        },
    )
    .unwrap();

    let outcome = run(&db, &server, account).await.unwrap();
    assert_eq!(outcome.kind, SyncKind::Full);
    assert_eq!(store::history_id(&db.conn(), account).unwrap(), Some(9000));
    assert_eq!(inbox(&db, AccountFilter::All).len(), 2);
}

#[tokio::test]
async fn fetch_body_downloads_once_then_uses_cache() {
    let server = MockServer::start().await;
    mount_mailbox(&server).await;
    Mock::given(method("POST"))
        .and(path("/batch/gmail/v1"))
        .respond_with(initial_batch())
        .mount(&server)
        .await;
    Mock::given(path("/gmail/v1/users/me/messages/m3"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_raw(fixture("message_m3_full.json"), "application/json"),
        )
        .expect(1)
        .mount(&server)
        .await;
    let db = Db::open_in_memory().unwrap();
    let account = add_account(&db, "a");
    run(&db, &server, account).await.unwrap();
    let t2 = inbox(&db, AccountFilter::All)[0].id;
    let m3 = query::thread_detail(&db.conn(), t2).unwrap().messages[0].id;
    let (gmail, _) = client(&server.uri());

    let body = fetch_body(&db, &gmail, m3).await.unwrap();
    assert!(body.html.unwrap().contains("Pay now"));
    fetch_body(&db, &gmail, m3).await.unwrap();
    // The body is now searchable.
    let hits = query::list_threads(
        &db.conn(),
        &ListQuery {
            accounts: AccountFilter::All,
            view: MailView::Search {
                text: "vendor.com/pay".into(),
            },
            cursor: None,
            limit: 10,
        },
    )
    .unwrap();
    assert_eq!(hits.threads.len(), 1);
}

#[derive(Default)]
struct Recorder {
    statuses: Mutex<Vec<AccountSyncState>>,
    changed: Mutex<Vec<AccountId>>,
}

impl SyncEvents for Recorder {
    fn status(&self, s: AccountSyncState) {
        self.statuses.lock().unwrap().push(s);
    }
    fn progress(&self, _: SyncProgress) {}
    fn mail_changed(&self, a: AccountId) {
        self.changed.lock().unwrap().push(a);
    }
}

impl Recorder {
    fn last_status(&self, a: AccountId) -> Option<SyncStatus> {
        self.statuses
            .lock()
            .unwrap()
            .iter()
            .rev()
            .find(|s| s.account_id == a)
            .map(|s| s.status)
    }
}

#[tokio::test]
async fn one_failing_account_does_not_block_another() {
    // Account A's sign-in is revoked: every call is 401.
    let broken = MockServer::start().await;
    Mock::given(wiremock::matchers::any())
        .respond_with(
            ResponseTemplate::new(401).set_body_raw(fixture("error_401.json"), "application/json"),
        )
        .mount(&broken)
        .await;
    // Account B is healthy.
    let healthy = MockServer::start().await;
    mount_mailbox(&healthy).await;
    Mock::given(method("POST"))
        .and(path("/batch/gmail/v1"))
        .respond_with(initial_batch())
        .mount(&healthy)
        .await;

    let db = Arc::new(Db::open_in_memory().unwrap());
    let a = add_account(&db, "a");
    let b = add_account(&db, "b");
    let events = Arc::new(Recorder::default());
    let supervisor = Supervisor::new(
        tokio::runtime::Handle::current(),
        db.clone(),
        events.clone(),
        config(),
        WorkerTiming {
            poll_interval: Duration::from_secs(3600),
            ..WorkerTiming::default()
        },
    );
    supervisor.start(a, client(&broken.uri()).0);
    supervisor.start(b, client(&healthy.uri()).0);

    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    while !(events.last_status(a) == Some(SyncStatus::AuthError)
        && events.last_status(b) == Some(SyncStatus::Idle))
    {
        assert!(
            tokio::time::Instant::now() < deadline,
            "workers did not settle: {:?}",
            events.statuses.lock().unwrap()
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert_eq!(inbox(&db, AccountFilter::Only(vec![b])).len(), 2);
    assert!(inbox(&db, AccountFilter::Only(vec![a])).is_empty());
    assert!(events.changed.lock().unwrap().contains(&b));
    let states = store::sync_states(&db.conn()).unwrap();
    let a_state = states.iter().find(|s| s.account_id == a).unwrap();
    assert_eq!(a_state.status, SyncStatus::AuthError);
    assert_eq!(a_state.error_kind.as_deref(), Some("auth"));
    // A stays parked until woken; B keeps its worker too.
    assert!(supervisor.is_running(a) && supervisor.is_running(b));
}
