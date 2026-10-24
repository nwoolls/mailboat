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

fn in_view(db: &Db, account: AccountId, view: MailView) -> Vec<ThreadId> {
    query::list_threads(
        &db.conn(),
        &ListQuery {
            accounts: AccountFilter::Only(vec![account]),
            view,
            cursor: None,
            limit: 50,
        },
    )
    .unwrap()
    .threads
    .into_iter()
    .map(|t| t.id)
    .collect()
}

const INBOX: MailView = MailView::System {
    label: SystemLabel::Inbox,
};

/// A server that accepts one POST to `path` (with `body`, if given).
async fn expect_post(path_str: &str, body: Option<serde_json::Value>) -> MockServer {
    let server = MockServer::start().await;
    let mut mock = Mock::given(method("POST")).and(path(path_str.to_string()));
    if let Some(body) = body {
        mock = mock.and(body_json(body));
    }
    mock.respond_with(ResponseTemplate::new(200).set_body_string("{}"))
        .expect(1)
        .mount(&server)
        .await;
    server
}

#[tokio::test]
async fn archive_leaves_the_inbox_and_moving_back_returns() {
    let server = expect_post(
        "/gmail/v1/users/me/threads/t1/modify",
        Some(serde_json::json!({ "addLabelIds": [], "removeLabelIds": ["INBOX"] })),
    )
    .await;
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db, "a");
    let t1 = load_t1(&db, a);
    let gmail_for = |_: AccountId| Ok::<GmailClient, CoreError>(client(&server.uri()).0);

    actions::set_archived(&db, gmail_for, &[t1], true)
        .await
        .unwrap();
    assert!(in_view(&db, a, INBOX).is_empty());
    assert_eq!(in_view(&db, a, MailView::Archive), vec![t1]);
    assert!(!query::thread_summary(&db.conn(), t1).unwrap().in_inbox);

    let back = expect_post(
        "/gmail/v1/users/me/threads/t1/modify",
        Some(serde_json::json!({ "addLabelIds": ["INBOX"], "removeLabelIds": [] })),
    )
    .await;
    let gmail_for = |_: AccountId| Ok::<GmailClient, CoreError>(client(&back.uri()).0);
    actions::set_archived(&db, gmail_for, &[t1], false)
        .await
        .unwrap();
    assert_eq!(in_view(&db, a, INBOX), vec![t1]);
}

#[tokio::test]
async fn star_and_unstar() {
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db, "a");
    let t1 = load_t1(&db, a);
    let starred = MailView::System {
        label: SystemLabel::Starred,
    };

    let server = expect_post(
        "/gmail/v1/users/me/threads/t1/modify",
        Some(serde_json::json!({ "addLabelIds": ["STARRED"], "removeLabelIds": [] })),
    )
    .await;
    let gmail_for = |_: AccountId| Ok::<GmailClient, CoreError>(client(&server.uri()).0);
    actions::set_starred(&db, gmail_for, &[t1], true)
        .await
        .unwrap();
    assert!(query::thread_summary(&db.conn(), t1).unwrap().starred);
    assert_eq!(in_view(&db, a, starred.clone()), vec![t1]);

    let server = expect_post(
        "/gmail/v1/users/me/threads/t1/modify",
        Some(serde_json::json!({ "addLabelIds": [], "removeLabelIds": ["STARRED"] })),
    )
    .await;
    let gmail_for = |_: AccountId| Ok::<GmailClient, CoreError>(client(&server.uri()).0);
    actions::set_starred(&db, gmail_for, &[t1], false)
        .await
        .unwrap();
    assert!(!query::thread_summary(&db.conn(), t1).unwrap().starred);
    assert!(in_view(&db, a, starred).is_empty());
}

#[tokio::test]
async fn trash_uses_gmails_trash_call_and_hides_the_thread_from_other_views() {
    let server = expect_post("/gmail/v1/users/me/threads/t1/trash", None).await;
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db, "a");
    let t1 = load_t1(&db, a);
    let gmail_for = |_: AccountId| Ok::<GmailClient, CoreError>(client(&server.uri()).0);

    actions::set_trashed(&db, gmail_for, &[t1], true)
        .await
        .unwrap();
    let trash = MailView::System {
        label: SystemLabel::Trash,
    };
    assert_eq!(in_view(&db, a, trash.clone()), vec![t1]);
    let summary = query::thread_summary(&db.conn(), t1).unwrap();
    assert!(summary.in_trash && summary.in_inbox);
    // It keeps its INBOX label (as in Gmail) but no longer shows there, nor
    // in its user label, nor in the Inbox unread count.
    assert!(in_view(&db, a, INBOX).is_empty());
    assert!(in_view(
        &db,
        a,
        MailView::UserLabel {
            label_id: label_id_of(&db, a, "Label_1")
        }
    )
    .is_empty());
    let counts = query::unread_counts(&db.conn(), &AccountFilter::All).unwrap();
    assert!(!counts.iter().any(|c| c.gmail_label_id == "INBOX"));

    let back = expect_post("/gmail/v1/users/me/threads/t1/untrash", None).await;
    let gmail_for = |_: AccountId| Ok::<GmailClient, CoreError>(client(&back.uri()).0);
    actions::set_trashed(&db, gmail_for, &[t1], false)
        .await
        .unwrap();
    assert!(in_view(&db, a, trash).is_empty());
    assert_eq!(in_view(&db, a, INBOX), vec![t1]);
}

fn label_id_of(db: &Db, account: AccountId, gmail_label_id: &str) -> LabelId {
    db.conn()
        .query_row(
            "SELECT id FROM labels WHERE account_id = ?1 AND gmail_label_id = ?2",
            rusqlite::params![account, gmail_label_id],
            |r| r.get(0),
        )
        .unwrap()
}

fn create_label(db: &Db, account: AccountId, gmail_label_id: &str, name: &str) -> LabelId {
    // Inserted directly: `sync_labels` replaces the whole list.
    db.conn()
        .execute(
            "INSERT INTO labels (account_id, gmail_label_id, name, kind) VALUES (?1, ?2, ?3, 'user')",
            rusqlite::params![account, gmail_label_id, name],
        )
        .unwrap();
    label_id_of(db, account, gmail_label_id)
}

#[tokio::test]
async fn labels_go_to_the_owning_account_by_gmail_id() {
    let server_a = expect_post(
        "/gmail/v1/users/me/threads/t1/modify",
        Some(serde_json::json!({ "addLabelIds": ["Label_7"], "removeLabelIds": ["Label_1"] })),
    )
    .await;
    let server_b = MockServer::start().await;
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
    let travel = create_label(&db, a, "Label_7", "Travel");
    let work_a = label_id_of(&db, a, "Label_1");
    // B has a label with the same Gmail ID and name; it must stay untouched.
    create_label(&db, b, "Label_7", "Travel");

    let servers = HashMap::from([(a, server_a.uri()), (b, server_b.uri())]);
    let gmail_for = |acct: AccountId| Ok::<GmailClient, CoreError>(client(&servers[&acct]).0);
    actions::change_labels(&db, gmail_for, &[a_t1], &[travel], &[work_a])
        .await
        .unwrap();

    let names = |t| {
        query::thread_detail(&db.conn(), t)
            .unwrap()
            .labels
            .into_iter()
            .map(|l| l.gmail_label_id)
            .collect::<Vec<_>>()
    };
    assert_eq!(names(a_t1), vec!["Label_7"]);
    assert_eq!(
        query::thread_summary(&db.conn(), a_t1).unwrap().label_ids,
        vec![travel]
    );
    assert_eq!(names(b_t1), vec!["Label_1"]);
}

#[tokio::test]
async fn a_label_from_another_account_is_refused() {
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db, "a");
    let b = add_account(&db, "b");
    let a_t1 = load_t1(&db, a);
    let b_label = create_label(&db, b, "Label_9", "B only");
    let gmail_for = |_: AccountId| -> Result<GmailClient, CoreError> { unreachable!() };
    let err = actions::change_labels(&db, gmail_for, &[a_t1], &[b_label], &[])
        .await
        .unwrap_err();
    assert!(matches!(err, CoreError::Invalid(_)), "{err}");
}

#[tokio::test]
async fn a_refused_label_change_restores_every_label_it_touched() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(400).set_body_string("{}"))
        .mount(&server)
        .await;
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db, "a");
    let t1 = load_t1(&db, a);
    let travel = create_label(&db, a, "Label_7", "Travel");
    let work = label_id_of(&db, a, "Label_1");
    let before = query::thread_detail(&db.conn(), t1).unwrap();

    let gmail_for = |_: AccountId| Ok::<GmailClient, CoreError>(client(&server.uri()).0);
    assert!(
        actions::change_labels(&db, gmail_for, &[t1], &[travel], &[work])
            .await
            .is_err()
    );
    assert_eq!(query::thread_detail(&db.conn(), t1).unwrap(), before);
}

#[tokio::test]
async fn reporting_spam_moves_it_out_of_the_inbox_for_its_own_account() {
    let server_a = MockServer::start().await;
    let server_b = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/gmail/v1/users/me/threads/t1/modify"))
        .and(body_json(
            serde_json::json!({ "addLabelIds": ["SPAM"], "removeLabelIds": ["INBOX"] }),
        ))
        .respond_with(ResponseTemplate::new(200).set_body_raw("{}", "application/json"))
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
    let servers = HashMap::from([(a, server_a.uri()), (b, server_b.uri())]);
    let gmail_for = |acct: AccountId| Ok::<GmailClient, CoreError>(client(&servers[&acct]).0);

    actions::set_spam(&db, gmail_for, &[a_t1], true)
        .await
        .unwrap();
    let after = query::thread_summary(&db.conn(), a_t1).unwrap();
    assert!(after.in_spam && !after.in_inbox);
    assert!(!query::thread_summary(&db.conn(), b_t1).unwrap().in_spam);
}

#[test]
fn only_unread_inbox_mail_from_others_counts_as_new() {
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db, "a");
    load_t1(&db, a);
    // In t1, m1 is read and m2 unread; both in the Inbox.
    let new = store::new_inbox_messages(&db.conn(), a, &["m1".into(), "m2".into()]).unwrap();
    let m2: MessageId = db
        .conn()
        .query_row(
            "SELECT id FROM messages WHERE gmail_message_id = 'm2'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(new, vec![m2]);
    assert!(store::new_inbox_messages(&db.conn(), a, &[])
        .unwrap()
        .is_empty());
}

#[test]
fn all_new_mail_includes_archived_but_not_spam_or_trash() {
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db, "a");
    load_t1(&db, a);
    let ids = ["m1".to_string(), "m2".to_string()];
    let m2: MessageId = db
        .conn()
        .query_row(
            "SELECT id FROM messages WHERE gmail_message_id = 'm2'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    // Skipped the Inbox (a rule archived it): new, but not new in the Inbox.
    db.conn()
        .execute(
            "DELETE FROM message_labels WHERE message_id = ?1 AND label_id IN
               (SELECT id FROM labels WHERE gmail_label_id = 'INBOX')",
            [m2],
        )
        .unwrap();
    assert!(store::new_inbox_messages(&db.conn(), a, &ids)
        .unwrap()
        .is_empty());
    assert_eq!(
        store::new_unread_messages(&db.conn(), a, &ids).unwrap(),
        vec![m2]
    );
    // In Spam: never.
    db.conn()
        .execute(
            "INSERT OR IGNORE INTO labels (account_id, gmail_label_id, name, kind)
             VALUES (?1, 'SPAM', 'SPAM', 'system')",
            [a],
        )
        .unwrap();
    db.conn()
        .execute(
            "INSERT INTO message_labels (account_id, message_id, label_id)
             SELECT ?1, ?2, id FROM labels WHERE account_id = ?1 AND gmail_label_id = 'SPAM'",
            rusqlite::params![a, m2],
        )
        .unwrap();
    assert!(store::new_unread_messages(&db.conn(), a, &ids)
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn senders_say_who_has_unread_mail_and_follow_read_changes() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/gmail/v1/users/me/threads/t1/modify"))
        .respond_with(ResponseTemplate::new(200).set_body_raw("{}", "application/json"))
        .mount(&server)
        .await;
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db, "a");
    let t1 = load_t1(&db, a);
    // In t1, Jane's message is read and Bob's isn't.
    let who = |db: &Db| -> Vec<(String, bool)> {
        query::thread_summary(&db.conn(), t1)
            .unwrap()
            .senders
            .into_iter()
            .map(|s| (s.email, s.unread))
            .collect()
    };
    assert_eq!(
        who(&db),
        vec![
            ("jane@example.com".into(), false),
            ("bob@example.com".into(), true)
        ]
    );
    let uri = server.uri();
    actions::set_read(&db, |_| Ok(client(&uri).0), &[t1], true)
        .await
        .unwrap();
    assert!(who(&db).iter().all(|(_, unread)| !unread));
}
