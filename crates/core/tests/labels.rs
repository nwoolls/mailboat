//! Creating, renaming and deleting user labels goes to the owning account
//! and keeps the cache in step.

mod common;

use common::*;
use mailboat_core::db::{accounts, query, store, Db};
use mailboat_core::gmail::parse;
use mailboat_core::gmail::types::Thread;
use mailboat_core::labels;
use mailboat_core::model::*;
use mailboat_core::CoreError;
use wiremock::matchers::{body_json, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn add_account(db: &Db) -> AccountId {
    accounts::upsert(
        &db.conn(),
        &accounts::NewAccount {
            google_sub: "a",
            email: "a@x.com",
            display_name: None,
            avatar_url: None,
            oauth_client: "default",
        },
    )
    .unwrap()
    .id
}

fn label_named(db: &Db, name: &str) -> Option<LabelId> {
    db.conn()
        .query_row("SELECT id FROM labels WHERE name = ?1", [name], |r| {
            r.get(0)
        })
        .ok()
}

#[tokio::test]
async fn create_rename_with_children_and_delete() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/gmail/v1/users/me/labels"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(serde_json::json!({ "id": "Label_9", "name": "Work" })),
        )
        .mount(&server)
        .await;
    for (id, name) in [("Label_9", "Jobs"), ("Label_10", "Jobs/Acme")] {
        Mock::given(method("PATCH"))
            .and(path(format!("/gmail/v1/users/me/labels/{id}")))
            .and(body_json(serde_json::json!({ "name": name })))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({})))
            .expect(1)
            .mount(&server)
            .await;
    }
    Mock::given(method("DELETE"))
        .and(path("/gmail/v1/users/me/labels/Label_9"))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db);
    let (gmail, _) = client(&server.uri());
    let uri = server.uri();
    let gmail_for = |_| Ok(client(&uri).0);

    let work = labels::create(&db, &gmail, a, "  Work ").await.unwrap();
    assert_eq!(work.name, "Work");
    // A nested label already in the account.
    db.conn()
        .execute(
            "INSERT INTO labels (account_id, gmail_label_id, name, kind) VALUES (?1, 'Label_10', 'Work/Acme', 'user')",
            [a],
        )
        .unwrap();

    labels::rename(&db, gmail_for, work.id, "Jobs")
        .await
        .unwrap();
    assert!(label_named(&db, "Jobs").is_some());
    assert!(label_named(&db, "Jobs/Acme").is_some(), "children follow");

    // Put the label on a conversation, then delete it: the conversation stays.
    let t: Thread = serde_json::from_str(&fixture("thread_t1.json")).unwrap();
    let thread = store::upsert_thread(&mut db.conn(), a, &parse::thread_to_incoming(&t)).unwrap();
    store::set_thread_label(&mut db.conn(), thread, "Label_9", true).unwrap();
    let before = query::thread_summary(&db.conn(), thread).unwrap().label_ids;
    assert!(before.contains(&work.id));
    labels::delete(&db, gmail_for, work.id).await.unwrap();
    assert!(label_named(&db, "Jobs").is_none());
    let after = query::thread_summary(&db.conn(), thread).unwrap().label_ids;
    assert!(!after.contains(&work.id), "the label came off: {after:?}");
}

#[tokio::test]
async fn a_taken_name_or_a_system_label_is_refused_kindly() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/gmail/v1/users/me/labels"))
        .respond_with(ResponseTemplate::new(409).set_body_json(serde_json::json!({
            "error": { "code": 409, "message": "Label name exists or conflicts", "errors": [] }
        })))
        .mount(&server)
        .await;
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db);
    let (gmail, _) = client(&server.uri());
    let err = labels::create(&db, &gmail, a, "Work").await.unwrap_err();
    assert!(
        matches!(&err, CoreError::Invalid(m) if m.contains("already")),
        "{err:?}"
    );
    assert!(matches!(
        labels::create(&db, &gmail, a, " / ").await.unwrap_err(),
        CoreError::Invalid(_)
    ));

    let t: Thread = serde_json::from_str(&fixture("thread_t1.json")).unwrap();
    store::upsert_thread(&mut db.conn(), a, &parse::thread_to_incoming(&t)).unwrap();
    let inbox = label_named(&db, "INBOX").unwrap();
    let uri = server.uri();
    let err = labels::delete(&db, |_| Ok(client(&uri).0), inbox)
        .await
        .unwrap_err();
    assert!(matches!(err, CoreError::Invalid(_)), "{err:?}");
}
