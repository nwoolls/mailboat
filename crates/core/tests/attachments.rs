//! Received attachments: recorded when a body is fetched, downloaded into
//! the account's cache folder encrypted, and inline images embedded.

mod common;

use common::*;
use mail_core::attachments;
use mail_core::db::{accounts, store, Db};
use mail_core::gmail::parse;
use mail_core::gmail::types::Thread;
use mail_core::mail;
use mail_core::model::*;
use mail_core::sealed::{FileKey, Sealed};
use mail_core::sync::fetch_body;
use std::sync::Arc;
use wiremock::matchers::{method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn setup() -> (Db, AccountId, MessageId) {
    let db = Db::open_in_memory().unwrap();
    let account = accounts::upsert(
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

fn temp_cache() -> Sealed {
    let dir = std::env::temp_dir().join(format!("attachments-test-{}", fastrand::u64(..)));
    std::fs::create_dir_all(&dir).unwrap();
    Sealed::new(dir, Some(Arc::new(FileKey::generate().unwrap())))
}

/// Every file under `dir`.
fn files_under(dir: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut out = Vec::new();
    for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        if entry.file_type().unwrap().is_dir() {
            out.extend(files_under(&entry.path()));
        } else {
            out.push(entry.path());
        }
    }
    out
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
    // As an older version of the app stored it.
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
async fn downloads_land_in_the_accounts_folder_once_encrypted() {
    let server = MockServer::start().await;
    serve_message(&server, "message_m2_attachments.json", 1).await;
    serve_attachment(&server, "ATT_PDF", "JVBERi0xLjcK", 1).await;
    let (db, account, m2) = setup();
    let gmail = client(&server.uri()).0;
    let cache = temp_cache();
    fetch_body(&db, &gmail, m2).await.unwrap();
    let pdf = store::attachments_for(&db.conn(), m2).unwrap()[0].id;

    let bytes = attachments::download(&db, &gmail, pdf, &cache)
        .await
        .unwrap();
    assert_eq!(bytes, b"%PDF-1.7\n");
    // One file, in the account's folder, named by the attachment's ID: its
    // name and its contents can't be read from the folder.
    let files = files_under(&cache.dir);
    assert_eq!(files.len(), 1, "{files:?}");
    assert_eq!(
        files[0],
        attachments::account_dir(&cache.dir, account).join(pdf.0.to_string())
    );
    let on_disk = std::fs::read(&files[0]).unwrap();
    assert!(!on_disk.windows(4).any(|w| w == b"%PDF"), "encrypted");
    // Second time: straight from the cache (wiremock checks one request).
    assert_eq!(
        attachments::download(&db, &gmail, pdf, &cache)
            .await
            .unwrap(),
        bytes
    );
    std::fs::remove_dir_all(&cache.dir).unwrap();
}

/// A cached file that doesn't open (changed on disk, or from another key)
/// is downloaded again, and replaced.
#[tokio::test]
async fn a_cached_file_that_doesnt_open_is_downloaded_again() {
    let server = MockServer::start().await;
    serve_message(&server, "message_m2_attachments.json", 1).await;
    serve_attachment(&server, "ATT_PDF", "JVBERi0xLjcK", 2).await;
    let (db, _, m2) = setup();
    let gmail = client(&server.uri()).0;
    let cache = temp_cache();
    fetch_body(&db, &gmail, m2).await.unwrap();
    let pdf = store::attachments_for(&db.conn(), m2).unwrap()[0].id;
    attachments::download(&db, &gmail, pdf, &cache)
        .await
        .unwrap();
    let other = Sealed::new(
        cache.dir.clone(),
        Some(Arc::new(FileKey::generate().unwrap())),
    );
    assert_eq!(
        attachments::download(&db, &gmail, pdf, &other)
            .await
            .unwrap(),
        b"%PDF-1.7\n"
    );
    std::fs::remove_dir_all(&cache.dir).unwrap();
}

/// Without a key this run (the database stayed plain for an older copy),
/// attachments still open, and nothing is written to the cache folder.
#[tokio::test]
async fn without_a_key_attachments_are_fetched_and_not_kept() {
    let server = MockServer::start().await;
    serve_message(&server, "message_m2_attachments.json", 1).await;
    serve_attachment(&server, "ATT_PDF", "JVBERi0xLjcK", 2).await;
    let (db, _, m2) = setup();
    let gmail = client(&server.uri()).0;
    let dir = temp_cache().dir;
    let cache = Sealed::new(dir.clone(), None);
    fetch_body(&db, &gmail, m2).await.unwrap();
    let pdf = store::attachments_for(&db.conn(), m2).unwrap()[0].id;
    for _ in 0..2 {
        let bytes = attachments::download(&db, &gmail, pdf, &cache)
            .await
            .unwrap();
        assert_eq!(bytes, b"%PDF-1.7\n");
    }
    assert!(files_under(&dir).is_empty());
    std::fs::remove_dir_all(&dir).unwrap();
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
    let bytes = attachments::download(&db, &gmail, logo, &cache)
        .await
        .unwrap();
    assert_eq!(bytes, b"\x89PNG");
    std::fs::remove_dir_all(&cache.dir).unwrap();
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
    std::fs::remove_dir_all(&cache.dir).unwrap();
}

/// An account removed (or everything deleted) while an attachment is still
/// coming in: the download fails, and nothing is left in the cache.
#[tokio::test]
async fn a_download_finishing_after_its_account_is_gone_keeps_nothing() {
    let server = MockServer::start().await;
    serve_message(&server, "message_m2_attachments.json", 1).await;
    Mock::given(method("GET"))
        .and(path("/gmail/v1/users/me/messages/m2/attachments/ATT_PDF"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_delay(std::time::Duration::from_millis(400))
                .set_body_json(serde_json::json!({ "size": 9, "data": "JVBERi0xLjcK" })),
        )
        .mount(&server)
        .await;
    let (db, account, m2) = setup();
    let gmail = client(&server.uri()).0;
    let cache = temp_cache();
    fetch_body(&db, &gmail, m2).await.unwrap();
    let pdf = store::attachments_for(&db.conn(), m2).unwrap()[0].id;

    let download = attachments::download(&db, &gmail, pdf, &cache);
    let remove = async {
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        accounts::remove(&db.conn(), account).unwrap();
    };
    let (result, ()) = tokio::join!(download, remove);
    assert!(
        matches!(result, Err(mail_core::CoreError::NotFound(_))),
        "{result:?}"
    );
    assert!(
        !attachments::account_dir(&cache.dir, account).exists(),
        "no file stays behind"
    );
    let _ = std::fs::remove_dir_all(&cache.dir);
}

/// Review: attachment IDs are given out again after a row is deleted. An
/// account removed while one of its attachments is coming in, and the ID
/// given to another account's attachment meanwhile: the bytes aren't kept
/// for the other account's row.
#[tokio::test]
async fn a_download_never_lands_on_another_accounts_attachment_with_its_id() {
    let server = MockServer::start().await;
    serve_message(&server, "message_m2_attachments.json", 1).await;
    Mock::given(method("GET"))
        .and(path("/gmail/v1/users/me/messages/m2/attachments/ATT_PDF"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_delay(std::time::Duration::from_millis(400))
                .set_body_json(serde_json::json!({ "size": 9, "data": "JVBERi0xLjcK" })),
        )
        .mount(&server)
        .await;
    let (db, account, m2) = setup();
    let other = accounts::upsert(
        &db.conn(),
        &accounts::NewAccount {
            google_sub: "b",
            email: "b@x.example",
            display_name: None,
            avatar_url: None,
            oauth_client: "default",
        },
    )
    .unwrap()
    .id;
    let t: Thread = serde_json::from_str(&fixture("thread_t1.json")).unwrap();
    store::upsert_thread(&mut db.conn(), other, &parse::thread_to_incoming(&t)).unwrap();
    let others_m2: MessageId = db
        .conn()
        .query_row(
            "SELECT id FROM messages WHERE gmail_message_id = 'm2' AND account_id = ?1",
            [other],
            |r| r.get(0),
        )
        .unwrap();
    let gmail = client(&server.uri()).0;
    let cache = temp_cache();
    fetch_body(&db, &gmail, m2).await.unwrap();
    let pdf = store::attachments_for(&db.conn(), m2).unwrap()[0].id;

    let download = attachments::download(&db, &gmail, pdf, &cache);
    let replace = async {
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        accounts::remove(&db.conn(), account).unwrap();
        db.conn()
            .execute(
                "INSERT INTO attachments (id, account_id, message_id, part_id, filename, mime_type, size)
                 VALUES (?1, ?2, ?3, '2', 'notes.txt', 'text/plain', 5)",
                rusqlite::params![pdf, other, others_m2],
            )
            .unwrap();
    };
    let (result, ()) = tokio::join!(download, replace);
    assert!(
        matches!(result, Err(mail_core::CoreError::NotFound(_))),
        "{result:?}"
    );
    let cached: Option<String> = db
        .conn()
        .query_row(
            "SELECT cached_path FROM attachments WHERE id = ?1",
            [pdf],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(cached, None, "the other account's row isn't given the file");
    assert!(
        files_under(&cache.dir).is_empty(),
        "{:?}",
        files_under(&cache.dir)
    );
    let _ = std::fs::remove_dir_all(&cache.dir);
}
