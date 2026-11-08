//! Local SQLite cache. Setup follows MonoCode's `session_store.rs`: WAL,
//! foreign keys on, and a `schema_migrations` table with numbered steps.

pub mod accounts;
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

impl Db {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| CoreError::Other(format!("create data dir: {e}")))?;
        }
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;",
        )?;
        Self::init(conn)
    }

    pub fn open_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        Self::init(conn)
    }

    fn init(mut conn: Connection) -> Result<Self> {
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

    #[test]
    fn migrations_apply_once_and_fts5_is_available() {
        let db = Db::open_in_memory().unwrap();
        let mut conn = db.conn();
        migrate(&mut conn).unwrap();
        let versions: i64 = conn
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |r| r.get(0))
            .unwrap();
        assert_eq!(versions, 21);
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

    /// `MIGRATION_V21` on a database from before it: the shared image cache
    /// goes (its rows can't be given to an account), and the new one is
    /// per account, one copy of an address each.
    #[test]
    fn upgrading_replaces_the_shared_image_cache_with_one_per_account() {
        let db = Db::open_in_memory().unwrap();
        let mut conn = db.conn();
        conn.execute_batch(
            "DROP TABLE image_cache; DELETE FROM schema_migrations WHERE version >= 21;
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
