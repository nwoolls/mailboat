//! Local SQLite cache. Setup follows MonoCode's `session_store.rs`: WAL,
//! foreign keys on, and a `schema_migrations` table with numbered steps.

pub mod accounts;
pub mod query;
mod schema;
pub mod store;

use std::path::Path;
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection};

use crate::error::{CoreError, Result};

pub struct Db {
    conn: Mutex<Connection>,
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
        Ok(Self {
            conn: Mutex::new(conn),
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
    let steps: &[(i64, &str)] = &[(1, schema::MIGRATION_V1), (2, schema::MIGRATION_V2)];
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
        assert_eq!(versions, 2);
        conn.execute(
            "INSERT INTO messages_fts (rowid, subject, sender, recipients, snippet, body) VALUES (1, 'hello', '', '', '', '')",
            [],
        )
        .unwrap();
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
