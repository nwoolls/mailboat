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

    fn draft_saved(&self, account: AccountId, _other_mail_changed: bool) {
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
    let b = add_account(&db, "sub-b", "me@work.example");
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
        json!({ "query": "lunch", "account": "me@work.example" }),
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
/// Gmail (owner report, 2026-10-25); the user adds them in the app. It's
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

    // Signed as a draft written in the app is (owner, 2026-10-25).
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
    // refreshed (so it shows in the app), and nothing else.
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

/// The way an AI app really connects: it starts `<app> --mcp` (the proxy),
/// which passes requests to the app's socket. With the app closed, the
/// tools are still listed and each says to open the app; once it's open,
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

    // Closed: listed anyway, and every call says to open the app.
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

/// Code review R4-01: a conversation with an ordinary email and one in
/// Trash (or Spam) is still in All Mail, but the hidden email's words,
/// snippet, sender and date reached AI apps through search, the lists and
/// a reply's default recipient. Only what's outside Spam and Trash counts.
#[tokio::test]
async fn a_conversations_emails_in_spam_or_trash_stay_hidden() {
    for hidden_label in ["TRASH", "SPAM"] {
        let server = MockServer::start().await;
        let draft = json!({ "id": "d1", "message": { "id": "dm", "threadId": "mixed" } });
        Mock::given(method("POST"))
            .and(path("/upload/gmail/v1/users/me/drafts"))
            .respond_with(ResponseTemplate::new(200).set_body_json(draft))
            .mount(&server)
            .await;
        let m = mail();
        let email =
            |id: &str, at: i64, from: &str, subject: &str, snippet: &str, labels: &[&str]| {
                IncomingMessage {
                    gmail_message_id: id.into(),
                    label_ids: labels.iter().map(|l| l.to_string()).collect(),
                    internal_date: at,
                    snippet: snippet.into(),
                    subject: subject.into(),
                    from: Some(Address {
                        name: Some(from.into()),
                        email: format!("{}@example.com", from.to_lowercase()),
                    }),
                    to: vec![Address {
                        name: None,
                        email: "me@example.com".into(),
                    }],
                    ..Default::default()
                }
            };
        store::upsert_thread(
            &mut m.db.conn(),
            m.a,
            &IncomingThread {
                gmail_thread_id: "mixed".into(),
                messages: vec![
                    email(
                        "h0",
                        2_000,
                        "Hidden",
                        "Hidden subject",
                        "early hidden words",
                        &[hidden_label, "UNREAD", "STARRED"],
                    ),
                    email(
                        "v1",
                        3_000,
                        "Visible",
                        "Picnic",
                        "Picnic on Sunday",
                        &["INBOX"],
                    ),
                    email(
                        "h2",
                        4_000,
                        "Hidden",
                        "Re: Picnic",
                        "HIDDENMARKER picnic",
                        &[hidden_label, "UNREAD"],
                    ),
                ],
            },
        )
        .unwrap();
        let ids: Vec<(String, MessageId)> = {
            let conn = m.db.conn();
            let mut stmt = conn
                .prepare("SELECT gmail_message_id, id FROM messages WHERE gmail_message_id IN ('h0','v1','h2')")
                .unwrap();
            let rows = stmt
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
                .unwrap()
                .collect::<rusqlite::Result<_>>()
                .unwrap();
            rows
        };
        for (gid, id) in ids {
            store::set_body(
                &mut m.db.conn(),
                id,
                &StoredBody {
                    html: None,
                    text: Some(format!(
                        "{gid} body picnic {}",
                        if gid == "v1" { "" } else { "HIDDENMARKER" }
                    )),
                },
                &[],
            )
            .unwrap();
        }
        share(&m.db, &[m.a], &[m.a]);
        let c = connect(m.db.clone(), host(Some(server.uri()))).await;
        let what = format!("{hidden_label}: ");

        // Words only in the hidden emails find nothing, even once Gmail's
        // own search took in Spam and Trash (the app's setting) and found
        // the conversation by them.
        m.db.conn()
            .execute(
                "INSERT INTO search_hits (account_id, query, thread_id)
                 SELECT account_id, ?1, id FROM threads WHERE gmail_thread_id = 'mixed'",
                [mail_core::db::query::search_key("HIDDENMARKER", true)],
            )
            .unwrap();
        let found = ok(&call(&c, "search_mail", json!({ "query": "HIDDENMARKER" })).await);
        assert_eq!(found["conversations"], json!([]), "{what}{found}");

        // Found by its visible email, it shows only that email.
        for answer in [
            ok(&call(&c, "search_mail", json!({ "query": "picnic" })).await),
            ok(&call(&c, "list_conversations", json!({ "view": "all_mail" })).await),
        ] {
            let mixed = answer["conversations"]
                .as_array()
                .unwrap()
                .iter()
                .find(|t| {
                    t["snippet"]
                        .as_str()
                        .unwrap_or("")
                        .to_lowercase()
                        .contains("picnic")
                })
                .unwrap_or_else(|| panic!("{what}{answer}"))
                .clone();
            let shown = mixed.to_string();
            assert!(
                !shown.contains("HIDDENMARKER") && !shown.contains("hidden"),
                "{what}{shown}"
            );
            assert!(!shown.contains("Hidden"), "{what}{shown}");
            assert_eq!(mixed["subject"], "Picnic", "{what}{shown}");
            assert_eq!(mixed["snippet"], "Picnic on Sunday", "{what}{shown}");
            assert_eq!(
                mixed["from"],
                json!(["Visible <visible@example.com>"]),
                "{what}{shown}"
            );
            assert_eq!(mixed["emails"], 1, "{what}{shown}");
            assert_eq!(mixed["unread"], false, "{what}{shown}");
            assert_eq!(mixed["starred"], false, "{what}{shown}");
            assert_eq!(
                mixed["date"],
                json!(chrono::DateTime::from_timestamp_millis(3_000)
                    .unwrap()
                    .with_timezone(&chrono::Local)
                    .to_rfc3339()),
                "{what}{shown}"
            );
        }

        let id = ok(&call(&c, "search_mail", json!({ "query": "picnic" })).await)["conversations"]
            [0]["conversation_id"]
            .clone();
        let read = ok(&call(&c, "read_conversation", json!({ "conversation_id": id })).await);
        assert_eq!(read["subject"], "Picnic", "{what}{read}");
        assert!(!read.to_string().contains("HIDDENMARKER"), "{what}{read}");

        // A reply goes to the visible email's sender, not the hidden one's.
        let saved = ok(&call(
            &c,
            "create_draft",
            json!({ "reply_to_conversation_id": id, "body": "Sounds good" }),
        )
        .await);
        assert_eq!(
            saved["to"],
            json!(["Visible <visible@example.com>"]),
            "{what}{saved}"
        );
        assert_eq!(saved["subject"], "Re: Picnic", "{what}{saved}");
    }
}

/// Code review R5-01 and R5-02: after R4-01, a mixed conversation's
/// summary came from its visible emails, but its labels when read, which
/// mailboxes it was listed in (Unread, Starred, Inbox, a label, Archive),
/// its order and the page token still came from the hidden email too.
#[tokio::test]
async fn a_mixed_conversation_is_listed_and_paged_by_its_visible_emails() {
    for hidden_label in ["TRASH", "SPAM"] {
        let m = mail();
        let user = |id: &str, name: &str| IncomingLabel {
            gmail_label_id: id.into(),
            name: name.into(),
            kind: LabelKind::User,
            color_bg: None,
            color_fg: None,
        };
        store::sync_labels(
            &mut m.db.conn(),
            m.a,
            &[
                system("INBOX"),
                system("SPAM"),
                system("TRASH"),
                system("UNREAD"),
                system("STARRED"),
                system("SENT"),
                user("Label_vis", "Visible label"),
                user("Label_hid", "Hidden label"),
            ],
        )
        .unwrap();
        let email = |id: &str, at: i64, labels: &[&str]| IncomingMessage {
            gmail_message_id: id.into(),
            label_ids: labels.iter().map(|l| l.to_string()).collect(),
            internal_date: at,
            snippet: format!("{id} text"),
            subject: "Mixed".into(),
            from: Some(Address {
                name: None,
                email: "sam@example.com".into(),
            }),
            ..Default::default()
        };
        let thread = |gid: &str, messages: Vec<IncomingMessage>| {
            store::upsert_thread(
                &mut m.db.conn(),
                m.a,
                &IncomingThread {
                    gmail_thread_id: gid.into(),
                    messages,
                },
            )
            .unwrap();
        };
        // Visible: sent, read, unstarred, archived, at 3000. Hidden: in
        // the Inbox, unread, starred, with its own label, at 9000.
        thread(
            "mixed",
            vec![
                email("v", 3_000, &["SENT", "Label_vis"]),
                email(
                    "h",
                    9_000,
                    &[hidden_label, "INBOX", "UNREAD", "STARRED", "Label_hid"],
                ),
            ],
        );
        thread("other", vec![email("o", 5_000, &["INBOX"])]);
        share(&m.db, &[m.a], &[]);
        let c = connect(m.db.clone(), host(None)).await;
        let what = hidden_label;
        let subjects = |answer: &Value| -> Vec<String> {
            answer["conversations"]
                .as_array()
                .unwrap()
                .iter()
                .map(|t| t["snippet"].as_str().unwrap().to_string())
                .collect()
        };

        for (args, listed) in [
            (json!({ "view": "unread" }), false),
            (json!({ "view": "starred" }), false),
            (json!({ "view": "inbox" }), false),
            (json!({ "label": "Hidden label" }), false),
            (json!({ "label": "Visible label" }), true),
            (json!({ "view": "archive" }), true),
        ] {
            let found = ok(&call(&c, "list_conversations", args.clone()).await);
            assert_eq!(
                subjects(&found).contains(&"v text".to_string()),
                listed,
                "{what} {args}: {found}"
            );
        }

        // Ordered and paged by the visible email's date (3000), not 9000.
        let first = ok(&call(
            &c,
            "list_conversations",
            json!({ "view": "all_mail", "limit": 1 }),
        )
        .await);
        assert_eq!(subjects(&first), ["o text"], "{what}: {first}");
        let page = first["next_page"].as_str().unwrap().to_string();
        let second = ok(&call(
            &c,
            "list_conversations",
            json!({ "view": "all_mail", "limit": 1, "page": page }),
        )
        .await);
        assert_eq!(subjects(&second), ["v text"], "{what}: {second}");
        let next = second["next_page"].as_str().unwrap_or_default().to_string();
        assert!(
            !page.contains("9000") && !next.contains("9000"),
            "{what}: {page} {next}"
        );

        // Read: only the visible email's labels.
        let id = second["conversations"][0]["conversation_id"].clone();
        let read = ok(&call(&c, "read_conversation", json!({ "conversation_id": id })).await);
        assert_eq!(read["labels"], json!(["Visible label"]), "{what}: {read}");
    }
}
