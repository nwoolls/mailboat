//! Downloading remote images when mail arrives, so opening an email later
//! doesn't tell its sender when you read it.
//!
//! This follows Apple Mail's "Protect Mail Activity", which downloads
//! remote content "in the background when you receive a message" rather
//! than when you view it (Apple's Mail User Guide, "Protect email
//! privacy"). Unlike Apple's, the downloads come straight from this Mac:
//! The app has no relay servers, so senders still see your IP address and
//! that the mail arrived, just not when (or whether) it was opened.
//!
//! Only images the image rule would load anyway are downloaded (never
//! Spam, blocked senders, or Trash), and known trackers are skipped. After
//! each sync pass, each account downloads images for its newest arrivals
//! (`MESSAGES_PER_PASS`, received in the last `RECENT_DAYS`). Copies live
//! as files in the image cache folder, indexed in `image_cache`; opening
//! an email swaps them in as `data:` URLs (`cached_for`). Each account has
//! its own copies, in its own folder, so removing an account deletes its
//! images with it and nothing is keyed by an address alone (two accounts
//! that got the same image each download it). The whole cache is trimmed to
//! the size chosen in Settings, least recently shown first.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use base64::Engine;
use rusqlite::{params, Connection, OptionalExtension};
use tokio::task::JoinSet;

use super::images;
use super::sanitize::remote_image_urls;
use super::saved_image::fetch_web_image;
use crate::db::{now_millis, Db};
use crate::error::Result;
use crate::model::{AccountId, MessageId};

/// Images larger than this aren't kept (they load live if opened), as for
/// inline images.
pub const MAX_IMAGE_BYTES: usize = 5 * 1024 * 1024;
/// At most this many images per message (a long newsletter has ~30).
pub const IMAGES_PER_MESSAGE: usize = 40;
/// Messages handled per account per sync pass.
pub const MESSAGES_PER_PASS: u32 = 25;
/// Only mail this recent counts as "arriving"; older mail (a new account's
/// backlog) loads its images live, as before.
pub const RECENT_DAYS: i64 = 14;
/// Downloads at once.
const PARALLEL: usize = 4;

/// Where copies go and the HTTP client that fetches them.
#[derive(Debug, Clone)]
pub struct Prefetch {
    pub dir: PathBuf,
    pub http: reqwest::Client,
    /// Where an image is fetched from, given its (HTTPS) address: itself,
    /// except in tests, whose stand-in server only speaks plain HTTP.
    fetch_from: fn(&str) -> String,
}

impl Prefetch {
    /// A client for image downloads: a Safari user agent, as the reader's
    /// own image loads send, so a prefetch looks no different from opening
    /// the email; no cookies or referrer (reqwest sends neither).
    pub fn new(dir: PathBuf) -> Result<Self> {
        let http = reqwest::Client::builder()
            .user_agent(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)",
            )
            .timeout(Duration::from_secs(20))
            .build()
            .map_err(|e| crate::CoreError::Other(format!("image client: {e}")))?;
        Ok(Self {
            dir,
            http,
            fetch_from: str::to_string,
        })
    }
}

/// What one pass did, for the sync log (counts only).
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct PrefetchReport {
    pub messages: usize,
    pub images: usize,
    pub failed: usize,
}

/// Downloads images for an account's newest arrivals, if Settings allows.
pub async fn run(db: &Db, prefetch: &Prefetch, account: AccountId) -> Result<PrefetchReport> {
    let settings = crate::settings::load(&db.conn())?;
    let mut report = PrefetchReport::default();
    if !settings.image_prefetch {
        return Ok(report);
    }
    let candidates = pending(&db.conn(), account)?;
    for (message, html) in candidates {
        let (policy, _) = images::policy_for_message(&db.conn(), message)?;
        if policy.allows() {
            let urls: Vec<String> = remote_image_urls(&html)
                .into_iter()
                .take(IMAGES_PER_MESSAGE)
                .collect();
            let missing = {
                let conn = db.conn();
                let mut missing = Vec::new();
                for url in urls {
                    let known = is_cached(&conn, account, &url)?;
                    if !known {
                        missing.push(url);
                    }
                }
                missing
            };
            for chunk in missing.chunks(PARALLEL) {
                let mut set = JoinSet::new();
                for url in chunk {
                    let http = prefetch.http.clone();
                    let url = url.clone();
                    let from = (prefetch.fetch_from)(&url);
                    set.spawn(async move {
                        let got = fetch_web_image(&http, &from, MAX_IMAGE_BYTES).await;
                        (url, got)
                    });
                }
                while let Some(joined) = set.join_next().await {
                    match joined {
                        Ok((url, Ok((bytes, mime, _)))) => {
                            store(db, &prefetch.dir, account, &url, &mime, &bytes)?;
                            report.images += 1;
                        }
                        _ => report.failed += 1,
                    }
                }
            }
        }
        mark_done(&db.conn(), message)?;
        report.messages += 1;
    }
    let limit = u64::from(settings.image_cache_mb) * 1024 * 1024;
    evict(&db.conn(), &prefetch.dir, limit)?;
    Ok(report)
}

/// The account's recent messages whose images haven't been handled.
fn pending(conn: &Connection, account: AccountId) -> Result<Vec<(MessageId, String)>> {
    let since = now_millis() - RECENT_DAYS * 24 * 3600 * 1000;
    let mut stmt = conn.prepare(
        "SELECT m.id, b.html FROM messages m JOIN message_bodies b ON b.message_id = m.id
         WHERE m.account_id = ?1 AND b.images_prefetched = 0 AND b.html IS NOT NULL
           AND m.internal_date >= ?2
         ORDER BY m.internal_date DESC LIMIT ?3",
    )?;
    let rows = stmt.query_map(params![account, since, MESSAGES_PER_PASS], |r| {
        Ok((r.get(0)?, r.get(1)?))
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Marks a message's images as handled: downloaded, or not wanted (opened
/// first, so they loaded live; or held back by the image rule).
pub fn mark_done(conn: &Connection, message: MessageId) -> Result<()> {
    conn.execute(
        "UPDATE message_bodies SET images_prefetched = 1 WHERE message_id = ?1",
        [message],
    )?;
    Ok(())
}

fn is_cached(conn: &Connection, account: AccountId, url: &str) -> Result<bool> {
    Ok(conn
        .query_row(
            "SELECT 1 FROM image_cache WHERE account_id = ?1 AND url = ?2",
            params![account, url],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

/// An account's folder in the image cache.
fn account_dir(dir: &Path, account: AccountId) -> PathBuf {
    dir.join(account.0.to_string())
}

fn file_for(dir: &Path, account: AccountId, id: i64) -> PathBuf {
    account_dir(dir, account).join(id.to_string())
}

/// Deletes an account's downloaded images, its whole folder. A folder that
/// isn't there counts as done; any other failure is an error, so a removal
/// that couldn't delete them can be tried again.
pub fn remove_account_images(dir: &Path, account: AccountId) -> Result<()> {
    match std::fs::remove_dir_all(account_dir(dir, account)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(crate::CoreError::Other(format!(
            "delete the account's downloaded images: {e}"
        ))),
    }
}

/// Deletes the files the image cache kept before it was per account
/// (directly in the cache folder, named by a number), which nothing lists
/// now. Anything else there, and the folders (each an account's own), stay.
pub fn sweep_shared_copies(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let numbered = entry
            .file_name()
            .to_str()
            .is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()));
        if numbered && entry.file_type().is_ok_and(|t| t.is_file()) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// Keeps one downloaded image for an account: its bytes in a file named by
/// the row's id, in the account's folder, and a row for it. The bytes are
/// written first, to a temporary name; the row is added and the file given
/// its name under one hold of the database, so a reader never finds a row
/// without its file, and a failure can only undo its own row.
fn store(
    db: &Db,
    dir: &Path,
    account: AccountId,
    url: &str,
    mime: &str,
    bytes: &[u8],
) -> Result<()> {
    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let folder = account_dir(dir, account);
    let temp = folder.join(format!(
        "incoming-{}.tmp",
        COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    let save_error = |e: std::io::Error| crate::CoreError::Other(format!("save image copy: {e}"));
    std::fs::create_dir_all(&folder)
        .and_then(|()| std::fs::write(&temp, bytes))
        .map_err(save_error)?;
    let conn = db.conn();
    let added = conn.execute(
        "INSERT OR IGNORE INTO image_cache (account_id, url, mime, size, fetched_at, used_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        params![account, url, mime, bytes.len() as i64, now_millis()],
    );
    let added = match added {
        Ok(added) => added,
        Err(e) => {
            let _ = std::fs::remove_file(&temp);
            return Err(e.into());
        }
    };
    if added == 0 {
        // Already kept (by this account's earlier pass).
        let _ = std::fs::remove_file(&temp);
        return Ok(());
    }
    let id = conn.last_insert_rowid();
    if let Err(e) = std::fs::rename(&temp, file_for(dir, account, id)) {
        let _ = std::fs::remove_file(&temp);
        conn.execute("DELETE FROM image_cache WHERE id = ?1", [id])?;
        return Err(save_error(e));
    }
    Ok(())
}

/// The account's cached copies of `urls`, as `data:` URLs keyed by address
/// (what `sanitize_html_colors` takes). Marks them used, so they're kept
/// longest.
pub fn cached_for(
    conn: &Connection,
    dir: &Path,
    account: AccountId,
    urls: &[String],
) -> Result<HashMap<String, String>> {
    let mut out = HashMap::new();
    let now = now_millis();
    for url in urls {
        let row: Option<(i64, String)> = conn
            .query_row(
                "SELECT id, mime FROM image_cache WHERE account_id = ?1 AND url = ?2",
                params![account, url],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        let Some((id, mime)) = row else { continue };
        match std::fs::read(file_for(dir, account, id)) {
            Ok(bytes) => {
                let data = base64::engine::general_purpose::STANDARD.encode(bytes);
                out.insert(url.clone(), format!("data:{mime};base64,{data}"));
                conn.execute(
                    "UPDATE image_cache SET used_at = ?2 WHERE id = ?1",
                    params![id, now],
                )?;
            }
            // The file went missing (the cache folder was cleaned): forget it.
            Err(_) => {
                conn.execute("DELETE FROM image_cache WHERE id = ?1", [id])?;
            }
        }
    }
    Ok(out)
}

/// How much the cache holds: bytes and images.
pub fn size(conn: &Connection) -> Result<(u64, u32)> {
    let (bytes, count): (i64, i64) = conn.query_row(
        "SELECT COALESCE(SUM(size), 0), COUNT(*) FROM image_cache",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    Ok((bytes.max(0) as u64, count.max(0) as u32))
}

/// Removes least recently shown copies until the cache fits `limit` bytes.
pub fn evict(conn: &Connection, dir: &Path, limit: u64) -> Result<()> {
    let (mut total, _) = size(conn)?;
    if total <= limit {
        return Ok(());
    }
    let oldest: Vec<(i64, AccountId, i64)> = {
        let mut stmt =
            conn.prepare("SELECT id, account_id, size FROM image_cache ORDER BY used_at, id")?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
        rows.collect::<rusqlite::Result<_>>()?
    };
    for (id, account, bytes) in oldest {
        if total <= limit {
            break;
        }
        let _ = std::fs::remove_file(file_for(dir, account, id));
        conn.execute("DELETE FROM image_cache WHERE id = ?1", [id])?;
        total = total.saturating_sub(bytes.max(0) as u64);
    }
    Ok(())
}

/// Empties the cache (Settings' "Clear").
pub fn clear(conn: &Connection, dir: &Path) -> Result<()> {
    evict(conn, dir, 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::store::{set_body, upsert_thread, IncomingMessage, IncomingThread, StoredBody};
    use crate::db::{accounts, Db};
    use crate::model::Address;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn setup(db: &Db, labels: &[&str], html: &str, at: i64) -> (AccountId, MessageId) {
        let account = accounts::upsert(
            &db.conn(),
            &accounts::NewAccount {
                google_sub: "a",
                email: "a@me.example",
                display_name: None,
                avatar_url: None,
                oauth_client: "default",
            },
        )
        .unwrap()
        .id;
        let mut conn = db.conn();
        upsert_thread(
            &mut conn,
            account,
            &IncomingThread {
                gmail_thread_id: "t1".into(),
                messages: vec![IncomingMessage {
                    gmail_message_id: "m1".into(),
                    label_ids: labels.iter().map(|l| l.to_string()).collect(),
                    internal_date: at,
                    from: Some(Address {
                        name: None,
                        email: "news@shop.example".into(),
                    }),
                    ..Default::default()
                }],
            },
        )
        .unwrap();
        let id: MessageId = conn
            .query_row("SELECT id FROM messages", [], |r| r.get(0))
            .unwrap();
        set_body(
            &mut conn,
            id,
            &StoredBody {
                html: Some(html.into()),
                text: None,
            },
            &[],
        )
        .unwrap();
        (account, id)
    }

    async fn server() -> MockServer {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/a.png"))
            .respond_with(ResponseTemplate::new(200).set_body_raw(vec![1u8, 2, 3], "image/png"))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/page"))
            .respond_with(ResponseTemplate::new(200).set_body_raw("<html>", "text/html"))
            .mount(&server)
            .await;
        server
    }

    fn html(server: &MockServer) -> String {
        format!(
            r#"<img src="{0}/a.png" width="100"><img src="{0}/page" width="100"><img src="{0}/missing.png" width="100">"#,
            server.uri()
        )
    }

    /// The stand-in server is plain HTTP; addresses are upgraded to HTTPS
    /// (as the reader loads them), so fetch them back over HTTP.
    fn prefetch(dir: &Path) -> Prefetch {
        Prefetch {
            fetch_from: |url| url.replacen("https://", "http://", 1),
            ..Prefetch::new(dir.to_path_buf()).unwrap()
        }
    }

    async fn run_plain(db: &Db, prefetch: &Prefetch, account: AccountId) -> PrefetchReport {
        run(db, prefetch, account).await.unwrap()
    }

    #[tokio::test]
    async fn new_mail_gets_its_images_downloaded_and_shown_from_the_copy() {
        let server = server().await;
        let db = Db::open_in_memory().unwrap();
        let (account, _) = setup(&db, &["INBOX"], &html(&server), now_millis());
        let dir = tempdir();
        let report = run_plain(&db, &prefetch(&dir), account).await;
        assert_eq!(report.messages, 1);
        assert_eq!(report.images, 1, "the page and the 404 aren't images");
        assert_eq!(report.failed, 2);
        let url = format!("{}/a.png", server.uri()).replacen("http://", "https://", 1);
        let shown = cached_for(&db.conn(), &dir, account, std::slice::from_ref(&url)).unwrap();
        assert_eq!(shown[&url], "data:image/png;base64,AQID");
        // Handled once: the next pass finds nothing to do.
        assert_eq!(run_plain(&db, &prefetch(&dir), account).await.messages, 0);
    }

    #[tokio::test]
    async fn spam_old_mail_and_the_setting_off_download_nothing() {
        let server = server().await;
        let dir = tempdir();
        for (labels, at) in [
            (&["SPAM"][..], now_millis()),
            (
                &["INBOX"][..],
                now_millis() - (RECENT_DAYS + 1) * 24 * 3600 * 1000,
            ),
        ] {
            let db = Db::open_in_memory().unwrap();
            let (account, _) = setup(&db, labels, &html(&server), at);
            assert_eq!(run_plain(&db, &prefetch(&dir), account).await.images, 0);
        }
        let db = Db::open_in_memory().unwrap();
        let (account, _) = setup(&db, &["INBOX"], &html(&server), now_millis());
        let mut settings = crate::settings::load(&db.conn()).unwrap();
        settings.image_prefetch = false;
        crate::settings::save(&db.conn(), &settings).unwrap();
        assert_eq!(run_plain(&db, &prefetch(&dir), account).await.messages, 0);
    }

    /// An account with one conversation. The Gmail IDs are the same for
    /// every account on purpose: they're only unique per account.
    fn account_with_mail(db: &Db, sub: &str, html: &str) -> AccountId {
        let account = accounts::upsert(
            &db.conn(),
            &accounts::NewAccount {
                google_sub: sub,
                email: &format!("{sub}@me.example"),
                display_name: None,
                avatar_url: None,
                oauth_client: "default",
            },
        )
        .unwrap()
        .id;
        let mut conn = db.conn();
        upsert_thread(
            &mut conn,
            account,
            &IncomingThread {
                gmail_thread_id: "t1".into(),
                messages: vec![IncomingMessage {
                    gmail_message_id: "m1".into(),
                    label_ids: vec!["INBOX".into()],
                    internal_date: now_millis(),
                    from: Some(Address {
                        name: None,
                        email: "news@shop.example".into(),
                    }),
                    ..Default::default()
                }],
            },
        )
        .unwrap();
        let id: MessageId = conn
            .query_row(
                "SELECT id FROM messages WHERE account_id = ?1",
                [account],
                |r| r.get(0),
            )
            .unwrap();
        set_body(
            &mut conn,
            id,
            &StoredBody {
                html: Some(html.into()),
                text: None,
            },
            &[],
        )
        .unwrap();
        account
    }

    /// Files kept for images, in every account's folder (and any directly in
    /// the cache folder).
    fn files_in(dir: &Path) -> usize {
        std::fs::read_dir(dir).map_or(0, |entries| {
            entries
                .flatten()
                .map(|e| {
                    if e.path().is_dir() {
                        files_in(&e.path())
                    } else {
                        1
                    }
                })
                .sum()
        })
    }

    /// The multi-account rule: nothing keyed by an address alone. An image
    /// two accounts received is downloaded for each, and removing one
    /// account deletes its copies and leaves the other's.
    #[tokio::test]
    async fn removing_an_account_deletes_its_images_and_leaves_the_others() {
        use crate::auth::tokens::{remove_account, MemoryStore};
        let server = MockServer::start().await;
        for name in ["shared", "only-a", "only-b"] {
            Mock::given(method("GET"))
                .and(path(format!("/{name}.png")))
                .respond_with(ResponseTemplate::new(200).set_body_raw(vec![1u8, 2], "image/png"))
                .mount(&server)
                .await;
        }
        let img = |name: &str| format!(r#"<img src="{}/{name}.png" width="100">"#, server.uri());
        let db = Db::open_in_memory().unwrap();
        let a = account_with_mail(&db, "sub-a", &format!("{}{}", img("shared"), img("only-a")));
        let b = account_with_mail(&db, "sub-b", &format!("{}{}", img("shared"), img("only-b")));
        let dir = tempdir();
        assert_eq!(run_plain(&db, &prefetch(&dir), a).await.images, 2);
        assert_eq!(
            run_plain(&db, &prefetch(&dir), b).await.images,
            2,
            "each account keeps its own copy of the shared image"
        );
        assert_eq!(files_in(&account_dir(&dir, a)), 2);
        assert_eq!(files_in(&account_dir(&dir, b)), 2);

        let urls: Vec<String> = ["shared", "only-a", "only-b"]
            .iter()
            .map(|n| format!("{}/{n}.png", server.uri()).replacen("http://", "https://", 1))
            .collect();
        // Each account sees its own copies, never the other's.
        let of_a = cached_for(&db.conn(), &dir, a, &urls).unwrap();
        let of_b = cached_for(&db.conn(), &dir, b, &urls).unwrap();
        assert!(of_a.contains_key(&urls[1]) && !of_a.contains_key(&urls[2]));
        assert!(of_b.contains_key(&urls[2]) && !of_b.contains_key(&urls[1]));

        let secrets = MemoryStore::default();
        remove_account(&db, &secrets, a, &dir).unwrap();
        assert!(!account_dir(&dir, a).exists());
        assert_eq!(files_in(&dir), 2, "the other account's copies stay");
        assert_eq!(size(&db.conn()).unwrap(), (4, 2));
        let shown = cached_for(&db.conn(), &dir, b, &urls).unwrap();
        assert!(shown.contains_key(&urls[0]) && shown.contains_key(&urls[2]));
        assert!(
            cached_for(&db.conn(), &dir, a, &urls).unwrap().is_empty(),
            "the removed account has none"
        );

        remove_account(&db, &secrets, b, &dir).unwrap();
        assert_eq!(files_in(&dir), 0);
        assert_eq!(size(&db.conn()).unwrap(), (0, 0));
    }

    /// A folder that can't be deleted keeps the account and its token to try
    /// again (so a retry can still ask Google to revoke it), like a keychain
    /// that fails (code review R4-05); an account that never had images is
    /// removed all the same.
    #[test]
    fn images_that_cant_be_deleted_keep_the_account_to_try_again() {
        use crate::auth::tokens::{refresh_token_key, remove_account, MemoryStore, SecretStore};
        let db = Db::open_in_memory().unwrap();
        let a = account_with_mail(&db, "sub-a", "<p>x</p>");
        let dir = tempdir();
        let secrets = MemoryStore::default();
        secrets.set(&refresh_token_key("sub-a"), "r").unwrap();
        // A file where the account's folder should be: not removable as a folder.
        std::fs::write(account_dir(&dir, a), b"x").unwrap();
        assert!(remove_account(&db, &secrets, a, &dir).is_err());
        assert!(accounts::get(&db.conn(), a).is_ok(), "the account is kept");
        assert_eq!(
            secrets.get(&refresh_token_key("sub-a")).unwrap().as_deref(),
            Some("r"),
            "and its token, which a retry revokes again"
        );
        std::fs::remove_file(account_dir(&dir, a)).unwrap();
        remove_account(&db, &secrets, a, &dir).unwrap();
        assert!(accounts::get(&db.conn(), a).is_err());
        assert_eq!(secrets.get(&refresh_token_key("sub-a")).unwrap(), None);
        // Never had images: no folder, still fine.
        let b = account_with_mail(&db, "sub-b", "<p>x</p>");
        remove_account(&db, &secrets, b, &dir).unwrap();
    }

    /// A copy that can't be given its name leaves no row and no stray file,
    /// and a good one leaves no temporary file.
    #[test]
    fn a_copy_that_cant_be_kept_leaves_nothing_behind() {
        let db = Db::open_in_memory().unwrap();
        let account = account_with_mail(&db, "sub-a", "<p>x</p>");
        let dir = tempdir();
        // The first row will be 1: a folder in the way of its file.
        std::fs::create_dir_all(file_for(&dir, account, 1)).unwrap();
        assert!(store(&db, &dir, account, "https://x/1", "image/png", &[1, 2]).is_err());
        assert!(!is_cached(&db.conn(), account, "https://x/1").unwrap());
        let strays = std::fs::read_dir(account_dir(&dir, account))
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .count();
        assert_eq!(strays, 0);
        // Another row, and a repeat of it, keep exactly one copy.
        std::fs::remove_dir(file_for(&dir, account, 1)).unwrap();
        store(&db, &dir, account, "https://x/2", "image/png", &[1, 2]).unwrap();
        store(&db, &dir, account, "https://x/2", "image/png", &[1, 2]).unwrap();
        assert_eq!(files_in(&dir), 1);
        let shown = cached_for(&db.conn(), &dir, account, &["https://x/2".to_string()]).unwrap();
        assert_eq!(shown.len(), 1);
    }

    #[test]
    fn copies_kept_before_the_cache_was_per_account_are_swept() {
        let dir = tempdir();
        std::fs::write(dir.join("12"), b"x").unwrap();
        std::fs::write(dir.join(".DS_Store"), b"x").unwrap();
        std::fs::create_dir_all(dir.join("3")).unwrap();
        std::fs::write(dir.join("3").join("5"), b"y").unwrap();
        sweep_shared_copies(&dir);
        assert!(!dir.join("12").exists(), "a numbered flat file goes");
        assert!(dir.join(".DS_Store").exists(), "anything else stays");
        assert!(
            dir.join("3").join("5").exists(),
            "an account's folder stays"
        );
    }

    #[test]
    fn the_cache_is_trimmed_least_recently_shown_first() {
        let db = Db::open_in_memory().unwrap();
        let account = account_with_mail(&db, "sub-a", "<p>x</p>");
        let dir = tempdir();
        for (url, bytes) in [
            ("https://x/1", 10),
            ("https://x/2", 10),
            ("https://x/3", 10),
        ] {
            store(&db, &dir, account, url, "image/png", &vec![0u8; bytes]).unwrap();
        }
        let conn = db.conn();
        conn.execute(
            "UPDATE image_cache SET used_at = 1 WHERE url = 'https://x/2'",
            [],
        )
        .unwrap();
        conn.execute(
            "UPDATE image_cache SET used_at = 2 WHERE url = 'https://x/1'",
            [],
        )
        .unwrap();
        evict(&conn, &dir, 20).unwrap();
        assert!(!is_cached(&conn, account, "https://x/2").unwrap());
        assert!(is_cached(&conn, account, "https://x/1").unwrap());
        assert_eq!(size(&conn).unwrap(), (20, 2));
        clear(&conn, &dir).unwrap();
        assert_eq!(size(&conn).unwrap(), (0, 0));
        assert_eq!(files_in(&dir), 0);
    }

    fn tempdir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "prefetch-test-{}-{}",
            std::process::id(),
            fastrand::u64(..)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }
}
