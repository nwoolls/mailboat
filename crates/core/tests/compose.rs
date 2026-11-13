//! Sending goes through the From account, threads replies in that
//! account only, is never sent twice, and caches the result at once.

mod common;

use common::*;
use mail_core::compose::{self, identities, OutgoingMessage};
use mail_core::db::{accounts, query, store, Db};
use mail_core::gmail::parse;
use mail_core::gmail::types::{SendAs, Thread};
use mail_core::model::*;
use mail_core::CoreError;
use wiremock::matchers::{method, path, query_param};
use wiremock::{Mock, MockServer, Request, ResponseTemplate};

fn add_account(db: &Db, sub: &str) -> AccountId {
    accounts::upsert(
        &db.conn(),
        &accounts::NewAccount {
            google_sub: sub,
            email: &format!("{sub}@x.example"),
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
        forwarded: vec![],
        inline_images: vec![],
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
    let thread = compose::send(&db, &gmail, &outgoing(a, "a@x.example", Some(m2)))
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
        raw.contains("From: \"Me\" <a@x.example>") || raw.contains("From: <a@x.example>"),
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
    let thread = compose::send(&db, &gmail_b, &outgoing(b, "b@x.example", Some(m2)))
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

/// Regression: once Gmail had sent the mail, failing to cache its
/// conversation reported "Couldn't send", which invited sending it twice.
#[tokio::test]
async fn a_sent_message_is_sent_even_if_caching_it_fails() {
    let server = MockServer::start().await;
    mount_send(&server, "t1").await;
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db, "a");
    db.conn()
        .execute_batch(
            "CREATE TRIGGER no_threads BEFORE INSERT ON threads
             BEGIN SELECT RAISE(ABORT, 'disk full'); END;",
        )
        .unwrap();

    let (gmail, _) = client(&server.uri());
    let thread = compose::send(&db, &gmail, &outgoing(a, "a@x.example", None)).await;
    assert_eq!(thread.unwrap(), None, "sent; sync brings it in later");
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
    let err = compose::send(&db, &gmail, &outgoing(a, "a@x.example", None))
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
    compose::send(&db, &gmail, &outgoing(a, "a@x.example", None))
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
    let err = compose::send(&db, &gmail, &outgoing(a, "b@x.example", None))
        .await
        .unwrap_err();
    assert!(matches!(err, CoreError::Invalid(_)), "{err:?}");

    let mut none = outgoing(a, "a@x.example", None);
    none.to.clear();
    assert!(matches!(
        compose::send(&db, &gmail, &none).await.unwrap_err(),
        CoreError::Invalid(_)
    ));

    let mut bad = outgoing(a, "a@x.example", None);
    bad.to = vec![addr("bob@example.com>\r\nBcc: x@evil.example")];
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
                { "sendAsEmail": "a@x.example", "displayName": "", "isPrimary": true,
                  "signature": "<b>A</b>" },
                { "sendAsEmail": "alias@x.example", "displayName": "Alias", "isDefault": true,
                  "verificationStatus": "accepted" },
                { "sendAsEmail": "pending@x.example", "verificationStatus": "pending" }
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
            (a, "alias@x.example", Some("Alias"), true),
            // The main address's blank name falls back to the account's.
            (a, "a@x.example", Some("Me"), false),
            // B was never fetched: its own address still works.
            (b, "b@x.example", Some("Me"), true),
        ]
    );
    assert_eq!(list[1].signature.as_deref(), Some("<b>A</b>"));
    assert!(identities::owns(&db.conn(), a, "ALIAS@x.example").unwrap());
    assert!(!identities::owns(&db.conn(), a, "pending@x.example").unwrap());

    // Refreshing replaces the list rather than adding to it.
    identities::store(
        &mut db.conn(),
        a,
        &[SendAs {
            send_as_email: "a@x.example".into(),
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
    // As if synced before the app asked for Reply-To.
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
                { "name": "From", "value": "a@y.example" },
                { "name": "Reply-To", "value": "b@y.example" }
            ]}
        }]
    }))
    .unwrap();
    let incoming = parse::thread_to_incoming(&t);
    assert_eq!(incoming.messages[0].reply_to[0].email, "b@y.example");
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

    let mut msg = outgoing(a, "a@x.example", None);
    // Half-typed recipients don't go into the saved copy.
    msg.cc = vec![addr("bob")];
    let id = compose::save_draft(&db, gmail_for, None, &msg)
        .await
        .unwrap()
        .id;
    let again = compose::save_draft(&db, gmail_for, Some(id), &msg)
        .await
        .unwrap()
        .id;
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

    let id = compose::save_draft(&db, gmail_for, None, &outgoing(a, "a@x.example", None))
        .await
        .unwrap()
        .id;
    let moved = compose::save_draft(&db, gmail_for, Some(id), &outgoing(b, "b@x.example", None))
        .await
        .unwrap()
        .id;
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

/// Regression: moving a draft deleted the old account's copy first, so if
/// the new account couldn't save it (its sign-in expired) the draft was
/// saved nowhere.
#[tokio::test]
async fn a_draft_that_cannot_move_stays_where_it_was() {
    let server_a = MockServer::start().await;
    mount_drafts(&server_a, "da").await;
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db, "a");
    let b = add_account(&db, "b");
    let ua = server_a.uri();
    let gmail_for = |acct: AccountId| {
        if acct == a {
            Ok(client(&ua).0)
        } else {
            Err(CoreError::Auth("sign in again".into()))
        }
    };

    let id = compose::save_draft(&db, gmail_for, None, &outgoing(a, "a@x.example", None))
        .await
        .unwrap()
        .id;
    let moved =
        compose::save_draft(&db, gmail_for, Some(id), &outgoing(b, "b@x.example", None)).await;
    assert!(moved.is_err());
    let on_a = server_a.received_requests().await.unwrap();
    assert_eq!(calls(&on_a, "DELETE"), 0, "A's copy is kept");
    let owner: AccountId = db
        .conn()
        .query_row("SELECT account_id FROM drafts WHERE id = ?1", [id], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(owner, a);
}

#[tokio::test]
async fn a_draft_made_elsewhere_is_found_and_discarded() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/gmail/v1/users/me/drafts"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "drafts": [
                { "id": "dOther", "message": { "id": "zz", "threadId": "t9" } },
                { "id": "dWeb", "message": { "id": "m2", "threadId": "t1" } }
            ]
        })))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("DELETE"))
        .and(path("/gmail/v1/users/me/drafts/dWeb"))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db, "a");
    load_t1(&db, a);
    let m2 = message_id(&db, a, "m2");
    let (gmail, _) = client(&server.uri());

    let first = compose::draft_for_message(&db, &gmail, m2).await.unwrap();
    // Remembered: asking again doesn't list Gmail's drafts again.
    assert_eq!(
        compose::draft_for_message(&db, &gmail, m2).await.unwrap(),
        first
    );

    compose::discard_draft_message(&db, &gmail, m2)
        .await
        .unwrap();
    let left: i64 = db
        .conn()
        .query_row("SELECT COUNT(*) FROM messages WHERE id = ?1", [m2], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(left, 0, "gone from the cache at once");
}

/// A draft in the Trash opens in the composer, as in Gmail on the web:
/// Gmail lists it only when asked to include Spam and Trash (owner report,
/// 2026-11-12: "that draft is no longer in Gmail").
#[tokio::test]
async fn a_draft_in_the_trash_is_found() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/gmail/v1/users/me/drafts"))
        .and(query_param("includeSpamTrash", "true"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "drafts": [{ "id": "dTrashed", "message": { "id": "m2", "threadId": "t1" } }]
        })))
        .mount(&server)
        .await;
    // Without it, Gmail leaves drafts in the Trash out.
    Mock::given(method("GET"))
        .and(path("/gmail/v1/users/me/drafts"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({})))
        .mount(&server)
        .await;
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db, "a");
    load_t1(&db, a);
    let m2 = message_id(&db, a, "m2");
    let (gmail, _) = client(&server.uri());

    let id = compose::draft_for_message(&db, &gmail, m2).await.unwrap();
    let gmail_id: String = db
        .conn()
        .query_row(
            "SELECT gmail_draft_id FROM drafts WHERE id = ?1",
            [id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(gmail_id, "dTrashed");
}

/// The lookup reads every page of Gmail's drafts, not only the first
/// (code review: with Spam and Trash included, a draft can fall past it).
#[tokio::test]
async fn a_draft_on_a_later_page_is_found() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/gmail/v1/users/me/drafts"))
        .and(query_param("pageToken", "p2"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "drafts": [{ "id": "dLater", "message": { "id": "m2", "threadId": "t1" } }]
        })))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/gmail/v1/users/me/drafts"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "drafts": [{ "id": "dOther", "message": { "id": "zz", "threadId": "t9" } }],
            "nextPageToken": "p2"
        })))
        .expect(1)
        .mount(&server)
        .await;
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db, "a");
    load_t1(&db, a);
    let m2 = message_id(&db, a, "m2");
    let (gmail, _) = client(&server.uri());

    let id = compose::draft_for_message(&db, &gmail, m2).await.unwrap();
    let gmail_id: String = db
        .conn()
        .query_row(
            "SELECT gmail_draft_id FROM drafts WHERE id = ?1",
            [id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(gmail_id, "dLater");
}

#[tokio::test]
async fn deleting_a_draft_takes_it_out_of_its_conversation_at_once() {
    let server = MockServer::start().await;
    mount_drafts(&server, "d1").await;
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db, "a");
    load_t1(&db, a);
    // A saved draft reply, cached as m2 in its conversation.
    let m2 = message_id(&db, a, "m2");
    let id: mail_core::model::DraftId = db
        .conn()
        .query_row(
            "INSERT INTO drafts (account_id, gmail_draft_id, message_id, updated_at)
             VALUES (?1, 'd1', ?2, 0) RETURNING id",
            rusqlite::params![a, m2],
            |r| r.get(0),
        )
        .unwrap();
    let uri = server.uri();
    let gmail_for = |_| Ok(client(&uri).0);

    compose::delete_draft(&db, &gmail_for, id).await.unwrap();
    let left: i64 = db
        .conn()
        .query_row("SELECT COUNT(*) FROM messages WHERE id = ?1", [m2], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(left, 0, "not left to be reopened before the next sync");
    // Discarding it by its message afterwards is fine: already gone.
    compose::discard_draft_message(&db, &client(&uri).0, m2)
        .await
        .unwrap();
}

#[tokio::test]
async fn conversations_that_are_only_a_draft_say_so() {
    use mail_core::db::query;
    use mail_core::db::store::{IncomingMessage, IncomingThread};
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db, "a");
    let t1 = load_t1(&db, a);
    let draft_only = store::upsert_thread(
        &mut db.conn(),
        a,
        &IncomingThread {
            gmail_thread_id: "td".into(),
            messages: vec![IncomingMessage {
                gmail_message_id: "md".into(),
                label_ids: vec!["DRAFT".into()],
                internal_date: 5,
                ..Default::default()
            }],
        },
    )
    .unwrap();
    let conn = db.conn();
    assert!(query::thread_summary(&conn, draft_only).unwrap().only_draft);
    assert!(!query::thread_summary(&conn, t1).unwrap().only_draft);
}

#[tokio::test]
async fn a_saved_draft_is_cached_at_once() {
    let server = MockServer::start().await;
    mount_drafts(&server, "d1").await;
    Mock::given(method("GET"))
        .and(path("/gmail/v1/users/me/threads/dt"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": "dt",
            "messages": [{ "id": "dm", "threadId": "dt", "labelIds": ["DRAFT"],
                           "internalDate": "5", "payload": { "headers": [] } }]
        })))
        .mount(&server)
        .await;
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db, "a");
    let uri = server.uri();
    let gmail_for = |_| Ok(client(&uri).0);
    let id = compose::save_draft(&db, gmail_for, None, &outgoing(a, "a@x.example", None))
        .await
        .unwrap()
        .id;
    let linked: Option<i64> = db
        .conn()
        .query_row(
            "SELECT d.message_id FROM drafts d JOIN messages m ON m.id = d.message_id
             WHERE d.id = ?1 AND m.gmail_message_id = 'dm'",
            [id],
            |r| r.get(0),
        )
        .unwrap();
    assert!(linked.is_some(), "the draft's message is cached and linked");
}

/// Gmail replaces a draft's message on each save (here in a new thread,
/// as for a new email). The old one leaves the cache at once: it showed as
/// a second copy in Drafts until the next sync (owner report, 2026-10-25).
#[tokio::test]
async fn saving_a_draft_again_leaves_one_copy() {
    let server = MockServer::start().await;
    let reply = |message: &str, thread: &str| {
        ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": "d1", "message": { "id": message, "threadId": thread }
        }))
    };
    Mock::given(method("POST"))
        .and(path("/upload/gmail/v1/users/me/drafts"))
        .respond_with(reply("dm1", "dt1"))
        .mount(&server)
        .await;
    Mock::given(method("PUT"))
        .and(path("/upload/gmail/v1/users/me/drafts/d1"))
        .respond_with(reply("dm2", "dt2"))
        .mount(&server)
        .await;
    for (thread, message) in [("dt1", "dm1"), ("dt2", "dm2")] {
        Mock::given(method("GET"))
            .and(path(format!("/gmail/v1/users/me/threads/{thread}")))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "id": thread,
                "messages": [{ "id": message, "threadId": thread, "labelIds": ["DRAFT"],
                               "internalDate": "5", "payload": { "headers": [] } }]
            })))
            .mount(&server)
            .await;
    }
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db, "a");
    let uri = server.uri();
    let gmail_for = |_| Ok(client(&uri).0);
    let msg = outgoing(a, "a@x.example", None);
    let id = compose::save_draft(&db, gmail_for, None, &msg)
        .await
        .unwrap()
        .id;
    compose::save_draft(&db, gmail_for, Some(id), &msg)
        .await
        .unwrap();

    let drafts = query::list_threads(
        &db.conn(),
        &ListQuery {
            accounts: AccountFilter::All,
            view: MailView::System {
                label: SystemLabel::Draft,
            },
            cursor: None,
            limit: 50,
        },
    )
    .unwrap()
    .threads;
    assert_eq!(drafts.len(), 1, "one draft, not the replaced copy too");
    let left: Vec<String> = db
        .conn()
        .prepare("SELECT gmail_message_id FROM messages")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(left, ["dm2"]);
}

#[tokio::test]
async fn google_contacts_are_fetched_from_both_lists() {
    use mail_core::compose::contacts;
    let server = MockServer::start().await;
    Mock::given(path("/v1/people/me/connections"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "connections": [{ "names": [{ "displayName": "Pat Lee" }],
                              "emailAddresses": [{ "value": "pat@z.example" }, { "value": "pat@work.example" }] }]
        })))
        .mount(&server)
        .await;
    Mock::given(path("/v1/otherContacts"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "otherContacts": [{ "emailAddresses": [{ "value": "old@w.example" }, { "value": "not-an-address" }] }]
        })))
        .mount(&server)
        .await;
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db, "a");
    let (gmail, _) = client(&server.uri());
    assert_eq!(contacts::refresh_google(&db, &gmail, a).await.unwrap(), 3);
    // Refreshing replaces, never duplicates.
    contacts::refresh_google(&db, &gmail, a).await.unwrap();
    let emails: Vec<String> = contacts::all(&db.conn())
        .unwrap()
        .into_iter()
        .map(|c| c.email)
        .collect();
    assert_eq!(emails.len(), 3, "{emails:?}");
}

#[tokio::test]
async fn an_account_without_the_contacts_permission_is_refused_not_broken() {
    use mail_core::compose::contacts;
    let server = MockServer::start().await;
    Mock::given(path("/v1/people/me/connections"))
        .respond_with(ResponseTemplate::new(403).set_body_json(serde_json::json!({
            "error": { "code": 403, "message": "Request had insufficient authentication scopes.",
                       "errors": [{ "reason": "insufficientPermissions" }] }
        })))
        .mount(&server)
        .await;
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db, "a");
    let (gmail, _) = client(&server.uri());
    let err = contacts::refresh_google(&db, &gmail, a).await.unwrap_err();
    assert!(matches!(err, CoreError::Api { status: 403, .. }), "{err:?}");
}

#[tokio::test]
async fn a_forward_carries_the_originals_attachments() {
    let server = MockServer::start().await;
    mount_send(&server, "t1").await;
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db, "a");
    load_t1(&db, a);
    let m2 = message_id(&db, a, "m2");
    // The original's attachment, already downloaded to the cache.
    let cache = std::env::temp_dir().join(format!("compose-fwd-test-{}", std::process::id()));
    let file = cache.join("plan.pdf");
    std::fs::create_dir_all(&cache).unwrap();
    std::fs::write(&file, b"%PDF-plan").unwrap();
    db.conn()
        .execute(
            "INSERT INTO attachments (account_id, message_id, part_id, filename, mime_type, size, cached_path)
             VALUES (?1, ?2, '2', 'plan.pdf', 'application/pdf', 9, ?3)",
            rusqlite::params![a, m2, file.to_string_lossy()],
        )
        .unwrap();
    let attachment: AttachmentId = db
        .conn()
        .query_row("SELECT id FROM attachments", [], |r| r.get(0))
        .unwrap();

    let (gmail, _) = client(&server.uri());
    let mut msg = outgoing(a, "a@x.example", Some(m2));
    msg.forwarded = vec![attachment];
    let files = compose::carried_parts(&db, |_| Ok(client(&server.uri()).0), &msg, &cache)
        .await
        .unwrap();
    compose::send_with_files(&db, &gmail, &msg, &files)
        .await
        .unwrap();

    let requests = server.received_requests().await.unwrap();
    let send = requests
        .iter()
        .find(|r| r.url.path().ends_with("/messages/send"))
        .unwrap();
    let (raw, _) = sent_raw(send);
    assert!(
        raw.contains("plan.pdf") && raw.contains("application/pdf"),
        "{raw}"
    );
    let _ = std::fs::remove_dir_all(&cache);
}

#[tokio::test]
async fn reopening_a_draft_brings_its_files() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/gmail/v1/users/me/drafts"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "drafts": [{ "id": "dWeb", "message": { "id": "m2", "threadId": "t1" } }]
        })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/gmail/v1/users/me/messages/m2"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": "m2", "threadId": "t1",
            "payload": {
                "mimeType": "multipart/mixed",
                "headers": [
                    { "name": "From", "value": "a@x.example" },
                    { "name": "To", "value": "bob@example.com" },
                    { "name": "Subject", "value": "Plan" }
                ],
                "parts": [
                    { "partId": "0", "mimeType": "text/plain", "filename": "",
                      "body": { "size": 2, "data": parse::encode_base64url(b"Hi") } },
                    { "partId": "1", "mimeType": "application/pdf", "filename": "plan.pdf",
                      "body": { "size": 9, "data": parse::encode_base64url(b"%PDF-plan") } }
                ]
            }
        })))
        .mount(&server)
        .await;
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db, "a");
    load_t1(&db, a);
    let m2 = message_id(&db, a, "m2");
    let (gmail, _) = client(&server.uri());

    let opened = compose::open_draft(&db, &gmail, m2).await.unwrap();
    assert_eq!(opened.subject, "Plan");
    assert_eq!(opened.files.len(), 1);
    assert_eq!(opened.files[0].filename, "plan.pdf");
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&opened.files[0].data)
        .unwrap();
    assert_eq!(bytes, b"%PDF-plan");
}

#[tokio::test]
async fn a_quote_carries_the_originals_embedded_images() {
    let server = MockServer::start().await;
    mount_send(&server, "t1").await;
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db, "a");
    load_t1(&db, a);
    let m2 = message_id(&db, a, "m2");
    let cache = std::env::temp_dir().join(format!("compose-cid-test-{}", std::process::id()));
    let file = cache.join("logo.png");
    std::fs::create_dir_all(&cache).unwrap();
    std::fs::write(&file, [137u8, 80, 78, 71]).unwrap();
    db.conn()
        .execute(
            "INSERT INTO attachments (account_id, message_id, part_id, filename, mime_type, size,
               content_id, inline, cached_path)
             VALUES (?1, ?2, '3', 'logo.png', 'image/png', 4, 'logo@x', 1, ?3)",
            rusqlite::params![a, m2, file.to_string_lossy()],
        )
        .unwrap();
    let logo: AttachmentId = db
        .conn()
        .query_row("SELECT id FROM attachments", [], |r| r.get(0))
        .unwrap();

    let mut msg = outgoing(a, "a@x.example", Some(m2));
    msg.html = Some(r#"<p>Hi</p><blockquote><img src="cid:logo@x"></blockquote>"#.into());
    msg.inline_images = vec![logo];
    let carried = compose::carried_parts(&db, |_| Ok(client(&server.uri()).0), &msg, &cache)
        .await
        .unwrap();
    let (gmail, _) = client(&server.uri());
    compose::send_with_files(&db, &gmail, &msg, &carried)
        .await
        .unwrap();

    let requests = server.received_requests().await.unwrap();
    let send = requests
        .iter()
        .find(|r| r.url.path().ends_with("/messages/send"))
        .unwrap();
    let (raw, _) = sent_raw(send);
    assert!(raw.contains("Content-ID: <logo@x>"), "{raw}");
    assert!(raw.contains("cid:logo@x"), "{raw}");
    let _ = std::fs::remove_dir_all(&cache);
}

/// Saving a draft brings its whole conversation into the cache, so it can
/// also bring in mail that changed in Gmail since the last sync: an older
/// email gone, a new one arrived. The save says so, so the window asks for
/// the conversation's AI summary and reply ideas again (code review of
/// the draft-only mail event); a save that changed only the draft doesn't.
#[tokio::test]
async fn saving_a_draft_says_when_other_mail_changed_with_it() {
    use mail_core::db::store::{IncomingMessage, IncomingThread};
    let email = |id: &str, at: i64| IncomingMessage {
        gmail_message_id: id.into(),
        label_ids: vec!["INBOX".into()],
        internal_date: at,
        ..Default::default()
    };
    let gmail_email = |id: &str, at: i64, label: &str| {
        serde_json::json!({ "id": id, "threadId": "t", "labelIds": [label],
                            "internalDate": at.to_string(), "payload": { "headers": [] } })
    };
    let cases = [
        (
            "only the draft",
            vec![
                gmail_email("older", 1_000, "INBOX"),
                gmail_email("newest", 2_000, "INBOX"),
            ],
            false,
        ),
        (
            "an older email gone",
            vec![gmail_email("newest", 2_000, "INBOX")],
            true,
        ),
        (
            "a new email arrived",
            vec![
                gmail_email("older", 1_000, "INBOX"),
                gmail_email("newest", 2_000, "INBOX"),
                gmail_email("newer", 2_500, "INBOX"),
            ],
            true,
        ),
    ];
    for (case, mut in_gmail, expected) in cases {
        let server = MockServer::start().await;
        let draft = serde_json::json!({ "id": "d1", "message": { "id": "dm", "threadId": "t" } });
        Mock::given(method("POST"))
            .and(path("/upload/gmail/v1/users/me/drafts"))
            .respond_with(ResponseTemplate::new(200).set_body_json(draft))
            .mount(&server)
            .await;
        in_gmail.push(gmail_email("dm", 3_000, "DRAFT"));
        Mock::given(method("GET"))
            .and(path("/gmail/v1/users/me/threads/t"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(serde_json::json!({ "id": "t", "messages": in_gmail })),
            )
            .mount(&server)
            .await;
        let db = Db::open_in_memory().unwrap();
        let a = add_account(&db, "a");
        store::upsert_thread(
            &mut db.conn(),
            a,
            &IncomingThread {
                gmail_thread_id: "t".into(),
                messages: vec![email("older", 1_000), email("newest", 2_000)],
            },
        )
        .unwrap();
        let uri = server.uri();
        let gmail_for = |_| Ok(client(&uri).0);
        let saved = compose::save_draft(&db, gmail_for, None, &outgoing(a, "a@x.example", None))
            .await
            .unwrap();
        assert_eq!(saved.other_mail_changed, expected, "{case}");
    }
}
