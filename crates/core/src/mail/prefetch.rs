//! Downloading remote images when mail arrives, so opening an email later
//! doesn't tell its sender when you read it.
//!
//! This follows Apple Mail's "Protect Mail Activity", which downloads
//! remote content "in the background when you receive a message" rather
//! than when you view it (Apple's Mail User Guide, "Protect email
//! privacy"). Unlike Apple's, the downloads come straight from this Mac:
//! Mailboat has no relay servers, so senders still see your IP address and
//! that the mail arrived, just not when (or whether) it was opened.
//!
//! Only images the image rule would load anyway are downloaded (never
//! Spam, blocked senders, or Trash), and known trackers are skipped. After
//! each sync pass, each account downloads images for its newest arrivals
//! (`MESSAGES_PER_PASS`, received in the last `RECENT_DAYS`). Copies live
//! as files in the image cache folder, indexed in `image_cache`; opening
//! an email swaps them in as `data:` URLs (`cached_for`). The cache is
//! shared by every account (an image is the same whoever received it) and
//! trimmed to the size chosen in Settings, least recently shown first.

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
                    let known = is_cached(&conn, &url)?;
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
                            store(db, &prefetch.dir, &url, &mime, &bytes)?;
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

fn is_cached(conn: &Connection, url: &str) -> Result<bool> {
    Ok(conn
        .query_row(
            "SELECT 1 FROM image_cache WHERE url = ?1",
            [url],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

fn file_for(dir: &Path, id: i64) -> PathBuf {
    dir.join(id.to_string())
}

/// Keeps one downloaded image: a row for it, and its bytes in a file
/// named by the row's id.
fn store(db: &Db, dir: &Path, url: &str, mime: &str, bytes: &[u8]) -> Result<()> {
    let now = now_millis();
    let id: Option<i64> = {
        let conn = db.conn();
        let added = conn.execute(
            "INSERT OR IGNORE INTO image_cache (url, mime, size, fetched_at, used_at)
             VALUES (?1, ?2, ?3, ?4, ?4)",
            params![url, mime, bytes.len() as i64, now],
        )?;
        (added > 0).then(|| conn.last_insert_rowid())
    };
    let Some(id) = id else { return Ok(()) };
    let written =
        std::fs::create_dir_all(dir).and_then(|()| std::fs::write(file_for(dir, id), bytes));
    if let Err(e) = written {
        db.conn()
            .execute("DELETE FROM image_cache WHERE id = ?1", [id])?;
        return Err(crate::CoreError::Other(format!("save image copy: {e}")));
    }
    Ok(())
}

/// The cached copies of `urls`, as `data:` URLs keyed by address (what
/// `sanitize_html_colors` takes). Marks them used, so they're kept longest.
pub fn cached_for(
    conn: &Connection,
    dir: &Path,
    urls: &[String],
) -> Result<HashMap<String, String>> {
    let mut out = HashMap::new();
    let now = now_millis();
    for url in urls {
        let row: Option<(i64, String)> = conn
            .query_row(
                "SELECT id, mime FROM image_cache WHERE url = ?1",
                [url],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        let Some((id, mime)) = row else { continue };
        match std::fs::read(file_for(dir, id)) {
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
    let oldest: Vec<(i64, i64)> = {
        let mut stmt = conn.prepare("SELECT id, size FROM image_cache ORDER BY used_at, id")?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        rows.collect::<rusqlite::Result<_>>()?
    };
    for (id, bytes) in oldest {
        if total <= limit {
            break;
        }
        let _ = std::fs::remove_file(file_for(dir, id));
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
                email: "a@me.com",
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
                        email: "news@shop.com".into(),
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
        let shown = cached_for(&db.conn(), &dir, std::slice::from_ref(&url)).unwrap();
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

    #[test]
    fn the_cache_is_trimmed_least_recently_shown_first() {
        let db = Db::open_in_memory().unwrap();
        let dir = tempdir();
        for (url, bytes) in [
            ("https://x/1", 10),
            ("https://x/2", 10),
            ("https://x/3", 10),
        ] {
            store(&db, &dir, url, "image/png", &vec![0u8; bytes]).unwrap();
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
        assert!(!is_cached(&conn, "https://x/2").unwrap());
        assert!(is_cached(&conn, "https://x/1").unwrap());
        assert_eq!(size(&conn).unwrap(), (20, 2));
        clear(&conn, &dir).unwrap();
        assert_eq!(size(&conn).unwrap(), (0, 0));
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0);
    }

    fn tempdir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "mailboat-prefetch-{}-{}",
            std::process::id(),
            fastrand::u64(..)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }
}
