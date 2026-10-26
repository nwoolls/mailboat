//! Received attachments: recorded when a body is fetched, downloaded into
//! the account's cache folder with safe names, and inline images embedded.

mod common;

use common::*;
use mail_core::attachments;
use mail_core::db::{accounts, store, Db};
use mail_core::gmail::parse;
use mail_core::gmail::types::Thread;
use mail_core::mail;
use mail_core::model::*;
use mail_core::sync::fetch_body;
use wiremock::matchers::{method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn setup() -> (Db, AccountId, MessageId) {
    let db = Db::open_in_memory().unwrap();
    let account = accounts::upsert(
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
    let t: Thread = serde_json::from_str(&fixture("thread_t1.json")).unwrap();
    store::upsert_thread(&mut db.conn(), account, &parse::thread_to_incoming(&t)).unwrap();
    let m2: MessageId = db
        .conn()
        .query_row(
            "SELECT id FROM messages WHERE gmail_message_id = 'm2'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    (db, account, m2)
}

fn thread_of(db: &Db, message: MessageId) -> ThreadId {
    db.conn()
        .query_row(
            "SELECT thread_id FROM messages WHERE id = ?1",
            [message],
            |r| r.get(0),
        )
        .unwrap()
}

fn temp_cache() -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("mailboat-attachments-{}", fastrand::u64(..)));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

async fn serve_message(server: &MockServer, file: &str, times: u64) {
    Mock::given(method("GET"))
        .and(path("/gmail/v1/users/me/messages/m2"))
        .and(query_param("format", "full"))
        .respond_with(ResponseTemplate::new(200).set_body_raw(fixture(file), "application/json"))
        .expect(times)
        .mount(server)
        .await;
}

async fn serve_attachment(server: &MockServer, id: &str, data_b64url: &str, times: u64) {
    Mock::given(method("GET"))
        .and(path(format!(
            "/gmail/v1/users/me/messages/m2/attachments/{id}"
        )))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(serde_json::json!({ "size": 9, "data": data_b64url })),
        )
        .expect(times)
        .mount(server)
        .await;
}

#[tokio::test]
async fn fetching_a_body_records_its_attachments_but_lists_only_files() {
    let server = MockServer::start().await;
    serve_message(&server, "message_m2_attachments.json", 1).await;
    let (db, _, m2) = setup();
    let gmail = client(&server.uri()).0;

    let thread = thread_of(&db, m2);
    let summary = |db: &Db| mail_core::db::query::thread_summary(&db.conn(), thread);
    assert!(!summary(&db).unwrap().has_attachments);
    fetch_body(&db, &gmail, m2).await.unwrap();
    // The fetched body is the real answer for the paperclip.
    assert!(summary(&db).unwrap().has_attachments);
    // A later header-only sync of the thread doesn't undo it.
    let t: Thread = serde_json::from_str(&fixture("thread_t1.json")).unwrap();
    store::upsert_thread(&mut db.conn(), AccountId(1), &parse::thread_to_incoming(&t)).unwrap();
    assert!(summary(&db).unwrap().has_attachments);
    let listed = store::attachments_for(&db.conn(), m2).unwrap();
    assert_eq!(listed.len(), 1, "inline images aren't listed: {listed:?}");
    assert_eq!(listed[0].filename, "../../Quarterly report.pdf");
    assert_eq!(listed[0].mime_type, "application/pdf");
    assert_eq!(listed[0].size, 9);
    let inline = store::inline_parts(&db.conn(), m2).unwrap();
    assert_eq!(
        inline
            .iter()
            .map(|p| p.content_id.clone().unwrap())
            .collect::<Vec<_>>(),
        vec!["logo@x", "dot@x"]
    );
}

#[tokio::test]
async fn a_body_cached_before_attachments_were_recorded_is_fetched_again_once() {
    let server = MockServer::start().await;
    serve_message(&server, "message_m2_attachments.json", 1).await;
    let (db, _, m2) = setup();
    // As an older version of Mailboat stored it.
    db.conn()
        .execute(
            "INSERT INTO message_bodies (message_id, account_id, html, text, fetched_at) VALUES (?1, 1, '<p>old</p>', 'old', 0)",
            [m2],
        )
        .unwrap();
    let gmail = client(&server.uri()).0;
    assert!(store::get_body(&db.conn(), m2).unwrap().is_none());
    fetch_body(&db, &gmail, m2).await.unwrap();
    fetch_body(&db, &gmail, m2).await.unwrap(); // cached now: no second request
    assert_eq!(store::attachments_for(&db.conn(), m2).unwrap().len(), 1);
}

#[tokio::test]
async fn downloads_land_in_the_accounts_folder_once_with_a_safe_name() {
    let server = MockServer::start().await;
    serve_message(&server, "message_m2_attachments.json", 1).await;
    serve_attachment(&server, "ATT_PDF", "JVBERi0xLjcK", 1).await;
    let (db, account, m2) = setup();
    let gmail = client(&server.uri()).0;
    let cache = temp_cache();
    fetch_body(&db, &gmail, m2).await.unwrap();
    let pdf = store::attachments_for(&db.conn(), m2).unwrap()[0].id;

    let path = attachments::download(&db, &gmail, pdf, &cache)
        .await
        .unwrap();
    assert!(path.starts_with(attachments::account_dir(&cache, account)));
    assert_eq!(path.file_name().unwrap(), "Quarterly report.pdf");
    assert_eq!(std::fs::read(&path).unwrap(), b"%PDF-1.7\n");
    // Second time: straight from the cache (wiremock checks one request).
    assert_eq!(
        attachments::download(&db, &gmail, pdf, &cache)
            .await
            .unwrap(),
        path
    );
    std::fs::remove_dir_all(&cache).unwrap();
}

#[tokio::test]
async fn a_stale_attachment_id_is_refreshed_from_the_message() {
    let server = MockServer::start().await;
    serve_message(&server, "message_m2_attachments.json", 1).await;
    let (db, _, m2) = setup();
    let gmail = client(&server.uri()).0;
    let cache = temp_cache();
    fetch_body(&db, &gmail, m2).await.unwrap();
    // Later, Gmail no longer accepts the logo's old attachment ID.
    server.reset().await;
    Mock::given(method("GET"))
        .and(path(
            "/gmail/v1/users/me/messages/m2/attachments/ATT_LOGO_OLD",
        ))
        .respond_with(
            ResponseTemplate::new(400).set_body_raw(fixture("error_404.json"), "application/json"),
        )
        .expect(1)
        .mount(&server)
        .await;
    serve_message(&server, "message_m2_attachments_refetched.json", 1).await;
    serve_attachment(&server, "ATT_LOGO_NEW", "iVBORw", 1).await;

    let logo = store::inline_parts(&db.conn(), m2).unwrap()[0].id;
    let path = attachments::download(&db, &gmail, logo, &cache)
        .await
        .unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), b"\x89PNG");
    std::fs::remove_dir_all(&cache).unwrap();
}

#[tokio::test]
async fn inline_images_are_embedded_in_the_email() {
    let server = MockServer::start().await;
    // Once for the body, once more for the GIF whose data came inline.
    serve_message(&server, "message_m2_attachments.json", 2).await;
    serve_attachment(&server, "ATT_LOGO_OLD", "iVBORw", 1).await;
    let (db, _, m2) = setup();
    let gmail = client(&server.uri()).0;
    let cache = temp_cache();
    let body = fetch_body(&db, &gmail, m2).await.unwrap();

    let images = attachments::inline_images(&db, &gmail, m2, &cache).await;
    assert_eq!(images["logo@x"], "data:image/png;base64,iVBORw==");
    assert!(images["dot@x"].starts_with("data:image/gif;base64,R0lGOD"));

    let shown = mail::safe_message(&body, false, &images, &Default::default(), false);
    assert!(shown.document.contains("data:image/png;base64,iVBORw=="));
    assert!(!shown.document.contains("cid:"));
    std::fs::remove_dir_all(&cache).unwrap();
}
