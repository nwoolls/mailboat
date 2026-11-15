//! Creating, renaming and deleting user labels goes to the owning account
//! and keeps the cache in step.

mod common;

use common::*;
use mail_core::db::{accounts, query, store, Db};
use mail_core::gmail::parse;
use mail_core::gmail::types::Thread;
use mail_core::labels;
use mail_core::model::*;
use mail_core::CoreError;
use wiremock::matchers::{body_json, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn add_account(db: &Db) -> AccountId {
    accounts::upsert(
        &db.conn(),
        &accounts::NewAccount {
            google_sub: "a",
            email: "a@x.example",
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

/// A label as Gmail's `labels.get` answers, with the counts it adds.
fn gmail_label(extra: serde_json::Value) -> serde_json::Value {
    let mut label = serde_json::json!({
        "id": "Label_9",
        "name": "Receipts",
        "type": "user",
        "labelListVisibility": "labelShow",
        "messageListVisibility": "show",
        "messagesTotal": 12,
        "threadsUnread": 2,
    });
    for (k, v) in extra.as_object().unwrap() {
        label[k] = v.clone();
    }
    label
}

async fn label_server(current: serde_json::Value, written: serde_json::Value) -> MockServer {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/gmail/v1/users/me/labels/Label_9"))
        .respond_with(ResponseTemplate::new(200).set_body_json(current))
        .mount(&server)
        .await;
    Mock::given(method("PUT"))
        .and(path("/gmail/v1/users/me/labels/Label_9"))
        .and(body_json(written))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({})))
        .expect(1)
        .mount(&server)
        .await;
    server
}

fn receipts(db: &Db, a: AccountId) -> LabelId {
    db.conn()
        .execute(
            "INSERT INTO labels (account_id, gmail_label_id, name, kind) VALUES (?1, 'Label_9', 'Receipts', 'user')",
            [a],
        )
        .unwrap();
    label_named(db, "Receipts").unwrap()
}

fn cached(db: &Db, a: AccountId) -> Label {
    query::user_labels(&db.conn(), &AccountFilter::Only(vec![a]))
        .unwrap()
        .into_iter()
        .find(|l| l.name == "Receipts")
        .unwrap()
}

#[tokio::test]
async fn a_color_is_written_back_whole_with_readable_text_and_cached() {
    // What Gmail has now is kept (here a hidden-from-the-list setting made
    // elsewhere); only the color changes, and the counts aren't sent back.
    let server = label_server(
        gmail_label(serde_json::json!({ "messageListVisibility": "hide" })),
        serde_json::json!({
            "id": "Label_9",
            "name": "Receipts",
            "type": "user",
            "labelListVisibility": "labelShow",
            "messageListVisibility": "hide",
            "color": { "backgroundColor": "#4a86e8", "textColor": "#000000" },
        }),
    )
    .await;
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db);
    let id = receipts(&db, a);
    let uri = server.uri();
    labels::change(
        &db,
        |_| Ok(client(&uri).0),
        id,
        labels::LabelChange::Color(Some("#4a86e8".into())),
    )
    .await
    .unwrap();
    let label = cached(&db, a);
    assert_eq!(label.color_bg.as_deref(), Some("#4a86e8"));
    // Black reads better than white on this mid blue.
    assert_eq!(label.color_fg.as_deref(), Some("#000000"));
}

#[tokio::test]
async fn no_color_leaves_the_color_out() {
    let server = label_server(
        gmail_label(serde_json::json!({
            "color": { "backgroundColor": "#fad165", "textColor": "#000000" },
        })),
        serde_json::json!({
            "id": "Label_9",
            "name": "Receipts",
            "type": "user",
            "labelListVisibility": "labelShow",
            "messageListVisibility": "show",
        }),
    )
    .await;
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db);
    let id = receipts(&db, a);
    db.conn()
        .execute(
            "UPDATE labels SET color_bg = '#fad165', color_fg = '#000000' WHERE id = ?1",
            [id],
        )
        .unwrap();
    let uri = server.uri();
    labels::change(
        &db,
        |_| Ok(client(&uri).0),
        id,
        labels::LabelChange::Color(None),
    )
    .await
    .unwrap();
    let label = cached(&db, a);
    assert_eq!((label.color_bg, label.color_fg), (None, None));
}

#[tokio::test]
async fn where_a_label_shows_is_written_and_cached() {
    let server = label_server(
        gmail_label(serde_json::json!({})),
        serde_json::json!({
            "id": "Label_9",
            "name": "Receipts",
            "type": "user",
            "labelListVisibility": "labelHide",
            "messageListVisibility": "show",
        }),
    )
    .await;
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db);
    let id = receipts(&db, a);
    let uri = server.uri();
    labels::change(
        &db,
        |_| Ok(client(&uri).0),
        id,
        labels::LabelChange::Sidebar(LabelSidebar::Hide),
    )
    .await
    .unwrap();
    assert_eq!(cached(&db, a).sidebar, LabelSidebar::Hide);

    let server = label_server(
        gmail_label(serde_json::json!({ "labelListVisibility": "labelHide" })),
        serde_json::json!({
            "id": "Label_9",
            "name": "Receipts",
            "type": "user",
            "labelListVisibility": "labelHide",
            "messageListVisibility": "hide",
        }),
    )
    .await;
    let uri = server.uri();
    labels::change(
        &db,
        |_| Ok(client(&uri).0),
        id,
        labels::LabelChange::OnConversations(false),
    )
    .await
    .unwrap();
    assert!(!cached(&db, a).on_conversations);
}

#[tokio::test]
async fn only_gmails_colors_and_only_your_own_labels() {
    let server = MockServer::start().await;
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db);
    let id = receipts(&db, a);
    let uri = server.uri();
    let err = labels::change(
        &db,
        |_| Ok(client(&uri).0),
        id,
        labels::LabelChange::Color(Some("#123456".into())),
    )
    .await
    .unwrap_err();
    assert!(matches!(err, CoreError::Invalid(_)), "{err:?}");
    db.conn()
        .execute(
            "INSERT INTO labels (account_id, gmail_label_id, name, kind) VALUES (?1, 'INBOX', 'INBOX', 'system')",
            [a],
        )
        .unwrap();
    let inbox = label_named(&db, "INBOX").unwrap();
    let err = labels::change(
        &db,
        |_| Ok(client(&uri).0),
        inbox,
        labels::LabelChange::Sidebar(LabelSidebar::Hide),
    )
    .await
    .unwrap_err();
    assert!(matches!(err, CoreError::Invalid(_)), "{err:?}");
    // Nothing reached Gmail.
    assert!(server.received_requests().await.unwrap().is_empty());
}

#[test]
fn every_palette_color_gets_readable_text() {
    assert_eq!(labels::PALETTE.len(), 64);
    assert_eq!(labels::text_color_for("#000000"), "#ffffff");
    assert_eq!(labels::text_color_for("#ffffff"), "#000000");
    assert_eq!(labels::text_color_for("#fad165"), "#000000");
    assert_eq!(labels::text_color_for("#1c4587"), "#ffffff");
    // Every color gets text at WCAG AA's 4.5:1 or better.
    for color in labels::PALETTE {
        let text = labels::text_color_for(color);
        assert!(["#000000", "#ffffff"].contains(&text));
        let ratio = labels::contrast(color, text);
        assert!(ratio >= 4.5, "{color} with {text}: {ratio:.2}");
    }
}

#[test]
fn a_label_sync_keeps_where_each_label_shows() {
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db);
    let label = |id: &str, name: &str, list: &str, message: &str| store::IncomingLabel {
        gmail_label_id: id.into(),
        name: name.into(),
        kind: LabelKind::User,
        color_bg: None,
        color_fg: None,
        list_visibility: list.into(),
        message_visibility: message.into(),
    };
    store::sync_labels(
        &mut db.conn(),
        a,
        &[
            label("Label_1", "Always", "labelShow", "show"),
            label("Label_2", "Unread", "labelShowIfUnread", "show"),
            label("Label_3", "Hidden", "labelHide", "hide"),
        ],
    )
    .unwrap();
    let got: Vec<(String, LabelSidebar, bool)> =
        query::user_labels(&db.conn(), &AccountFilter::Only(vec![a]))
            .unwrap()
            .into_iter()
            .map(|l| (l.name, l.sidebar, l.on_conversations))
            .collect();
    assert_eq!(
        got,
        vec![
            ("Always".into(), LabelSidebar::Show, true),
            ("Hidden".into(), LabelSidebar::Hide, false),
            ("Unread".into(), LabelSidebar::ShowIfUnread, true),
        ]
    );
}

/// Two changes to one label at once take turns: each reads the label after
/// the other has written it, so neither undoes the other (review).
#[tokio::test]
async fn changes_to_one_label_take_turns() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/gmail/v1/users/me/labels/Label_9"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(gmail_label(serde_json::json!({})))
                .set_delay(std::time::Duration::from_millis(200)),
        )
        .mount(&server)
        .await;
    Mock::given(method("PUT"))
        .and(path("/gmail/v1/users/me/labels/Label_9"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({})))
        .mount(&server)
        .await;
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db);
    let id = receipts(&db, a);
    let uri = server.uri();
    let gmail_for = |_| Ok(client(&uri).0);
    let (first, second) = tokio::join!(
        labels::change(
            &db,
            gmail_for,
            id,
            labels::LabelChange::Color(Some("#4a86e8".into()))
        ),
        labels::change(
            &db,
            gmail_for,
            id,
            labels::LabelChange::Sidebar(LabelSidebar::Hide)
        ),
    );
    first.unwrap();
    second.unwrap();
    let methods: Vec<String> = server
        .received_requests()
        .await
        .unwrap()
        .iter()
        .map(|r| r.method.to_string())
        .collect();
    assert_eq!(methods, ["GET", "PUT", "GET", "PUT"]);
}

/// Renaming a parent renames its children in their own turn: a change to a
/// child already under way finishes first, so its whole-label write can't
/// put the old name back after the rename (review).
#[tokio::test]
async fn renaming_a_parent_waits_for_a_change_to_its_child() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/gmail/v1/users/me/labels/Label_10"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(serde_json::json!({
                    "id": "Label_10", "name": "Work/Acme", "type": "user",
                }))
                .set_delay(std::time::Duration::from_millis(300)),
        )
        .mount(&server)
        .await;
    for (verb, id) in [
        ("PUT", "Label_10"),
        ("PATCH", "Label_9"),
        ("PATCH", "Label_10"),
    ] {
        Mock::given(method(verb))
            .and(path(format!("/gmail/v1/users/me/labels/{id}")))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({})))
            .mount(&server)
            .await;
    }
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db);
    db.conn()
        .execute(
            "INSERT INTO labels (account_id, gmail_label_id, name, kind) VALUES
               (?1, 'Label_9', 'Work', 'user'), (?1, 'Label_10', 'Work/Acme', 'user')",
            [a],
        )
        .unwrap();
    let work = label_named(&db, "Work").unwrap();
    let acme = label_named(&db, "Work/Acme").unwrap();
    let uri = server.uri();
    let gmail_for = |_| Ok(client(&uri).0);
    let change = labels::change(
        &db,
        gmail_for,
        acme,
        labels::LabelChange::Color(Some("#4a86e8".into())),
    );
    let rename = async {
        // Starts once the child's change is under way.
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        labels::rename(&db, gmail_for, work, "Jobs").await
    };
    let (changed, renamed) = tokio::join!(change, rename);
    changed.unwrap();
    renamed.unwrap();
    let child: Vec<String> = server
        .received_requests()
        .await
        .unwrap()
        .iter()
        .filter(|r| r.url.path().ends_with("Label_10"))
        .map(|r| r.method.to_string())
        .collect();
    // The rename's write comes after the change's, so the new name stands.
    assert_eq!(child, ["GET", "PUT", "PATCH"]);
    assert_eq!(label_named(&db, "Jobs/Acme"), Some(acme));
}
