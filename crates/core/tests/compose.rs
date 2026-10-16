//! Sending goes through the From account, threads replies in that
//! account only, is never sent twice, and caches the result at once.

mod common;

use common::*;
use mailboat_core::compose::{self, identities, OutgoingMessage};
use mailboat_core::db::{accounts, store, Db};
use mailboat_core::gmail::parse;
use mailboat_core::gmail::types::{SendAs, Thread};
use mailboat_core::model::*;
use mailboat_core::CoreError;
use wiremock::matchers::{method, path, query_param};
use wiremock::{Mock, MockServer, Request, ResponseTemplate};

fn add_account(db: &Db, sub: &str) -> AccountId {
    accounts::upsert(
        &db.conn(),
        &accounts::NewAccount {
            google_sub: sub,
            email: &format!("{sub}@x.com"),
            display_name: Some("Me"),
            avatar_url: None,
            oauth_client: "default",
        },
    )
    .unwrap()
    .id
}

fn load_t1(db: &Db, account: AccountId) -> ThreadId {
    let t: Thread = serde_json::from_str(&fixture("thread_t1.json")).unwrap();
    store::upsert_thread(&mut db.conn(), account, &parse::thread_to_incoming(&t)).unwrap()
}

fn message_id(db: &Db, account: AccountId, gmail_id: &str) -> MessageId {
    db.conn()
        .query_row(
            "SELECT id FROM messages WHERE account_id = ?1 AND gmail_message_id = ?2",
            rusqlite::params![account, gmail_id],
            |r| r.get(0),
        )
        .unwrap()
}

fn addr(email: &str) -> Address {
    Address {
        name: None,
        email: email.into(),
    }
}

fn outgoing(account: AccountId, from: &str, replying_to: Option<MessageId>) -> OutgoingMessage {
    OutgoingMessage {
        account_id: account,
        from: addr(from),
        to: vec![addr("bob@example.com")],
        cc: vec![],
        bcc: vec![],
        subject: "Re: Lunch Friday".into(),
        text: "See you there".into(),
        html: None,
        attachments: vec![],
        draft: None,
        replying_to,
    }
}

/// The decoded raw message of a `messages.send` request.
/// The raw message and thread of a `messages.send` upload (multipart/related:
/// JSON metadata, then the message).
fn sent_raw(request: &Request) -> (String, Option<String>) {
    let body = String::from_utf8(request.body.clone()).unwrap();
    let json_start = body.find("\r\n\r\n").unwrap() + 4;
    let json_end = json_start + body[json_start..].find("\r\n--").unwrap();
    let meta: serde_json::Value = serde_json::from_str(&body[json_start..json_end]).unwrap();
    let raw_start = body.find("message/rfc822\r\n\r\n").unwrap() + 18;
    let raw_end = body.rfind("\r\n--").unwrap();
    (
        body[raw_start..raw_end].to_string(),
        meta["threadId"].as_str().map(str::to_string),
    )
}

async fn mount_send(server: &MockServer, thread: &str) {
    Mock::given(method("POST"))
        .and(path("/upload/gmail/v1/users/me/messages/send"))
        .respond_with(ResponseTemplate::new(200).set_body_json(
            serde_json::json!({ "id": "sent1", "threadId": thread, "labelIds": ["SENT"] }),
        ))
        .expect(1)
        .mount(server)
        .await;
    Mock::given(method("GET"))
        .and(path(format!("/gmail/v1/users/me/threads/{thread}")))
        .respond_with(
            ResponseTemplate::new(200).set_body_raw(fixture("thread_t1.json"), "application/json"),
        )
        .mount(server)
        .await;
}

#[tokio::test]
async fn a_reply_joins_the_thread_with_threading_headers() {
    let server = MockServer::start().await;
    mount_send(&server, "t1").await;
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db, "a");
    let t1 = load_t1(&db, a);
    let m2 = message_id(&db, a, "m2");

    let (gmail, _) = client(&server.uri());
    let thread = compose::send(&db, &gmail, &outgoing(a, "a@x.com", Some(m2)))
        .await
        .unwrap();
    assert_eq!(thread, Some(t1));

    let requests = server.received_requests().await.unwrap();
    let send = requests
        .iter()
        .find(|r| r.url.path().ends_with("/messages/send"))
        .unwrap();
    let (raw, thread_id) = sent_raw(send);
    assert_eq!(thread_id.as_deref(), Some("t1"));
    assert!(raw.contains("In-Reply-To: <a2@example.com>"), "{raw}");
    assert!(
        raw.contains("References: <a1@example.com> <a2@example.com>"),
        "{raw}"
    );
    assert!(
        raw.contains("From: \"Me\" <a@x.com>") || raw.contains("From: <a@x.com>"),
        "{raw}"
    );
}

#[tokio::test]
async fn a_reply_from_another_account_starts_its_own_thread() {
    // Rule 8: threads never merge across accounts. Account B answers
    // account A's message: same headers, but no threadId, and the new
    // thread is cached under B.
    let server_b = MockServer::start().await;
    mount_send(&server_b, "tb").await;
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db, "a");
    let b = add_account(&db, "b");
    load_t1(&db, a);
    let m2 = message_id(&db, a, "m2");

    let (gmail_b, _) = client(&server_b.uri());
    let thread = compose::send(&db, &gmail_b, &outgoing(b, "b@x.com", Some(m2)))
        .await
        .unwrap()
        .unwrap();

    let requests = server_b.received_requests().await.unwrap();
    let (raw, thread_id) = sent_raw(&requests[0]);
    assert_eq!(thread_id, None);
    assert!(raw.contains("In-Reply-To: <a2@example.com>"), "{raw}");
    let owner: AccountId = db
        .conn()
        .query_row(
            "SELECT account_id FROM threads WHERE id = ?1",
            [thread],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(owner, b);
}

#[tokio::test]
async fn a_server_error_while_sending_is_not_retried() {
    // The mail may already have gone: sending again could deliver it twice.
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/upload/gmail/v1/users/me/messages/send"))
        .respond_with(ResponseTemplate::new(503))
        .expect(1)
        .mount(&server)
        .await;
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db, "a");
    let (gmail, _) = client(&server.uri());
    let err = compose::send(&db, &gmail, &outgoing(a, "a@x.com", None))
        .await
        .unwrap_err();
    assert!(matches!(err, CoreError::Api { status: 503, .. }), "{err:?}");
}

#[tokio::test]
async fn a_rate_limit_while_sending_is_retried() {
    // Google refuses before accepting anything, so trying again is safe.
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/upload/gmail/v1/users/me/messages/send"))
        .respond_with(ResponseTemplate::new(429))
        .up_to_n_times(1)
        .mount(&server)
        .await;
    mount_send(&server, "tn").await;
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db, "a");
    let (gmail, _) = client(&server.uri());
    compose::send(&db, &gmail, &outgoing(a, "a@x.com", None))
        .await
        .unwrap();
}

#[tokio::test]
async fn from_must_be_one_of_the_accounts_addresses() {
    let server = MockServer::start().await;
    Mock::given(wiremock::matchers::any())
        .respond_with(ResponseTemplate::new(500))
        .expect(0)
        .mount(&server)
        .await;
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db, "a");
    add_account(&db, "b");
    let (gmail, _) = client(&server.uri());
    // B's address can't be used with A's account.
    let err = compose::send(&db, &gmail, &outgoing(a, "b@x.com", None))
        .await
        .unwrap_err();
    assert!(matches!(err, CoreError::Invalid(_)), "{err:?}");

    let mut none = outgoing(a, "a@x.com", None);
    none.to.clear();
    assert!(matches!(
        compose::send(&db, &gmail, &none).await.unwrap_err(),
        CoreError::Invalid(_)
    ));

    let mut bad = outgoing(a, "a@x.com", None);
    bad.to = vec![addr("bob@example.com>\r\nBcc: x@evil.com")];
    assert!(matches!(
        compose::send(&db, &gmail, &bad).await.unwrap_err(),
        CoreError::Invalid(_)
    ));
}

#[tokio::test]
async fn aliases_come_from_gmail_and_unverified_ones_are_left_out() {
    let server = MockServer::start().await;
    Mock::given(path("/gmail/v1/users/me/settings/sendAs"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "sendAs": [
                { "sendAsEmail": "a@x.com", "displayName": "", "isPrimary": true,
                  "signature": "<b>A</b>" },
                { "sendAsEmail": "alias@x.com", "displayName": "Alias", "isDefault": true,
                  "verificationStatus": "accepted" },
                { "sendAsEmail": "pending@x.com", "verificationStatus": "pending" }
            ]
        })))
        .mount(&server)
        .await;
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db, "a");
    let b = add_account(&db, "b");
    let (gmail, _) = client(&server.uri());
    identities::refresh(&db, &gmail, a).await.unwrap();

    let list = identities::list(&db.conn()).unwrap();
    let summary: Vec<(AccountId, &str, Option<&str>, bool)> = list
        .iter()
        .map(|i| {
            (
                i.account_id,
                i.email.as_str(),
                i.name.as_deref(),
                i.is_default,
            )
        })
        .collect();
    assert_eq!(
        summary,
        vec![
            (a, "alias@x.com", Some("Alias"), true),
            // The main address's blank name falls back to the account's.
            (a, "a@x.com", Some("Me"), false),
            // B was never fetched: its own address still works.
            (b, "b@x.com", Some("Me"), true),
        ]
    );
    assert_eq!(list[1].signature.as_deref(), Some("<b>A</b>"));
    assert!(identities::owns(&db.conn(), a, "ALIAS@x.com").unwrap());
    assert!(!identities::owns(&db.conn(), a, "pending@x.com").unwrap());

    // Refreshing replaces the list rather than adding to it.
    identities::store(
        &mut db.conn(),
        a,
        &[SendAs {
            send_as_email: "a@x.com".into(),
            display_name: None,
            reply_to_address: None,
            signature: None,
            is_primary: true,
            is_default: true,
            verification_status: None,
        }],
    )
    .unwrap();
    let a_count = identities::list(&db.conn())
        .unwrap()
        .iter()
        .filter(|i| i.account_id == a)
        .count();
    assert_eq!(a_count, 1);
}

#[tokio::test]
async fn reply_source_fetches_reply_to_once_when_unknown() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/gmail/v1/users/me/messages/m2"))
        .and(query_param("format", "metadata"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": "m2", "threadId": "t1",
            "payload": { "headers": [
                { "name": "From", "value": "Bob Smith <bob@example.com>" },
                { "name": "Reply-To", "value": "List <list@example.com>" }
            ]}
        })))
        .expect(1)
        .mount(&server)
        .await;
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db, "a");
    load_t1(&db, a);
    let m2 = message_id(&db, a, "m2");
    // As if synced before Mailboat asked for Reply-To.
    db.conn()
        .execute("UPDATE messages SET reply_to_json = NULL", [])
        .unwrap();
    store::set_body(
        &mut db.conn(),
        m2,
        &store::StoredBody {
            html: None,
            text: Some("Yes! See you at noon.".into()),
        },
        &[],
    )
    .unwrap();

    let (gmail, _) = client(&server.uri());
    let source = compose::reply_source(&db, &gmail, m2).await.unwrap();
    assert_eq!(
        source.reply_to,
        vec![Address {
            name: Some("List".into()),
            email: "list@example.com".into()
        }]
    );
    assert_eq!(source.text, "Yes! See you at noon.");
    assert_eq!(source.html, None, "plain-text mail has no HTML to quote");
    assert_eq!(source.from.email, "bob@example.com");
    assert_eq!(source.cc[0].email, "jane@example.com");
    // Remembered: the second time asks Gmail nothing (expect(1) above).
    compose::reply_source(&db, &gmail, m2).await.unwrap();
}

#[tokio::test]
async fn sync_records_reply_to() {
    let t: Thread = serde_json::from_value(serde_json::json!({
        "id": "t9",
        "messages": [{
            "id": "m9", "threadId": "t9", "internalDate": "1",
            "payload": { "headers": [
                { "name": "From", "value": "a@y.com" },
                { "name": "Reply-To", "value": "b@y.com" }
            ]}
        }]
    }))
    .unwrap();
    let incoming = parse::thread_to_incoming(&t);
    assert_eq!(incoming.messages[0].reply_to[0].email, "b@y.com");
}

async fn mount_drafts(server: &MockServer, id: &str) {
    let draft = serde_json::json!({ "id": id, "message": { "id": "dm", "threadId": "dt" } });
    Mock::given(method("POST"))
        .and(path("/upload/gmail/v1/users/me/drafts"))
        .respond_with(ResponseTemplate::new(200).set_body_json(draft.clone()))
        .mount(server)
        .await;
    Mock::given(method("PUT"))
        .and(path(format!("/upload/gmail/v1/users/me/drafts/{id}")))
        .respond_with(ResponseTemplate::new(200).set_body_json(draft))
        .mount(server)
        .await;
    Mock::given(method("DELETE"))
        .and(path(format!("/gmail/v1/users/me/drafts/{id}")))
        .respond_with(ResponseTemplate::new(204))
        .mount(server)
        .await;
}

fn calls(requests: &[Request], verb: &str) -> usize {
    requests
        .iter()
        .filter(|r| r.method.as_str() == verb)
        .count()
}

#[tokio::test]
async fn drafts_are_created_once_then_updated_and_deleted() {
    let server = MockServer::start().await;
    mount_drafts(&server, "d1").await;
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db, "a");
    let uri = server.uri();
    let gmail_for = |_| Ok(client(&uri).0);

    let mut msg = outgoing(a, "a@x.com", None);
    // Half-typed recipients don't go into the saved copy.
    msg.cc = vec![addr("bob")];
    let id = compose::save_draft(&db, gmail_for, None, &msg)
        .await
        .unwrap();
    let again = compose::save_draft(&db, gmail_for, Some(id), &msg)
        .await
        .unwrap();
    assert_eq!(id, again, "the same draft is updated, not a new one made");

    let requests = server.received_requests().await.unwrap();
    assert_eq!((calls(&requests, "POST"), calls(&requests, "PUT")), (1, 1));
    let (raw, _) = sent_raw(&requests[0]);
    assert!(!raw.contains("Cc:"), "{raw}");

    compose::delete_draft(&db, &gmail_for, id).await.unwrap();
    let left: i64 = db
        .conn()
        .query_row("SELECT COUNT(*) FROM drafts", [], |r| r.get(0))
        .unwrap();
    assert_eq!(left, 0);
    // Deleting again (already gone) is fine.
    compose::delete_draft(&db, &gmail_for, id).await.unwrap();
}

#[tokio::test]
async fn a_draft_moves_when_from_changes_account() {
    let server_a = MockServer::start().await;
    let server_b = MockServer::start().await;
    mount_drafts(&server_a, "da").await;
    mount_drafts(&server_b, "db").await;
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db, "a");
    let b = add_account(&db, "b");
    let (ua, ub) = (server_a.uri(), server_b.uri());
    let gmail_for = |acct: AccountId| Ok(client(if acct == a { &ua } else { &ub }).0);

    let id = compose::save_draft(&db, gmail_for, None, &outgoing(a, "a@x.com", None))
        .await
        .unwrap();
    let moved = compose::save_draft(&db, gmail_for, Some(id), &outgoing(b, "b@x.com", None))
        .await
        .unwrap();
    // (SQLite may reuse the freed row number; the UI always keeps the ID
    // returned by the latest save.)
    let _ = id;
    let on_a = server_a.received_requests().await.unwrap();
    let on_b = server_b.received_requests().await.unwrap();
    assert_eq!(calls(&on_a, "DELETE"), 1, "A's copy is deleted");
    assert_eq!(calls(&on_b, "POST"), 1, "B gets its own");
    let owner: AccountId = db
        .conn()
        .query_row(
            "SELECT account_id FROM drafts WHERE id = ?1",
            [moved],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(owner, b);
}
