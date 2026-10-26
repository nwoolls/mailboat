//! The MCP server through a real MCP client (as Claude Desktop would
//! connect): only shared accounts, never Spam or Trash, drafts only where
//! allowed, two accounts with colliding Gmail IDs kept apart, and every
//! request logged without content.

mod common;

use std::sync::{Arc, Mutex};

use common::client;
use mail_core::db::store::{self, IncomingLabel, IncomingMessage, IncomingThread, StoredBody};
use mail_core::db::{accounts, Db};
use mail_core::gmail::GmailClient;
use mail_core::mcp::{log, Host, MailServer};
use mail_core::model::*;
use mail_core::settings::{self, McpSettings};
use mail_core::CoreError;
use rmcp::model::{
    CallToolRequestParams, CallToolResult, ClientCapabilities, ClientConfig, Implementation,
};
use rmcp::service::RunningService;
use rmcp::{RoleClient, ServiceExt};
use serde_json::{json, Value};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

struct FakeHost {
    gmail_uri: Option<String>,
    changed: Mutex<Vec<AccountId>>,
}

impl Host for FakeHost {
    fn gmail(&self, _account: AccountId) -> mail_core::error::Result<GmailClient> {
        match &self.gmail_uri {
            Some(uri) => Ok(client(uri).0),
            None => Err(CoreError::Other("offline".into())),
        }
    }

    fn mail_changed(&self, account: AccountId) {
        self.changed.lock().unwrap().push(account);
    }
}

fn add_account(db: &Db, sub: &str, email: &str) -> AccountId {
    accounts::upsert(
        &db.conn(),
        &accounts::NewAccount {
            google_sub: sub,
            email,
            display_name: Some("Me"),
            avatar_url: None,
            oauth_client: "default",
        },
    )
    .unwrap()
    .id
}

fn system(id: &str) -> IncomingLabel {
    IncomingLabel {
        gmail_label_id: id.into(),
        name: id.into(),
        kind: LabelKind::System,
        color_bg: None,
        color_fg: None,
    }
}

/// One email in its own thread, with its body cached.
fn add_thread(
    db: &Db,
    account: AccountId,
    gmail_id: &str,
    subject: &str,
    body: &str,
    labels: &[&str],
) -> ThreadId {
    store::upsert_thread(
        &mut db.conn(),
        account,
        &IncomingThread {
            gmail_thread_id: gmail_id.into(),
            messages: vec![IncomingMessage {
                gmail_message_id: gmail_id.into(),
                label_ids: labels.iter().map(|l| l.to_string()).collect(),
                internal_date: 1_000,
                snippet: body.chars().take(40).collect(),
                subject: subject.into(),
                from: Some(Address {
                    name: Some("Sam".into()),
                    email: "sam@example.com".into(),
                }),
                to: vec![Address {
                    name: None,
                    email: "me@example.com".into(),
                }],
                ..Default::default()
            }],
        },
    )
    .unwrap();
    let (thread, message): (ThreadId, MessageId) = db
        .conn()
        .query_row(
            "SELECT t.id, m.id FROM threads t JOIN messages m ON m.thread_id = t.id
             WHERE t.account_id = ?1 AND t.gmail_thread_id = ?2",
            rusqlite::params![account, gmail_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    store::set_body(
        &mut db.conn(),
        message,
        &StoredBody {
            html: None,
            text: Some(body.into()),
        },
        &[],
    )
    .unwrap();
    thread
}

fn share(db: &Db, read: &[AccountId], drafts: &[AccountId]) {
    let conn = db.conn();
    let mut s = settings::load(&conn).unwrap();
    s.mcp = McpSettings {
        read: read.to_vec(),
        drafts: drafts.to_vec(),
    };
    settings::save(&conn, &s).unwrap();
}

async fn connect(db: Arc<Db>, host: Arc<FakeHost>) -> RunningService<RoleClient, ClientConfig> {
    let (server_side, client_side) = tokio::io::duplex(1 << 16);
    tokio::spawn(async move {
        if let Ok(running) = MailServer::new(db, host).serve(server_side).await {
            let _ = running.waiting().await;
        }
    });
    ClientConfig::new(
        ClientCapabilities::default(),
        Implementation::new("test-client", "1"),
    )
    .serve(client_side)
    .await
    .unwrap()
}

async fn call(
    c: &RunningService<RoleClient, ClientConfig>,
    tool: &'static str,
    args: Value,
) -> CallToolResult {
    let Value::Object(args) = args else {
        panic!("arguments must be an object")
    };
    c.call_tool(CallToolRequestParams::new(tool).with_arguments(args))
        .await
        .unwrap()
}

fn text(r: &CallToolResult) -> String {
    r.content
        .iter()
        .filter_map(|c| c.as_text().map(|t| t.text.clone()))
        .collect()
}

fn ok(r: &CallToolResult) -> Value {
    assert_ne!(r.is_error, Some(true), "{}", text(r));
    r.structured_content.clone().expect("structured answer")
}

struct Mail {
    db: Arc<Db>,
    a: AccountId,
    b: AccountId,
    a_thread: ThreadId,
    b_thread: ThreadId,
    a_spam: ThreadId,
}

/// Two accounts whose thread and message IDs collide ("t1"), plus a Spam
/// thread in A.
fn mail() -> Mail {
    let db = Arc::new(Db::open_in_memory().unwrap());
    let a = add_account(&db, "sub-a", "me@gmail.com");
    let b = add_account(&db, "sub-b", "me@work.com");
    for account in [a, b] {
        store::sync_labels(
            &mut db.conn(),
            account,
            &[system("INBOX"), system("SPAM"), system("TRASH")],
        )
        .unwrap();
    }
    let a_thread = add_thread(
        &db,
        a,
        "t1",
        "Lunch plans",
        "Lunch on Friday at noon?",
        &["INBOX"],
    );
    let b_thread = add_thread(
        &db,
        b,
        "t1",
        "Quarterly budget",
        "Budget numbers attached for lunch review",
        &["INBOX"],
    );
    let a_spam = add_thread(
        &db,
        a,
        "t2",
        "You won lunch",
        "Claim your free lunch",
        &["SPAM"],
    );
    Mail {
        db,
        a,
        b,
        a_thread,
        b_thread,
        a_spam,
    }
}

fn host(uri: Option<String>) -> Arc<FakeHost> {
    Arc::new(FakeHost {
        gmail_uri: uri,
        changed: Mutex::new(Vec::new()),
    })
}

#[tokio::test]
async fn nothing_is_shared_until_an_account_is_turned_on() {
    let m = mail();
    let c = connect(m.db.clone(), host(None)).await;
    let r = call(&c, "search_mail", json!({ "query": "lunch" })).await;
    assert_eq!(r.is_error, Some(true));
    assert!(text(&r).contains("No accounts are shared"), "{}", text(&r));
}

#[tokio::test]
async fn only_shared_accounts_and_never_spam() {
    let m = mail();
    share(&m.db, &[m.a], &[]);
    let c = connect(m.db.clone(), host(None)).await;

    // "lunch" is in all three; only A's non-spam conversation comes back.
    let found = ok(&call(&c, "search_mail", json!({ "query": "lunch" })).await);
    let ids: Vec<i64> = found["conversations"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["conversation_id"].as_i64().unwrap())
        .collect();
    assert_eq!(ids, [m.a_thread.0]);
    assert_eq!(found["conversations"][0]["account"], "me@gmail.com");

    let inbox = ok(&call(&c, "list_conversations", json!({})).await);
    assert_eq!(inbox["conversations"].as_array().unwrap().len(), 1);

    let read = ok(&call(
        &c,
        "read_conversation",
        json!({ "conversation_id": m.a_thread.0 }),
    )
    .await);
    assert_eq!(read["subject"], "Lunch plans");
    assert_eq!(read["emails"][0]["text"], "Lunch on Friday at noon?");
    assert_eq!(read["emails"][0]["from"], "Sam <sam@example.com>");

    // B's thread (same Gmail ID "t1") and A's Spam can't be read, and say
    // nothing about themselves.
    for hidden in [m.b_thread, m.a_spam] {
        let r = call(
            &c,
            "read_conversation",
            json!({ "conversation_id": hidden.0 }),
        )
        .await;
        assert_eq!(r.is_error, Some(true));
        assert!(text(&r).contains("no conversation"), "{}", text(&r));
    }
    let r = call(
        &c,
        "search_mail",
        json!({ "query": "lunch", "account": "me@work.com" }),
    )
    .await;
    assert!(text(&r).contains("isn't shared"), "{}", text(&r));

    // Turning B on takes effect on the next request.
    share(&m.db, &[m.a, m.b], &[]);
    let found = ok(&call(&c, "search_mail", json!({ "query": "lunch" })).await);
    assert_eq!(found["conversations"].as_array().unwrap().len(), 2);
    let _ = m.b;
}

/// A new email may be saved before anyone is chosen to send it to, as in
/// Gmail (owner report, 2026-10-25); the user adds them in Mailboat. It's
/// signed with the From address's Gmail signature.
#[tokio::test]
async fn a_new_draft_needs_no_recipient_yet() {
    let server = MockServer::start().await;
    let draft = json!({ "id": "d2", "message": { "id": "dm2", "threadId": "t9" } });
    Mock::given(method("POST"))
        .and(path("/upload/gmail/v1/users/me/drafts"))
        .respond_with(ResponseTemplate::new(200).set_body_json(draft))
        .mount(&server)
        .await;
    let m = mail();
    share(&m.db, &[m.a], &[m.a]);
    // The account's address has a signature in Gmail.
    mail_core::compose::identities::store(
        &mut m.db.conn(),
        m.a,
        &[serde_json::from_value(json!({
            "sendAsEmail": "me@gmail.com",
            "signature": "<div>Jordan Lee</div><br><br>",
            "isPrimary": true,
            "isDefault": true
        }))
        .unwrap()],
    )
    .unwrap();
    let c = connect(m.db.clone(), host(Some(server.uri()))).await;
    let saved = ok(&call(
        &c,
        "create_draft",
        json!({ "subject": "Ideas", "body": "Notes" }),
    )
    .await);
    assert_eq!(saved["to"], json!([]));
    assert_eq!(saved["account"], "me@gmail.com");

    // Signed as a draft written in Mailboat is (owner, 2026-10-25).
    let requests = server.received_requests().await.unwrap();
    let raw = String::from_utf8_lossy(&requests[0].body).to_string();
    assert!(raw.contains("gmail_signature"), "{raw}");
    assert!(raw.contains("Jordan Lee"), "{raw}");
}

#[tokio::test]
async fn drafts_only_where_allowed_and_never_sent() {
    let server = MockServer::start().await;
    let draft = json!({ "id": "d1", "message": { "id": "dm", "threadId": "t1" } });
    Mock::given(method("POST"))
        .and(path("/upload/gmail/v1/users/me/drafts"))
        .respond_with(ResponseTemplate::new(200).set_body_json(draft))
        .mount(&server)
        .await;
    let m = mail();
    share(&m.db, &[m.a], &[]);
    let h = host(Some(server.uri()));
    let c = connect(m.db.clone(), h.clone()).await;

    // Not listed, and refused, until drafts are allowed.
    let tools = c.list_all_tools().await.unwrap();
    assert!(!tools.iter().any(|t| t.name == "create_draft"));
    let args = json!({ "reply_to_conversation_id": m.a_thread.0, "body": "Friday works!" });
    let r = call(&c, "create_draft", args.clone()).await;
    assert!(text(&r).contains("aren't allowed"), "{}", text(&r));

    share(&m.db, &[m.a], &[m.a]);
    let tools = c.list_all_tools().await.unwrap();
    assert!(tools.iter().any(|t| t.name == "create_draft"));
    let saved = ok(&call(&c, "create_draft", args).await);
    assert_eq!(saved["subject"], "Re: Lunch plans");
    assert_eq!(saved["to"][0], "Sam <sam@example.com>");
    assert_eq!(*h.changed.lock().unwrap(), [m.a]);

    // A draft, not a send: one draft created, then the conversation
    // refreshed (so it shows in Mailboat), and nothing else.
    let requests = server.received_requests().await.unwrap();
    let made: Vec<String> = requests
        .iter()
        .map(|r| format!("{} {}", r.method, r.url.path()))
        .collect();
    assert_eq!(
        made,
        [
            "POST /upload/gmail/v1/users/me/drafts",
            "GET /gmail/v1/users/me/threads/t1"
        ]
    );
}

#[tokio::test]
async fn every_request_is_logged_without_content() {
    let m = mail();
    share(&m.db, &[m.a], &[]);
    let c = connect(m.db.clone(), host(None)).await;
    ok(&call(&c, "search_mail", json!({ "query": "lunch" })).await);
    ok(&call(
        &c,
        "read_conversation",
        json!({ "conversation_id": m.a_thread.0 }),
    )
    .await);
    call(
        &c,
        "read_conversation",
        json!({ "conversation_id": m.b_thread.0 }),
    )
    .await;

    let entries = log::recent(&m.db.conn(), 10).unwrap();
    let seen: Vec<(&str, bool)> = entries.iter().map(|e| (e.tool.as_str(), e.ok)).collect();
    assert_eq!(
        seen,
        [
            ("read_conversation", false),
            ("read_conversation", true),
            ("search_mail", true)
        ]
    );
    assert!(entries.iter().all(|e| e.client == "test-client"));
    assert_eq!(entries[1].account_id, Some(m.a));
    assert_eq!(entries[1].subject.as_deref(), Some("Lunch plans"));
    assert_eq!(entries[2].detail, "\"lunch\": 1 conversation");
    // The email's text is never in the log.
    assert!(entries.iter().all(|e| !e.detail.contains("Friday")));
}

/// The way an AI app really connects: it starts `mailboat --mcp` (the proxy),
/// which passes requests to the app's socket. With the app closed, the
/// tools are still listed and each says to open Mailboat; once it's open,
/// the next call goes through without restarting the proxy.
#[tokio::test]
async fn through_the_proxy_with_server_closed_then_open() {
    use mail_core::mcp::{listen, proxy::Proxy, proxy::NOT_RUNNING};
    let m = mail();
    share(&m.db, &[m.a], &[]);
    let dir = std::env::temp_dir().join(format!("mcp-test-{}", std::process::id()));
    #[cfg(unix)]
    let socket = dir.join("mcp.sock");
    #[cfg(windows)]
    let socket =
        std::path::PathBuf::from(format!(r"\\.\pipe\mcp-pipe-test-{}", std::process::id()));
    let _ = std::fs::remove_file(&socket);

    let (proxy_side, client_side) = tokio::io::duplex(1 << 16);
    let proxy = Proxy::new(socket.clone());
    tokio::spawn(async move {
        if let Ok(running) = proxy.serve(proxy_side).await {
            let _ = running.waiting().await;
        }
    });
    let c = ClientConfig::new(
        ClientCapabilities::default(),
        Implementation::new("claude-ai", "1"),
    )
    .serve(client_side)
    .await
    .unwrap();

    // Closed: listed anyway, and every call says to open Mailboat.
    let tools = c.list_all_tools().await.unwrap();
    assert!(tools.iter().any(|t| t.name == "search_mail"));
    let r = call(&c, "search_mail", json!({ "query": "lunch" })).await;
    assert_eq!(
        (r.is_error, text(&r)),
        (Some(true), NOT_RUNNING.to_string())
    );

    // Open: the same proxy now reaches it.
    let db = m.db.clone();
    let path = socket.clone();
    let app = tokio::spawn(async move { listen(&path, db, host(None)).await });
    // Retried until the app is listening (a pipe isn't a file to wait for).
    let mut r = call(&c, "search_mail", json!({ "query": "lunch" })).await;
    for _ in 0..100 {
        if r.is_error != Some(true) {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        r = call(&c, "search_mail", json!({ "query": "lunch" })).await;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(&socket).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "only the user may connect");
    }
    let found = ok(&r);
    assert_eq!(found["conversations"][0]["conversation_id"], m.a_thread.0);
    // The log names the AI app, not the proxy.
    let entries = log::recent(&m.db.conn(), 1).unwrap();
    assert_eq!(entries[0].client, "claude-ai");

    app.abort();
    let _ = std::fs::remove_dir_all(&dir);
}
