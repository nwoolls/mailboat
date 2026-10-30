//! Full sync, incremental sync and per-account worker independence, driven
//! by Gmail JSON fixtures served from a mock server.

mod common;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use common::*;
use mail_core::db::{accounts, query, store, Db};
use mail_core::model::*;
use mail_core::sync::*;
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

async fn run(db: &Db, server: &MockServer, account: AccountId) -> mail_core::Result<SyncOutcome> {
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
        ("t4", "thread_t4.json"),
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
                with_spam_trash: false,
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
                with_spam_trash: false,
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

/// Removing an account first stops its worker, even mid-request, and waits
/// for it, so a sync in flight can't write into the account being deleted.
/// The other account keeps syncing.
#[tokio::test]
async fn removing_an_account_stops_its_worker_mid_sync() {
    // A's Gmail never answers in time: its worker is stuck mid-request.
    let stalled = MockServer::start().await;
    Mock::given(wiremock::matchers::any())
        .respond_with(ResponseTemplate::new(200).set_delay(Duration::from_secs(60)))
        .mount(&stalled)
        .await;
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
    supervisor.start(a, client(&stalled.uri()).0);
    supervisor.start(b, client(&healthy.uri()).0);
    // Wait until A's request is actually in flight.
    while stalled
        .received_requests()
        .await
        .unwrap_or_default()
        .is_empty()
    {
        tokio::time::sleep(Duration::from_millis(10)).await;
    }

    tokio::time::timeout(Duration::from_secs(5), supervisor.stop_and_wait(a))
        .await
        .expect("stopping a worker mid-request should not wait for Gmail");
    assert!(!supervisor.is_running(a));
    accounts::remove(&db.conn(), a).unwrap();

    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    while events.last_status(b) != Some(SyncStatus::Idle) {
        assert!(tokio::time::Instant::now() < deadline, "B did not finish");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert_eq!(inbox(&db, AccountFilter::Only(vec![b])).len(), 2);
    assert!(supervisor.is_running(b));
    let remaining = accounts::list(&db.conn()).unwrap();
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].id, b);
}

#[tokio::test]
async fn interrupted_full_sync_resumes_without_refetching() {
    let server = MockServer::start().await;
    mount_mailbox(&server).await;
    // First attempt: the batch call fails hard (as when quota runs out and
    // retries are exhausted), after t1 was already written.
    Mock::given(method("POST"))
        .and(path("/batch/gmail/v1"))
        .respond_with(ResponseTemplate::new(429))
        .with_priority(1)
        .up_to_n_times(4)
        .mount(&server)
        .await;
    let db = Db::open_in_memory().unwrap();
    let account = add_account(&db, "a");
    // Simulate t1 having been fetched by the interrupted attempt.
    store::begin_full_sync(&db.conn(), account, 9000).unwrap();
    let t1: mail_core::gmail::types::Thread =
        serde_json::from_str(&fixture("thread_t1.json")).unwrap();
    store::upsert_thread(
        &mut db.conn(),
        account,
        &mail_core::gmail::parse::thread_to_incoming(&t1),
    )
    .unwrap();

    assert!(matches!(
        run(&db, &server, account).await,
        Err(mail_core::CoreError::RateLimited(_))
    ));
    assert_eq!(
        store::history_id(&db.conn(), account).unwrap(),
        None,
        "not finished yet"
    );
    assert!(store::pending_full_sync(&db.conn(), account)
        .unwrap()
        .is_some());

    // Second attempt succeeds and only asks Google for t2.
    Mock::given(method("POST"))
        .and(path("/batch/gmail/v1"))
        .respond_with(initial_batch())
        .with_priority(2)
        .mount(&server)
        .await;
    let before = server.received_requests().await.unwrap().len();
    run(&db, &server, account).await.unwrap();
    let requests = server.received_requests().await.unwrap();
    let batch_bodies: Vec<String> = requests[before..]
        .iter()
        .filter(|r| r.url.path() == "/batch/gmail/v1")
        .map(|r| String::from_utf8_lossy(&r.body).into_owned())
        .collect();
    assert_eq!(batch_bodies.len(), 1);
    assert!(batch_bodies[0].contains("/threads/t2?") && !batch_bodies[0].contains("/threads/t1?"));
    // Resumed from the original historyId, without calling getProfile again.
    assert!(!requests[before..]
        .iter()
        .any(|r| r.url.path().ends_with("/profile")));
    assert_eq!(store::history_id(&db.conn(), account).unwrap(), Some(9000));
    assert!(store::pending_full_sync(&db.conn(), account)
        .unwrap()
        .is_none());
    assert_eq!(inbox(&db, AccountFilter::All).len(), 2);
}

#[tokio::test]
async fn full_sync_includes_archived_mail_and_records_scope() {
    let server = MockServer::start().await;
    mount_mailbox(&server).await;
    Mock::given(method("POST"))
        .and(path("/batch/gmail/v1"))
        .respond_with(initial_batch())
        .mount(&server)
        .await;
    let db = Db::open_in_memory().unwrap();
    let account = add_account(&db, "a");
    run(&db, &server, account).await.unwrap();

    // t4 is archived: not in the inbox, but cached and searchable.
    assert_eq!(inbox(&db, AccountFilter::All).len(), 2);
    let found = query::list_threads(
        &db.conn(),
        &ListQuery {
            accounts: AccountFilter::All,
            view: MailView::Search {
                text: "oil".into(),
                with_spam_trash: false,
            },
            cursor: None,
            limit: 10,
        },
    )
    .unwrap();
    assert_eq!(found.threads.len(), 1);
    assert_eq!(
        store::scope_version(&db.conn(), account).unwrap(),
        SCOPE_VERSION
    );
}

#[tokio::test]
async fn account_synced_under_old_scope_is_widened_without_refetching() {
    let server = MockServer::start().await;
    mount_mailbox(&server).await;
    Mock::given(path("/gmail/v1/users/me/history"))
        .respond_with(
            ResponseTemplate::new(200).set_body_raw(r#"{"historyId":"9000"}"#, "application/json"),
        )
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/batch/gmail/v1"))
        .respond_with(initial_batch())
        .mount(&server)
        .await;
    let db = Db::open_in_memory().unwrap();
    let account = add_account(&db, "a");
    // As if synced by the old INBOX/STARRED/SENT scope: t1 cached, cursor set.
    let t1: mail_core::gmail::types::Thread =
        serde_json::from_str(&fixture("thread_t1.json")).unwrap();
    store::upsert_thread(
        &mut db.conn(),
        account,
        &mail_core::gmail::parse::thread_to_incoming(&t1),
    )
    .unwrap();
    store::set_history_id(&db.conn(), account, Some(9000), true).unwrap();
    assert_eq!(store::scope_version(&db.conn(), account).unwrap(), 0);

    let outcome = run(&db, &server, account).await.unwrap();
    assert_eq!(outcome.kind, SyncKind::Widened);

    // Only the missing threads were fetched; t1 was not.
    let batches: Vec<String> = server
        .received_requests()
        .await
        .unwrap()
        .iter()
        .filter(|r| r.url.path() == "/batch/gmail/v1")
        .map(|r| String::from_utf8_lossy(&r.body).into_owned())
        .collect();
    let all = batches.join("");
    assert!(all.contains("/threads/t2?") && all.contains("/threads/t4?"));
    assert!(!all.contains("/threads/t1?"));
    // No full resync: the cursor is untouched and getProfile wasn't called.
    assert_eq!(store::history_id(&db.conn(), account).unwrap(), Some(9000));
    assert!(!server
        .received_requests()
        .await
        .unwrap()
        .iter()
        .any(|r| r.url.path().ends_with("/profile")));
    assert_eq!(
        store::scope_version(&db.conn(), account).unwrap(),
        SCOPE_VERSION
    );

    // The one-time attachment catch-up marked t2 (its PDF), not t1.
    let has = |gmail_id: &str| -> bool {
        db.conn()
            .query_row(
                "SELECT has_attachments FROM threads WHERE gmail_thread_id = ?1",
                [gmail_id],
                |r| r.get(0),
            )
            .unwrap()
    };
    assert!(has("t2") && !has("t1"));

    // The next pass is a plain incremental one.
    assert_eq!(
        run(&db, &server, account).await.unwrap().kind,
        SyncKind::Incremental
    );
}

/// A new account's From addresses (which carry its signatures) are read
/// before its first sync pass, not after it (owner, 2026-10-29: a message
/// written during a first sync had no signature, and Settings → Signatures
/// was empty). Gmail answers the mail slowly here, as for an account with
/// thousands of conversations; the addresses must arrive long before.
#[tokio::test]
async fn a_new_accounts_signatures_arrive_before_its_first_sync_finishes() {
    let server = MockServer::start().await;
    mount_mailbox(&server).await;
    Mock::given(method("POST"))
        .and(path("/batch/gmail/v1"))
        .respond_with(initial_batch_slowly(Duration::from_millis(1500)))
        .mount(&server)
        .await;
    Mock::given(path("/gmail/v1/users/me/settings/sendAs"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "sendAs": [{ "sendAsEmail": "a@x.com", "isPrimary": true, "signature": "<b>Sig</b>" }]
        })))
        .mount(&server)
        .await;

    let db = Arc::new(Db::open_in_memory().unwrap());
    let account = add_account(&db, "a");
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
    supervisor.start(account, client(&server.uri()).0);

    // Within a second, while the mail is still being fetched (it takes
    // 1.5s): the signature is stored, and the account is still syncing.
    let deadline = tokio::time::Instant::now() + Duration::from_secs(1);
    let signature = loop {
        let found = mail_core::compose::identities::list(&db.conn())
            .unwrap()
            .into_iter()
            .find(|i| i.account_id == account)
            .and_then(|i| i.signature);
        if found.is_some() || tokio::time::Instant::now() >= deadline {
            break found;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    };
    assert_eq!(signature.as_deref(), Some("<b>Sig</b>"));
    assert_eq!(events.last_status(account), Some(SyncStatus::Syncing));
    assert!(inbox(&db, AccountFilter::Only(vec![account])).is_empty());
}

/// The standard batch answers, after a delay.
fn initial_batch_slowly(delay: Duration) -> SlowBatch {
    SlowBatch(initial_batch(), delay)
}

struct SlowBatch(BatchResponder, Duration);

impl wiremock::Respond for SlowBatch {
    fn respond(&self, request: &wiremock::Request) -> ResponseTemplate {
        self.0.respond(request).set_delay(self.1)
    }
}

/// Batch answers for the standard mailbox plus the thread that history.json
/// says arrives during the sync (t3).
fn batch_with_arrival() -> BatchResponder {
    BatchResponder(HashMap::from([
        ("t1", "thread_t1.json"),
        ("t2", "thread_t2.json"),
        ("t4", "thread_t4.json"),
        ("t3", "thread_t3.json"),
    ]))
}

/// Mail that arrives while a first sync runs is picked up the moment the
/// sync ends, not a poll interval and a body prefetch later (found
/// 2026-10-29: a test message to an account still on its first sync hadn't
/// appeared). The sync reads where Gmail's history stood when it began, so
/// it replays everything since, and notifies about the new mail.
#[tokio::test]
async fn mail_that_arrived_during_a_first_sync_is_caught_up_when_it_ends() {
    let server = MockServer::start().await;
    mount_mailbox(&server).await;
    Mock::given(method("POST"))
        .and(path("/batch/gmail/v1"))
        .respond_with(batch_with_arrival())
        .mount(&server)
        .await;
    Mock::given(path("/gmail/v1/users/me/history"))
        .respond_with(
            ResponseTemplate::new(200).set_body_raw(fixture("history.json"), "application/json"),
        )
        .mount(&server)
        .await;
    let db = Db::open_in_memory().unwrap();
    let account = add_account(&db, "a");

    let outcome = run(&db, &server, account).await.unwrap();

    assert_eq!(outcome.kind, SyncKind::Full);
    // t3 wasn't in the listing: it arrived afterwards, and is here now.
    assert!(inbox(&db, AccountFilter::All)
        .iter()
        .any(|t| t.subject == "Hello there"));
    assert_eq!(outcome.new_inbox.len(), 1, "its arrival is notified");
    // The cursor is where the catch-up reached, so the next pass starts there.
    assert_eq!(store::history_id(&db.conn(), account).unwrap(), Some(9005));
}

/// A long first sync catches up as it goes, so new mail shows within
/// minutes, not after thousands of old conversations. `catch_up_every` is
/// zero here, so it catches up after every chunk of the fetch.
#[tokio::test]
async fn mail_that_arrives_during_a_long_first_sync_shows_before_it_ends() {
    let server = MockServer::start().await;
    mount_mailbox(&server).await;
    // 130 more conversations in the Inbox: two chunks of fetching. Gmail
    // has none of them when asked (404), which the sync treats as deleted.
    let many: Vec<serde_json::Value> = (1..=130)
        .map(|i| serde_json::json!({ "id": format!("x{i}"), "threadId": format!("x{i}") }))
        .collect();
    use wiremock::matchers::{query_param, query_param_is_missing};
    Mock::given(path("/gmail/v1/users/me/threads"))
        .and(query_param("labelIds", "INBOX"))
        .and(query_param_is_missing("pageToken"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "threads": many, "resultSizeEstimate": 130
        })))
        .with_priority(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/batch/gmail/v1"))
        .respond_with(batch_with_arrival())
        .mount(&server)
        .await;
    Mock::given(path("/gmail/v1/users/me/history"))
        .respond_with(
            ResponseTemplate::new(200).set_body_raw(fixture("history.json"), "application/json"),
        )
        .mount(&server)
        .await;
    let db = Arc::new(Db::open_in_memory().unwrap());
    let account = add_account(&db, "a");

    // At the last report of the fetch: is the new thread already here, with
    // the first sync still unfinished (it records its cursor only at the end)?
    let seen: Arc<Mutex<Option<(bool, bool)>>> = Arc::new(Mutex::new(None));
    let progress = {
        let (db, seen) = (db.clone(), seen.clone());
        move |p: SyncProgress| {
            // The first time only: the catch-up at the end fetches too.
            if p.phase == SyncPhase::Fetching
                && p.total > 0
                && p.done == p.total
                && seen.lock().unwrap().is_none()
            {
                let ids = store::thread_ids_for_account(&db.conn(), account).unwrap();
                let unfinished = store::history_id(&db.conn(), account).unwrap().is_none();
                *seen.lock().unwrap() = Some((ids.contains("t3"), unfinished));
            }
        }
    };
    let (gmail, _) = client(&server.uri());
    let cfg = SyncConfig {
        catch_up_every: Duration::ZERO,
        ..config()
    };
    SyncEngine {
        db: &db,
        gmail: &gmail,
        account,
        config: &cfg,
        progress: &progress,
    }
    .run()
    .await
    .unwrap();

    assert_eq!(*seen.lock().unwrap(), Some((true, true)));
}
