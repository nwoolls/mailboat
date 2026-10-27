//! The one-time move to a new bundle ID. The first launch under the new ID
//! copies what the app kept under the previous one (`brand::PREVIOUS_ID`):
//! its folders, the database and the keychain sign-ins. Copied, not
//! moved: the previous copy keeps working, as a way back, until the owner
//! deletes it. Once the new database exists, nothing runs again.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::time::Duration;

use rusqlite::backup::Backup;
use rusqlite::Connection;

use crate::auth::{tokens, SecretStore};
use crate::brand;
use crate::db;
use crate::error::{CoreError, Result};

/// What was copied, for the log (counts only).
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Outcome {
    pub files: usize,
    /// Files that couldn't be copied (locked, unreadable); left behind.
    pub files_missed: usize,
    pub sign_ins: usize,
    /// Accounts whose sign-in couldn't be read (refused, or never there).
    /// They show as signed out and need signing in again.
    pub sign_ins_missed: usize,
}

/// `path` with the current bundle ID swapped for the previous one, where
/// it is a whole folder name (`…/Application Support/<ID>`, or
/// `…\<ID>\logs` on Windows), or `None` if the path doesn't hold it.
pub fn former(path: &Path) -> Option<PathBuf> {
    former_with(path, brand::ID, brand::PREVIOUS_ID)
}

fn former_with(path: &Path, id: &str, previous: &str) -> Option<PathBuf> {
    let mut found = false;
    let out: PathBuf = path
        .iter()
        .map(|part| {
            if part == id {
                found = true;
                OsString::from(previous)
            } else {
                part.to_owned()
            }
        })
        .collect();
    found.then_some(out)
}

/// The previous ID's database in `dir`: `mail.sqlite3`, or the file from
/// before that name was neutral (`<previous short name>.sqlite3`).
fn previous_database(dir: &Path) -> Option<PathBuf> {
    [
        dir.join(db::FILE_NAME),
        dir.join(format!("{}.sqlite3", brand::PREVIOUS_SHORT_NAME)),
    ]
    .into_iter()
    .find(|p| p.is_file())
}

/// Whether there's anything to carry over: a database under the previous
/// ID's data folder and none yet in `data`.
pub fn needed(previous_data: &Path, data: &Path) -> bool {
    !db::path_in(data).exists() && previous_database(previous_data).is_some()
}

/// Copies everything over: each `(from, to)` folder (files already at the
/// destination are kept), then the database from `previous_data` into
/// `data`, then each account's sign-in from `old_keys` to `new_keys`. The
/// database arrives last, under a temporary name until it's complete, so
/// an interrupted run starts again at the next launch.
pub fn run(
    previous_data: &Path,
    data: &Path,
    folders: &[(PathBuf, PathBuf)],
    old_keys: &dyn SecretStore,
    new_keys: &dyn SecretStore,
) -> Result<Outcome> {
    let io = |what: &str, e: std::io::Error| CoreError::Other(format!("carry over {what}: {e}"));
    let mut outcome = Outcome::default();
    let Some(source) = previous_database(previous_data) else {
        return Ok(outcome);
    };
    for (from, to) in folders {
        copy_folder(from, to, true, &mut outcome);
    }

    std::fs::create_dir_all(data).map_err(|e| io("the data folder", e))?;
    let target = db::path_in(data);
    let partial = data.join(format!("{}.partial", db::FILE_NAME));
    let _ = std::fs::remove_file(&partial);
    {
        // SQLite's backup: a consistent copy even if another copy of the
        // app has the database open and is writing to it.
        let from = Connection::open(&source)?;
        let mut to = Connection::open(&partial)?;
        Backup::new(&from, &mut to)?.run_to_completion(4096, Duration::ZERO, None)?;
    }
    let subs: Vec<String> = {
        let conn = Connection::open(&partial)?;
        let mut stmt = conn.prepare("SELECT google_sub FROM accounts")?;
        let rows = stmt.query_map([], |r| r.get(0))?;
        rows.collect::<rusqlite::Result<_>>()?
    };
    for sub in subs {
        let key = tokens::refresh_token_key(&sub);
        let copied = match old_keys.get(&key) {
            Ok(Some(token)) => new_keys.set(&key, &token).is_ok(),
            _ => false,
        };
        if copied {
            outcome.sign_ins += 1;
        } else {
            outcome.sign_ins_missed += 1;
        }
    }
    std::fs::rename(&partial, &target).map_err(|e| io("the database", e))?;
    Ok(outcome)
}

/// Whether a file at the top of a copied folder is left behind: the
/// database (copied on its own), the AI apps' socket, and WebKit's
/// network cache (macOS's cache folder; it refills itself).
fn left_behind(name: &str) -> bool {
    let database = [
        db::FILE_NAME.to_string(),
        format!("{}.sqlite3", brand::PREVIOUS_SHORT_NAME),
    ];
    database.iter().any(|d| name.starts_with(d.as_str())) || name == "mcp.sock" || name == "WebKit"
}

/// Copies `from` into `to`, file by file, skipping files already there.
/// A file that can't be copied is counted and skipped.
fn copy_folder(from: &Path, to: &Path, top: bool, outcome: &mut Outcome) {
    let Ok(entries) = std::fs::read_dir(from) else {
        return;
    };
    if std::fs::create_dir_all(to).is_err() {
        outcome.files_missed += 1;
        return;
    }
    for entry in entries.flatten() {
        let name = entry.file_name();
        if top && left_behind(&name.to_string_lossy()) {
            continue;
        }
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        let dest = to.join(&name);
        if kind.is_dir() {
            copy_folder(&entry.path(), &dest, false, outcome);
        } else if kind.is_file() && !dest.exists() {
            match std::fs::copy(entry.path(), &dest) {
                Ok(_) => outcome.files += 1,
                Err(_) => outcome.files_missed += 1,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::MemoryStore;
    use crate::db::{accounts, Db};

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("carry-over-{name}-{}", fastrand::u64(..)));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn add_account(db: &Db, sub: &str, email: &str) {
        accounts::upsert(
            &db.conn(),
            &accounts::NewAccount {
                google_sub: sub,
                email,
                display_name: None,
                avatar_url: None,
                oauth_client: "default",
            },
        )
        .unwrap();
    }

    #[test]
    fn swaps_the_id_only_where_it_is_a_whole_folder_name() {
        let id = "com.example.new";
        let previous = "com.example.old";
        assert_eq!(
            former_with(
                Path::new("/Users/a/Library/Caches/com.example.new"),
                id,
                previous
            ),
            Some(PathBuf::from("/Users/a/Library/Caches/com.example.old"))
        );
        assert_eq!(
            former_with(Path::new("/local/com.example.new/logs"), id, previous),
            Some(PathBuf::from("/local/com.example.old/logs"))
        );
        assert_eq!(
            former_with(Path::new("/data/com.example.new.demo"), id, previous),
            None
        );
    }

    #[test]
    fn copies_the_database_folders_and_sign_ins_once() {
        let root = temp("all");
        let (old_data, new_data) = (root.join("old"), root.join("new"));
        let (old_cache, new_cache) = (root.join("old-cache"), root.join("new-cache"));
        {
            let old_db = old_data.join(format!("{}.sqlite3", brand::PREVIOUS_SHORT_NAME));
            let db = Db::open(&old_db).unwrap();
            add_account(&db, "sub-1", "a@example.com");
            add_account(&db, "sub-2", "b@example.com");
            // Left open, as by a copy of the app that's still running.
            std::fs::write(old_data.join("google-oauth-client.json"), "{}").unwrap();
            std::fs::write(old_data.join("mcp.sock"), "").unwrap();
            std::fs::create_dir_all(old_cache.join("images/ab")).unwrap();
            std::fs::write(old_cache.join("images/ab/1.png"), "png").unwrap();
            std::fs::create_dir_all(old_cache.join("WebKit")).unwrap();
            std::fs::write(old_cache.join("WebKit/blob"), "x").unwrap();
            let old_keys = MemoryStore::default();
            old_keys
                .set(&tokens::refresh_token_key("sub-1"), "token-1")
                .unwrap();
            let new_keys = MemoryStore::default();

            assert!(needed(&old_data, &new_data));
            let outcome = run(
                &old_data,
                &new_data,
                &[
                    (old_data.clone(), new_data.clone()),
                    (old_cache.clone(), new_cache.clone()),
                ],
                &old_keys,
                &new_keys,
            )
            .unwrap();
            drop(db);

            assert_eq!(
                outcome,
                Outcome {
                    files: 2,
                    files_missed: 0,
                    sign_ins: 1,
                    sign_ins_missed: 1
                }
            );
            assert_eq!(
                new_keys
                    .get(&tokens::refresh_token_key("sub-1"))
                    .unwrap()
                    .as_deref(),
                Some("token-1")
            );
            assert!(new_data.join("google-oauth-client.json").exists());
            assert!(new_cache.join("images/ab/1.png").exists());
            assert!(!new_data.join("mcp.sock").exists(), "the socket stays");
            assert!(!new_cache.join("WebKit").exists(), "WebKit's cache stays");
            assert!(!new_data.join(format!("{}.partial", db::FILE_NAME)).exists());
            assert!(
                old_data.join("google-oauth-client.json").exists(),
                "copied, not moved"
            );
        }
        let db = Db::open(&db::path_in(&new_data)).unwrap();
        assert_eq!(accounts::list(&db.conn()).unwrap().len(), 2);
        assert!(!needed(&old_data, &new_data), "only once");
        drop(db);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn nothing_to_do_without_a_previous_database() {
        let root = temp("none");
        assert!(!needed(&root.join("old"), &root.join("new")));
        std::fs::remove_dir_all(&root).unwrap();
    }
}
