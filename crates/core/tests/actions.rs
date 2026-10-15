//! Actions go to the owning account only, apply locally at once, and are
//! undone locally if Gmail refuses.

mod common;

use std::collections::HashMap;

use common::*;
use mailboat_core::actions;
use mailboat_core::db::{accounts, query, store, Db};
use mailboat_core::gmail::types::Thread;
use mailboat_core::gmail::{parse, GmailClient};
use mailboat_core::model::*;
use mailboat_core::CoreError;
use wiremock::matchers::{body_json, method, path};
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

/// Loads fixture thread t1 (one read and one unread message) into an account.
fn load_t1(db: &Db, account: AccountId) -> ThreadId {
    let t: Thread = serde_json::from_str(&fixture("thread_t1.json")).unwrap();
    store::upsert_thread(&mut db.conn(), account, &parse::thread_to_incoming(&t)).unwrap()
}

fn unread(db: &Db, thread: ThreadId) -> bool {
    query::thread_summary(&db.conn(), thread).unwrap().unread
}

#[tokio::test]
async fn marking_read_goes_only_to_the_owning_account() {
    // Two accounts, each with its own Gmail server, and colliding thread IDs.
    let server_a = MockServer::start().await;
    let server_b = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/gmail/v1/users/me/threads/t1/modify"))
        .and(body_json(
            serde_json::json!({ "addLabelIds": [], "removeLabelIds": ["UNREAD"] }),
        ))
        .respond_with(
            ResponseTemplate::new(200).set_body_raw(fixture("thread_t1.json"), "application/json"),
        )
        .expect(1)
        .mount(&server_a)
        .await;
    Mock::given(wiremock::matchers::any())
        .respond_with(ResponseTemplate::new(500))
        .expect(0)
        .mount(&server_b)
        .await;

    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db, "a");
    let b = add_account(&db, "b");
    let a_t1 = load_t1(&db, a);
    let b_t1 = load_t1(&db, b);
    assert!(unread(&db, a_t1) && unread(&db, b_t1));

    let servers = HashMap::from([(a, server_a.uri()), (b, server_b.uri())]);
    let gmail_for = |acct: AccountId| Ok::<GmailClient, CoreError>(client(&servers[&acct]).0);
    let touched = actions::set_read(&db, gmail_for, &[a_t1], true)
        .await
        .unwrap();

    assert_eq!(touched, vec![a]);
    assert!(!unread(&db, a_t1), "A's thread is read");
    assert!(
        unread(&db, b_t1),
        "B's thread with the same Gmail ID is untouched"
    );
    // wiremock verifies the expectations (A called once, B never) on drop.
}

#[tokio::test]
async fn a_selection_spanning_accounts_is_split_per_account() {
    let server_a = MockServer::start().await;
    let server_b = MockServer::start().await;
    for server in [&server_a, &server_b] {
        Mock::given(method("POST"))
            .and(path("/gmail/v1/users/me/threads/t1/modify"))
            .and(body_json(
                serde_json::json!({ "addLabelIds": ["UNREAD"], "removeLabelIds": [] }),
            ))
            .respond_with(ResponseTemplate::new(200).set_body_string("{}"))
            .expect(1)
            .mount(server)
            .await;
    }
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db, "a");
    let b = add_account(&db, "b");
    let a_t1 = load_t1(&db, a);
    let b_t1 = load_t1(&db, b);
    let servers = HashMap::from([(a, server_a.uri()), (b, server_b.uri())]);
    let gmail_for = |acct: AccountId| Ok::<GmailClient, CoreError>(client(&servers[&acct]).0);

    let touched = actions::set_read(&db, gmail_for, &[a_t1, b_t1], false)
        .await
        .unwrap();
    assert_eq!(touched, vec![a, b]);
    // Every message of both threads is now unread.
    for t in [a_t1, b_t1] {
        let detail = query::thread_detail(&db.conn(), t).unwrap();
        assert!(detail.messages.iter().all(|m| m.unread));
    }
}

#[tokio::test]
async fn refused_change_is_undone_locally() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(
            ResponseTemplate::new(400).set_body_raw(fixture("error_404.json"), "application/json"),
        )
        .mount(&server)
        .await;
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db, "a");
    let t1 = load_t1(&db, a);
    let before = query::thread_detail(&db.conn(), t1).unwrap();

    let gmail_for = |_: AccountId| Ok::<GmailClient, CoreError>(client(&server.uri()).0);
    assert!(actions::set_read(&db, gmail_for, &[t1], true)
        .await
        .is_err());

    // Exactly as before: only the second message unread.
    let after = query::thread_detail(&db.conn(), t1).unwrap();
    assert_eq!(
        after.messages.iter().map(|m| m.unread).collect::<Vec<_>>(),
        vec![false, true]
    );
    assert_eq!(after.thread, before.thread);
}
