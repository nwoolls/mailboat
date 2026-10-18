//! Rules (Gmail filters): listing, creating, editing (Gmail has no update,
//! so it's create-then-delete), deleting, and applying to existing mail.

mod common;

use common::*;
use mailboat_core::auth::oauth::GMAIL_SETTINGS_SCOPE;
use mailboat_core::db::{accounts, Db};
use mailboat_core::model::*;
use mailboat_core::rules::{self, Importance, RuleActions, RuleCriteria, RulesState};
use mailboat_core::CoreError;
use serde_json::json;
use wiremock::matchers::{body_json, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

const FILTERS: &str = "/gmail/v1/users/me/settings/filters";

/// An account whose sign-in covers Gmail's settings, with one user label.
fn setup() -> (Db, AccountId, LabelId) {
    let db = Db::open_in_memory().unwrap();
    let a = accounts::upsert(
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
    .id;
    accounts::set_granted_scopes(&db.conn(), a, &[GMAIL_SETTINGS_SCOPE.to_string()]).unwrap();
    db.conn()
        .execute(
            "INSERT INTO labels (account_id, gmail_label_id, name, kind) VALUES (?1, 'Label_1', 'News', 'user')",
            [a],
        )
        .unwrap();
    let label = db
        .conn()
        .query_row(
            "SELECT id FROM labels WHERE gmail_label_id = 'Label_1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    (db, a, label)
}

fn from(addr: &str) -> RuleCriteria {
    RuleCriteria {
        from: addr.into(),
        ..Default::default()
    }
}

fn news_filter(id: &str) -> serde_json::Value {
    json!({
        "id": id,
        "criteria": { "from": "news@x.com" },
        "action": { "addLabelIds": ["Label_1"], "removeLabelIds": ["INBOX"] }
    })
}

#[tokio::test]
async fn lists_rules_and_learns_new_labels() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(FILTERS))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "filter": [
                news_filter("f1"),
                { "id": "f2", "criteria": { "subject": "Receipt" },
                  "action": { "addLabelIds": ["Label_2", "STARRED"] } }
            ]
        })))
        .mount(&server)
        .await;
    // Label_2 was made in Gmail since the last sync: labels refresh once.
    Mock::given(method("GET"))
        .and(path("/gmail/v1/users/me/labels"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "labels": [
                { "id": "Label_1", "name": "News", "type": "user" },
                { "id": "Label_2", "name": "Receipts", "type": "user" }
            ]
        })))
        .expect(1)
        .mount(&server)
        .await;
    let (db, a, news) = setup();
    let (gmail, _) = client(&server.uri());

    let listed = rules::list(&db, &gmail, a).await.unwrap();
    let RulesState::Ready { rules } = listed.state else {
        panic!("{listed:?}");
    };
    assert_eq!(rules.len(), 2);
    assert_eq!(rules[0].filter_id, "f1");
    assert_eq!(rules[0].criteria.from, "news@x.com");
    assert_eq!(rules[0].actions.labels, [news]);
    assert!(rules[0].actions.skip_inbox);
    let receipts: LabelId = db
        .conn()
        .query_row(
            "SELECT id FROM labels WHERE gmail_label_id = 'Label_2'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(rules[1].actions.labels, [receipts]);
    assert!(rules[1].actions.star);
}

#[tokio::test]
async fn an_account_without_the_permission_asks_to_sign_in_again() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(FILTERS))
        .respond_with(ResponseTemplate::new(403).set_body_json(json!({
            "error": { "code": 403, "message": "Request had insufficient authentication scopes.", "errors": [] }
        })))
        .mount(&server)
        .await;
    let (db, a, _) = setup();
    let (gmail, _) = client(&server.uri());
    // Google says so even though Mailboat thought the sign-in covered it.
    let listed = rules::list(&db, &gmail, a).await.unwrap();
    assert_eq!(listed.state, RulesState::NeedsSignIn);
    // Recorded as missing: Gmail isn't asked at all.
    accounts::set_granted_scopes(&db.conn(), a, &["openid".to_string()]).unwrap();
    let listed = rules::list(&db, &gmail, a).await.unwrap();
    assert_eq!(listed.state, RulesState::NeedsSignIn);
    assert_eq!(server.received_requests().await.unwrap().len(), 1);
}

#[tokio::test]
async fn creates_a_rule_and_applies_it_to_existing_mail() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(FILTERS))
        .and(body_json(json!({
            "criteria": { "from": "news@x.com" },
            "action": { "addLabelIds": ["Label_1"], "removeLabelIds": ["INBOX"] }
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(news_filter("f9")))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/gmail/v1/users/me/messages"))
        .and(query_param("q", "from:(news@x.com)"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "messages": [{ "id": "m1", "threadId": "t1" }, { "id": "m2", "threadId": "t1" }]
        })))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/gmail/v1/users/me/messages/batchModify"))
        .and(body_json(json!({
            "ids": ["m1", "m2"],
            "addLabelIds": ["Label_1"],
            "removeLabelIds": ["INBOX"]
        })))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;
    let (db, a, news) = setup();
    let (gmail, _) = client(&server.uri());
    let actions = RuleActions {
        skip_inbox: true,
        labels: vec![news],
        ..Default::default()
    };
    let saved = rules::create(&db, &gmail, a, &from("news@x.com"), &actions, true)
        .await
        .unwrap();
    assert_eq!(saved.rule.filter_id, "f9");
    assert_eq!(saved.rule.account_id, a);
    let applied = saved.applied.unwrap();
    assert_eq!(applied.messages, 2);
    assert!(!applied.capped);
    assert_eq!(saved.apply_error, None);
}

#[tokio::test]
async fn editing_replaces_the_filter_and_keeps_forwarding() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(format!("{FILTERS}/f1")))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "id": "f1",
            "criteria": { "from": "news@x.com" },
            "action": { "removeLabelIds": ["INBOX"], "forward": "me@elsewhere.com" }
        })))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(FILTERS))
        .and(body_json(json!({
            "criteria": { "from": "news@x.com" },
            "action": {
                "addLabelIds": ["IMPORTANT"],
                "removeLabelIds": ["INBOX"],
                "forward": "me@elsewhere.com"
            }
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "id": "f2",
            "criteria": { "from": "news@x.com" },
            "action": {
                "addLabelIds": ["IMPORTANT"],
                "removeLabelIds": ["INBOX"],
                "forward": "me@elsewhere.com"
            }
        })))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("DELETE"))
        .and(path(format!("{FILTERS}/f1")))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;
    let (db, a, _) = setup();
    let (gmail, _) = client(&server.uri());
    let actions = RuleActions {
        skip_inbox: true,
        importance: Importance::Always,
        ..Default::default()
    };
    let saved = rules::update(&db, &gmail, a, "f1", &from("news@x.com"), &actions, false)
        .await
        .unwrap();
    assert_eq!(saved.rule.filter_id, "f2");
    assert_eq!(
        saved.rule.actions.forward_to.as_deref(),
        Some("me@elsewhere.com")
    );
    assert_eq!(saved.applied, None);
}

#[tokio::test]
async fn saving_an_unchanged_rule_changes_nothing() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(format!("{FILTERS}/f1")))
        .respond_with(ResponseTemplate::new(200).set_body_json(news_filter("f1")))
        .mount(&server)
        .await;
    let (db, a, news) = setup();
    let (gmail, _) = client(&server.uri());
    let actions = RuleActions {
        skip_inbox: true,
        labels: vec![news],
        ..Default::default()
    };
    let saved = rules::update(&db, &gmail, a, "f1", &from(" news@x.com "), &actions, false)
        .await
        .unwrap();
    assert_eq!(saved.rule.filter_id, "f1");
    // Only the read: no create, no delete.
    assert_eq!(server.received_requests().await.unwrap().len(), 1);
}

#[tokio::test]
async fn a_failed_edit_leaves_the_old_rule_alone() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(format!("{FILTERS}/f1")))
        .respond_with(ResponseTemplate::new(200).set_body_json(news_filter("f1")))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(FILTERS))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "id": "f2", "criteria": { "from": "other@x.com" },
            "action": { "addLabelIds": ["STARRED"] }
        })))
        .mount(&server)
        .await;
    // Deleting the old one fails...
    Mock::given(method("DELETE"))
        .and(path(format!("{FILTERS}/f1")))
        .respond_with(ResponseTemplate::new(400).set_body_json(json!({
            "error": { "code": 400, "message": "Bad request", "errors": [] }
        })))
        .mount(&server)
        .await;
    // ...so the new one is taken back out.
    Mock::given(method("DELETE"))
        .and(path(format!("{FILTERS}/f2")))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;
    let (db, a, _) = setup();
    let (gmail, _) = client(&server.uri());
    let star = RuleActions {
        star: true,
        ..Default::default()
    };
    let err = rules::update(&db, &gmail, a, "f1", &from("other@x.com"), &star, false)
        .await
        .unwrap_err();
    assert!(matches!(err, CoreError::Api { status: 400, .. }), "{err:?}");
}

#[tokio::test]
async fn a_duplicate_rule_is_refused_kindly() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(FILTERS))
        .respond_with(ResponseTemplate::new(400).set_body_json(json!({
            "error": { "code": 400, "message": "Filter already exists", "errors": [] }
        })))
        .mount(&server)
        .await;
    let (db, a, _) = setup();
    let (gmail, _) = client(&server.uri());
    let star = RuleActions {
        star: true,
        ..Default::default()
    };
    let err = rules::create(&db, &gmail, a, &from("a@x.com"), &star, false)
        .await
        .unwrap_err();
    assert!(
        matches!(&err, CoreError::Invalid(m) if m.contains("already")),
        "{err:?}"
    );
}

#[tokio::test]
async fn counts_matching_conversations() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/gmail/v1/users/me/threads"))
        .and(query_param("q", "from:(news@x.com) has:attachment"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "threads": [{ "id": "t1" }, { "id": "t2" }, { "id": "t3" }],
            "nextPageToken": "more"
        })))
        .mount(&server)
        .await;
    let (gmail, _) = client(&server.uri());
    let criteria = RuleCriteria {
        has_attachment: true,
        ..from("news@x.com")
    };
    let count = rules::match_count(&gmail, &criteria)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(count.conversations, 3);
    assert!(count.more);
    // Nothing filled in: nothing to count, and Gmail isn't asked.
    assert_eq!(
        rules::match_count(&gmail, &RuleCriteria::default())
            .await
            .unwrap(),
        None
    );
    assert_eq!(server.received_requests().await.unwrap().len(), 1);
}

#[tokio::test]
async fn deleting_a_rule_already_gone_is_fine() {
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path(format!("{FILTERS}/f1")))
        .respond_with(ResponseTemplate::new(404).set_body_json(json!({
            "error": { "code": 404, "message": "Filter not found", "errors": [] }
        })))
        .mount(&server)
        .await;
    let (gmail, _) = client(&server.uri());
    rules::delete(&gmail, "f1").await.unwrap();
}
