//! Local SQLite cache. Setup follows MonoCode's `session_store.rs`: WAL,
//! foreign keys on, and a `schema_migrations` table with numbered steps.

pub mod accounts;
pub mod cache;
pub mod erase;
pub mod query;
mod schema;
pub mod store;

use std::path::Path;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection};

use crate::error::{CoreError, Result};

pub struct Db {
    conn: Mutex<Connection>,
    /// SQLite's `data_version` when last checked (see `changed_elsewhere`).
    seen_version: AtomicI64,
}

/// The database's file name in the app's data folder.
pub const FILE_NAME: &str = "mail.sqlite3";

/// The database file in `dir`.
pub fn path_in(dir: &Path) -> std::path::PathBuf {
    dir.join(FILE_NAME)
}

/// The database file and the write-ahead files SQLite keeps beside it.
pub(crate) fn database_files(path: &Path) -> [std::path::PathBuf; 3] {
    let with = |suffix: &str| {
        let mut name = path.as_os_str().to_owned();
        name.push(suffix);
        std::path::PathBuf::from(name)
    };
    [path.to_path_buf(), with("-wal"), with("-shm")]
}

impl Db {
    /// Opens (or makes) the database at `path`, and on macOS and Linux
    /// makes its folder, the database and its write-ahead files this
    /// user's only (`owner_only`), including ones an earlier version made
    /// open. SQLite gives new write-ahead files the database's mode. That
    /// part is best effort: a folder or file whose mode can't be changed
    /// (owned by another account) still opens, as before.
    pub fn open(path: &Path) -> Result<Self> {
        Self::open_at(path, None)
    }

    /// `open`, unlocking an encrypted database with `key` before anything
    /// else reads it (`cache::open_cache` decides which). A wrong key fails
    /// with SQLite's "not a database" (`cache::is_wrong_key`).
    pub(crate) fn open_at(path: &Path, key: Option<&cache::CacheKey>) -> Result<Self> {
        require_cipher()?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| CoreError::Other(format!("create data dir: {e}")))?;
            let _ = crate::owner_only::dir(parent);
        }
        let conn = Connection::open(path)?;
        if let Some(key) = key {
            cache::apply_key(&conn, key)?;
        }
        conn.execute_batch(
            "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;",
        )?;
        for file in database_files(path) {
            let _ = crate::owner_only::file(&file);
        }
        Self::init(conn)
    }

    pub fn open_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        Self::init(conn)
    }

    fn init(mut conn: Connection) -> Result<Self> {
        cipher_version(&conn)?;
        migrate(&mut conn)?;
        let version = data_version(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
            seen_version: AtomicI64::new(version),
        })
    }

    /// Short-lived access to the connection. Keep work inside small: sync
    /// workers and UI queries share this lock.
    pub fn conn(&self) -> MutexGuard<'_, Connection> {
        // A poisoned lock means a panic mid-query; SQLite's own transaction
        // rollback keeps the data consistent, so continue with the connection.
        self.conn.lock().unwrap_or_else(|e| e.into_inner())
    }
}

impl Db {
    /// Whether another process (a second copy of the app, e.g. a dev build
    /// next to the installed app) wrote to the database since the last
    /// call. SQLite's `data_version` only moves for other connections'
    /// commits, so this process's own writes don't count.
    pub fn changed_elsewhere(&self) -> Result<bool> {
        let now = data_version(&self.conn())?;
        Ok(self.seen_version.swap(now, Ordering::Relaxed) != now)
    }
}

/// The version of the encrypting SQLite (SQLite3 Multiple Ciphers) this
/// build links. An error when it links plain SQLite instead, which happens
/// if Cargo skipped the workspace's `[patch.crates-io]` (a rusqlite upgrade
/// that asks for another `libsqlite3-sys`): the database must not open then.
pub fn cipher_version(conn: &Connection) -> Result<String> {
    match conn.query_row("SELECT sqlite3mc_version()", [], |r| r.get(0)) {
        Ok(version) => Ok(version),
        Err(e)
            if e.to_string()
                .contains("no such function: sqlite3mc_version") =>
        {
            Err(CoreError::Other(
                "This copy of the app was built without its encrypting SQLite \
                 (SQLite3 Multiple Ciphers), so it can't open the mail cache. \
                 Install an official build."
                    .into(),
            ))
        }
        Err(e) => Err(e.into()),
    }
}

/// `cipher_version` on a connection of its own, in memory, so a build
/// without the encrypting SQLite stops before anything on disk is read,
/// created or changed. App startup calls it first, and so does `Db::open`.
pub fn require_cipher() -> Result<String> {
    cipher_version(&Connection::open_in_memory()?)
}

fn data_version(conn: &Connection) -> Result<i64> {
    Ok(conn.query_row("PRAGMA data_version", [], |r| r.get(0))?)
}

fn migrate(conn: &mut Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
           version INTEGER PRIMARY KEY,
           applied_at INTEGER NOT NULL
         )",
        [],
    )?;
    let current: i64 = conn.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        [],
        |row| row.get(0),
    )?;
    let steps: &[(i64, &str)] = &[
        (1, schema::MIGRATION_V1),
        (2, schema::MIGRATION_V2),
        (3, schema::MIGRATION_V3),
        (4, schema::MIGRATION_V4),
        (5, schema::MIGRATION_V5),
        (6, schema::MIGRATION_V6),
        (7, schema::MIGRATION_V7),
        (8, schema::MIGRATION_V8),
        (9, schema::MIGRATION_V9),
        (10, schema::MIGRATION_V10),
        (11, schema::MIGRATION_V11),
        (12, schema::MIGRATION_V12),
        (13, schema::MIGRATION_V13),
        (14, schema::MIGRATION_V14),
        (15, schema::MIGRATION_V15),
        (16, schema::MIGRATION_V16),
        (17, schema::MIGRATION_V17),
        (18, schema::MIGRATION_V18),
        (19, schema::MIGRATION_V19),
        (20, schema::MIGRATION_V20),
        (21, schema::MIGRATION_V21),
        (22, schema::MIGRATION_V22),
        (23, schema::MIGRATION_V23),
        (24, schema::MIGRATION_V24),
        (25, schema::MIGRATION_V25),
    ];
    for (version, sql) in steps {
        if current < *version {
            let tx = conn.transaction()?;
            tx.execute_batch(sql)?;
            tx.execute(
                "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
                params![version, now_millis()],
            )?;
            tx.commit()?;
        }
    }
    Ok(())
}

pub fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// `IN (?, ?, ...)` placeholder list for `n` values.
pub(crate) fn placeholders(n: usize) -> String {
    vec!["?"; n].join(", ")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The database's folder, the database and its write-ahead files are
    /// this user's only, new or left open by an earlier version.
    #[cfg(unix)]
    #[test]
    fn the_database_is_this_users_only() {
        use std::os::unix::fs::PermissionsExt;
        let mode = |p: &Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
        let root = std::env::temp_dir().join(format!("db-private-{}", fastrand::u64(..)));
        let path = path_in(&root.join("data"));
        let db = Db::open(&path).unwrap();
        db.conn()
            .execute_batch("CREATE TABLE probe (x); INSERT INTO probe VALUES (1);")
            .unwrap();
        assert_eq!(mode(path.parent().unwrap()), 0o700);
        for file in database_files(&path) {
            assert_eq!(mode(&file), 0o600, "{file:?}");
        }
        drop(db);
        for file in [path.clone(), path.parent().unwrap().to_path_buf()] {
            std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let _db = Db::open(&path).unwrap();
        assert_eq!(mode(path.parent().unwrap()), 0o700);
        assert_eq!(mode(&path), 0o600);
        std::fs::remove_dir_all(&root).unwrap();
    }

    /// The encrypting SQLite is linked, with its default cipher. Fails when
    /// Cargo skipped the workspace's patch and built plain SQLite.
    #[test]
    fn the_cipher_is_linked() {
        let db = Db::open_in_memory().unwrap();
        let conn = db.conn();
        let version = cipher_version(&conn).unwrap();
        assert!(
            version.starts_with("SQLite3 Multiple Ciphers 2."),
            "{version}"
        );
        let cipher: String = conn.query_row("PRAGMA cipher", [], |r| r.get(0)).unwrap();
        assert_eq!(cipher, "chacha20");
        assert_eq!(require_cipher().unwrap(), version);
        // The SQLite inside it is the one the bindings were made for
        // (docs/DEVELOPMENT.md -> "The encrypting SQLite", step 3).
        assert_eq!(
            Ok(rusqlite::version()),
            rusqlite::ffi::SQLITE_VERSION.to_str()
        );
        // Temporary tables and sorts in memory: SQLite3 Multiple Ciphers
        // doesn't encrypt temporary files (vendor/libsqlite3-sys/build.rs,
        // "app:").
        let options: Vec<String> = conn
            .prepare("PRAGMA compile_options")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<std::result::Result<_, _>>()
            .unwrap();
        assert!(options.iter().any(|o| o == "TEMP_STORE=2"), "{options:?}");
    }

    #[test]
    fn migrations_apply_once_and_fts5_is_available() {
        let db = Db::open_in_memory().unwrap();
        let mut conn = db.conn();
        migrate(&mut conn).unwrap();
        let versions: i64 = conn
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |r| r.get(0))
            .unwrap();
        assert_eq!(versions, 25);
        // Migration 22's columns, with Gmail's defaults.
        conn.execute("INSERT INTO accounts (id, google_sub, email, color, oauth_client, created_at) VALUES (1, 's', 'a@example.com', '#5b8def', 'default', 0)", []).unwrap();
        conn.execute("INSERT INTO labels (account_id, gmail_label_id, name, kind) VALUES (1, 'L', 'L', 'user')", []).unwrap();
        conn.execute("INSERT INTO sync_state (account_id) VALUES (1)", [])
            .unwrap();
        let (list, message, synced): (String, String, i64) = conn
            .query_row(
                "SELECT l.list_visibility, l.message_visibility, s.labels_synced_at
                 FROM labels l JOIN sync_state s ON s.account_id = l.account_id",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(
            (list.as_str(), message.as_str(), synced),
            ("labelShow", "show", 0)
        );
        conn.execute(
            "INSERT INTO messages_fts (rowid, subject, sender, recipients, snippet, body) VALUES (1, 'hello', '', '', '', '')",
            [],
        )
        .unwrap();
    }

    /// `MIGRATION_V19` on a database from before it: access granted to
    /// accounts already removed is dropped, the rest kept, and IDs count on
    /// from the highest in use (a removed ID above it may be given out once
    /// more, but nothing is left keyed by it).
    #[test]
    fn upgrading_drops_access_left_by_removed_accounts() {
        let db = Db::open_in_memory().unwrap();
        let mut conn = db.conn();
        conn.execute_batch(
            "DROP TABLE account_id_seq;
             DELETE FROM schema_migrations WHERE version >= 19;
             ALTER TABLE labels DROP COLUMN list_visibility;
             ALTER TABLE labels DROP COLUMN message_visibility;
             ALTER TABLE sync_state DROP COLUMN labels_synced_at;
             DROP TABLE hidden_contacts;
             INSERT INTO accounts (id, google_sub, email, color, oauth_client, created_at)
               VALUES (1, 's1', 'a@example.com', '#5b8def', 'default', 0);
             INSERT INTO app_settings (key, value)
               VALUES ('app', '{\"theme\":\"dark\",\"mcp\":{\"read\":[1,2],\"drafts\":[2]}}');",
        )
        .unwrap();
        migrate(&mut conn).unwrap();
        let s = crate::settings::load(&conn).unwrap();
        assert_eq!(s.mcp.read, [crate::model::AccountId(1)]);
        assert!(s.mcp.drafts.is_empty());
        assert_eq!(s.theme, crate::settings::Theme::Dark, "the rest is kept");
        let next: i64 = conn
            .query_row("SELECT last FROM account_id_seq", [], |r| r.get(0))
            .unwrap();
        assert_eq!(next, 1);
    }

    /// `MIGRATION_V24` and `MIGRATION_V25`, each alone on the summaries
    /// saved before it, and the upgrade from before both: list lines go,
    /// full summaries stay. Each runs on its own, as the other deletes the
    /// same rows and would hide a broken one.
    #[test]
    fn upgrading_drops_list_lines_written_with_the_old_prompt() {
        for sql in [schema::MIGRATION_V24, schema::MIGRATION_V25] {
            let db = Db::open_in_memory().unwrap();
            let conn = db.conn();
            saved_summaries(&conn);
            conn.execute_batch(sql).unwrap();
            assert_eq!(summaries_left(&conn), [(1, "full".to_string())]);
        }
        let db = Db::open_in_memory().unwrap();
        let mut conn = db.conn();
        conn.execute("DELETE FROM schema_migrations WHERE version >= 24", [])
            .unwrap();
        saved_summaries(&conn);
        migrate(&mut conn).unwrap();
        assert_eq!(summaries_left(&conn), [(1, "full".to_string())]);
    }

    /// Two list lines and a full summary, as an older version saved them.
    fn saved_summaries(conn: &Connection) {
        conn.execute_batch(
            "
             INSERT INTO accounts (id, google_sub, email, color, oauth_client, created_at)
               VALUES (1, 's1', 'a@example.com', '#5b8def', 'default', 0);
             INSERT INTO threads (id, account_id, gmail_thread_id) VALUES (1, 1, 't1'), (2, 1, 't2');
             INSERT INTO ai_summaries (account_id, thread_id, kind, provider, newest_message_id, text, created_at)
               VALUES (1, 1, 'line', 'apple', 1, 'Lunch at 12:30, use code INVITE123', 0),
                      (1, 1, 'full', 'apple', 1, '- Lunch at 12:30', 0),
                      (1, 2, 'line', 'apple', 2, 'Sign-in code', 0);",
        )
        .unwrap();
    }

    fn summaries_left(conn: &Connection) -> Vec<(i64, String)> {
        conn.prepare("SELECT thread_id, kind FROM ai_summaries ORDER BY thread_id, kind")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<std::result::Result<_, _>>()
            .unwrap()
    }

    /// `MIGRATION_V21` on a database from before it: the shared image cache
    /// goes (its rows can't be given to an account), and the new one is
    /// per account, one copy of an address each.
    #[test]
    fn upgrading_replaces_the_shared_image_cache_with_one_per_account() {
        let db = Db::open_in_memory().unwrap();
        let mut conn = db.conn();
        conn.execute_batch(
            "DROP TABLE image_cache; DELETE FROM schema_migrations WHERE version >= 21;
             ALTER TABLE labels DROP COLUMN list_visibility;
             ALTER TABLE labels DROP COLUMN message_visibility;
             ALTER TABLE sync_state DROP COLUMN labels_synced_at;
             DROP TABLE hidden_contacts;
             CREATE TABLE image_cache (id INTEGER PRIMARY KEY, url TEXT NOT NULL UNIQUE,
               mime TEXT NOT NULL, size INTEGER NOT NULL, fetched_at INTEGER NOT NULL,
               used_at INTEGER NOT NULL);
             INSERT INTO accounts (id, google_sub, email, color, oauth_client, created_at)
               VALUES (1, 's1', 'a@example.com', '#5b8def', 'default', 0),
                      (2, 's2', 'b@example.com', '#e0803f', 'default', 0);
             INSERT INTO image_cache (id, url, mime, size, fetched_at, used_at)
               VALUES (7, 'https://x.example/a.png', 'image/png', 1, 0, 0);",
        )
        .unwrap();
        migrate(&mut conn).unwrap();
        let old: i64 = conn
            .query_row("SELECT COUNT(*) FROM image_cache", [], |r| r.get(0))
            .unwrap();
        assert_eq!(old, 0, "the shared cache is dropped");
        for account in [1, 2] {
            conn.execute(
                "INSERT INTO image_cache (account_id, url, mime, size, fetched_at, used_at)
                 VALUES (?1, 'https://x.example/a.png', 'image/png', 1, 0, 0)",
                [account],
            )
            .unwrap();
        }
        conn.execute("DELETE FROM accounts WHERE id = 1", [])
            .unwrap();
        let left: i64 = conn
            .query_row("SELECT COUNT(*) FROM image_cache", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 1, "an account's images go with it");
    }

    #[test]
    fn every_gmail_table_is_scoped_to_an_account() {
        let db = Db::open_in_memory().unwrap();
        let conn = db.conn();
        for table in [
            "labels",
            "threads",
            "messages",
            "message_labels",
            "thread_labels",
            "message_bodies",
            "attachments",
            "drafts",
            "sync_state",
            "send_as",
            "google_contacts",
            "search_hits",
            "ai_summaries",
            "ai_reply_ideas",
            "mcp_log",
            "image_cache",
        ] {
            let has: bool = conn
                .query_row(
                    &format!("SELECT COUNT(*) > 0 FROM pragma_table_info('{table}') WHERE name = 'account_id'"),
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert!(has, "{table} must have an account_id column");
        }
    }
}

#[cfg(test)]
mod changed_elsewhere_tests {
    use super::*;

    #[test]
    fn notices_another_process_writing_but_not_its_own_writes() {
        let dir = std::env::temp_dir().join(format!("db-version-test-{}", fastrand::u64(..)));
        let path = dir.join("db.sqlite3");
        let mine = Db::open(&path).unwrap();
        let other = Db::open(&path).unwrap();
        assert!(!mine.changed_elsewhere().unwrap());

        mine.conn()
            .execute(
                "INSERT INTO app_settings (key, value) VALUES ('a', '1')",
                [],
            )
            .unwrap();
        assert!(!mine.changed_elsewhere().unwrap(), "own writes don't count");

        other
            .conn()
            .execute(
                "INSERT INTO app_settings (key, value) VALUES ('b', '2')",
                [],
            )
            .unwrap();
        assert!(mine.changed_elsewhere().unwrap());
        assert!(!mine.changed_elsewhere().unwrap(), "reported once");
        let _ = std::fs::remove_dir_all(dir);
    }
}
