//! The encrypted mail cache: its key, kept in the OS keychain; opening it;
//! moving a plain database (from before encryption) into an encrypted one,
//! once; and starting a new cache when the key is gone.
//!
//! Every copy of the app holds a shared lock on `mail.lock` in the data
//! folder while it runs, so several copies (a development build beside the
//! installed app) still work on one cache. Moving the plain database, or
//! setting an unreadable one aside, takes the exclusive lock first: with
//! another copy open, that waits for a later start. Every change to the
//! keychain or the files is made with the exclusive lock held, after
//! reading both again under it. A file lock covers
//! every copy on the computer, other Windows login sessions included,
//! which the app's single-instance check doesn't. An older version of the
//! app doesn't take the lock; started in the moment between the check and
//! the rename, it isn't kept out (owner, 2026-11-26: accepted, said in the
//! release notes).

use std::fs::{File, OpenOptions};
use std::io::Read;
use std::path::{Path, PathBuf};

use aws_lc_rs::rand::{SecureRandom, SystemRandom};
use rusqlite::{Connection, ErrorCode};
use zeroize::Zeroizing;

use super::{database_files, require_cipher, Db};
use crate::auth::SecretStore;
use crate::error::{CoreError, Result};
use crate::sealed::FileKey;

/// The keychain entry holding the cache's key, beside the Google tokens
/// (same service name).
pub const KEY_ENTRY: &str = "cache-key";

/// The lock file in the data folder (see the module's comment).
pub const LOCK_FILE: &str = "mail.lock";

/// The copy being made during the move to an encrypted database.
const ENCRYPTING: &str = ".encrypting";

/// A database set aside because its key was lost; deleted once the window's
/// notice about it is dismissed.
const UNREADABLE: &str = ".unreadable";

/// The cache's key: 32 random bytes, used as a raw key (no password
/// stretching, which a random key doesn't need). Wiped from memory when
/// dropped, and never written into an error or the log.
pub struct CacheKey(Zeroizing<[u8; 32]>);

impl CacheKey {
    /// A new key from the system's random source.
    pub fn generate() -> Result<Self> {
        let mut bytes = Zeroizing::new([0u8; 32]);
        SystemRandom::new()
            .fill(&mut bytes[..])
            .map_err(|_| CoreError::Other("couldn't make a key for the mail cache".into()))?;
        Ok(Self(bytes))
    }

    /// The key for the cached files, derived from this one.
    fn file_key(&self) -> Result<FileKey> {
        FileKey::derive(&self.0[..])
    }

    fn hex(&self) -> Zeroizing<String> {
        let mut out = Zeroizing::new(String::with_capacity(64));
        for b in self.0.iter() {
            out.push(char::from(b"0123456789abcdef"[usize::from(b >> 4)]));
            out.push(char::from(b"0123456789abcdef"[usize::from(b & 15)]));
        }
        out
    }

    /// The key as the keychain keeps it (64 hex digits), or `None` for
    /// anything else.
    fn from_hex(text: &str) -> Option<Self> {
        let text = text.trim().as_bytes();
        if text.len() != 64 {
            return None;
        }
        let digit = |c: u8| char::from(c).to_digit(16);
        let mut bytes = Zeroizing::new([0u8; 32]);
        for (i, pair) in text.chunks(2).enumerate() {
            let value = digit(pair[0])? * 16 + digit(pair[1])?;
            bytes[i] = u8::try_from(value).ok()?;
        }
        Some(Self(bytes))
    }
}

/// Sets `key` on a connection, before anything reads the file. SQLite
/// would quote the statement, key included, in an error, so any error is
/// replaced with a fixed message.
pub(crate) fn apply_key(conn: &Connection, key: &CacheKey) -> Result<()> {
    let sql = Zeroizing::new(format!("PRAGMA key = \"x'{}'\";", key.hex().as_str()));
    conn.execute_batch(&sql)
        .map_err(|_| CoreError::Other("couldn't set the mail cache's key".into()))
}

/// Whether an open failed because the key doesn't fit the file (or the
/// file isn't a database at all): SQLite's "file is not a database".
pub fn is_wrong_key(e: &CoreError) -> bool {
    matches!(e, CoreError::Db(rusqlite::Error::SqliteFailure(f, _)) if f.code == ErrorCode::NotADatabase)
}

/// What's at the database's path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileState {
    /// No file, or an empty one.
    Missing,
    /// A plain SQLite database (it starts with SQLite's header).
    Plain,
    /// Anything else: an encrypted database has no readable header.
    Encrypted,
}

pub fn file_state(path: &Path) -> Result<FileState> {
    let mut file = match File::open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(FileState::Missing),
        Err(e) => return Err(CoreError::Other(format!("read the mail cache: {e}"))),
    };
    let mut head = [0u8; 16];
    let mut read = 0;
    while read < head.len() {
        match file.read(&mut head[read..]) {
            Ok(0) => break,
            Ok(n) => read += n,
            Err(e) => return Err(CoreError::Other(format!("read the mail cache: {e}"))),
        }
    }
    Ok(match read {
        0 => FileState::Missing,
        _ if head[..read] == b"SQLite format 3\0"[..read] && read == head.len() => FileState::Plain,
        _ => FileState::Encrypted,
    })
}

/// The lock every running copy holds, shared (see the module's comment).
/// Dropping it releases it.
pub struct CacheLock {
    file: File,
}

impl CacheLock {
    fn open(dir: &Path) -> Result<Self> {
        let path = dir.join(LOCK_FILE);
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(&path)
            .map_err(|e| CoreError::Other(format!("open the cache's lock file: {e}")))?;
        let _ = crate::owner_only::file(&path);
        Ok(Self { file })
    }

    /// The exclusive lock, if no other copy holds the lock in any way:
    /// `false` when one does. Any other failure is an error, not a busy lock.
    fn try_exclusive(&self) -> Result<bool> {
        match self.file.try_lock() {
            Ok(()) => Ok(true),
            Err(std::fs::TryLockError::WouldBlock) => Ok(false),
            Err(std::fs::TryLockError::Error(e)) => {
                Err(CoreError::Other(format!("lock the mail cache: {e}")))
            }
        }
    }

    /// The shared lock, waiting while another copy holds it exclusively
    /// (changing the cache, a few seconds).
    fn shared(&self) -> Result<()> {
        self.file
            .lock_shared()
            .map_err(|e| CoreError::Other(format!("lock the mail cache: {e}")))
    }

    fn unlock(&self) {
        let _ = self.file.unlock();
    }
}

/// The open cache, and the lock to keep for as long as it's open.
pub struct OpenedCache {
    pub db: Db,
    pub lock: CacheLock,
    /// A new cache was started because the key was gone or didn't fit: the
    /// app says so once.
    pub reset: bool,
    /// The plain database couldn't be moved yet (another copy had it open):
    /// it's open as it was, and the move is tried at the next start.
    pub still_plain: bool,
    /// The key the cached files are encrypted with (`crate::sealed`),
    /// derived from the cache's. `None` only when the database stayed plain
    /// and the keychain has no key yet: files aren't kept this run.
    pub files: Option<FileKey>,
}

/// Why the cache didn't open.
#[derive(Debug)]
pub enum CacheError {
    /// The keychain didn't answer (locked, access denied, no keyring on a
    /// Linux desktop). Nothing on disk was changed; the app asks to unlock
    /// the keychain and try again.
    Keychain(String),
    /// Another copy of the app is open, and the cache needs the exclusive
    /// lock to be set aside or made; nothing on disk was changed.
    InUse,
    Other(CoreError),
}

impl From<CoreError> for CacheError {
    fn from(e: CoreError) -> Self {
        Self::Other(e)
    }
}

impl std::fmt::Display for CacheError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Keychain(e) => write!(
                f,
                "couldn't read the mail cache's key from the keychain: {e}"
            ),
            Self::InUse => write!(f, "another copy of the app has the mail cache open"),
            Self::Other(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for CacheError {}

fn read_key(secrets: &dyn SecretStore) -> std::result::Result<Option<CacheKey>, CacheError> {
    // A value that isn't a key counts as a missing key.
    let text = secrets
        .get(KEY_ENTRY)
        .map_err(|e| CacheError::Keychain(e.to_string()))?
        .map(Zeroizing::new);
    Ok(text.and_then(|t| CacheKey::from_hex(&t)))
}

/// A new key, kept in the keychain and read back before anything is
/// encrypted with it or moved for it: a key the keychain didn't keep would
/// lose the cache.
fn new_key(secrets: &dyn SecretStore) -> std::result::Result<CacheKey, CacheError> {
    let key = CacheKey::generate()?;
    secrets
        .set(KEY_ENTRY, &key.hex())
        .map_err(|e| CacheError::Keychain(e.to_string()))?;
    match read_key(secrets)? {
        Some(kept) if *kept.0 == *key.0 => Ok(key),
        _ => Err(CacheError::Keychain(
            "the key read back from the keychain isn't the one saved".into(),
        )),
    }
}

fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(suffix);
    PathBuf::from(name)
}

fn remove_all(files: &[PathBuf]) -> Result<()> {
    for file in files {
        match std::fs::remove_file(file) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(CoreError::Other(format!("remove {}: {e}", file.display()))),
        }
    }
    Ok(())
}

/// Opens the mail cache at `path`, encrypted with the key in `secrets`:
/// makes the key and a new cache when there's neither; moves a plain
/// database into an encrypted one, once; and sets an encrypted database
/// aside and starts a new cache when its key is gone or doesn't fit.
///
/// Every change to the keychain or the files happens with the exclusive
/// lock held, after reading both again under it, so what another copy did
/// while this one waited is seen before anything is decided. When the
/// keychain doesn't answer, nothing on disk is touched.
pub fn open_cache(
    path: &Path,
    secrets: &dyn SecretStore,
) -> std::result::Result<OpenedCache, CacheError> {
    require_cipher()?;
    let dir = path
        .parent()
        .ok_or_else(|| CoreError::Other("the mail cache has no folder".into()))?;
    std::fs::create_dir_all(dir).map_err(|e| CoreError::Other(format!("create data dir: {e}")))?;
    let _ = crate::owner_only::dir(dir);
    let lock = CacheLock::open(dir)?;

    // The usual start, under the shared lock: an encrypted cache that its
    // key opens.
    lock.shared()?;
    let usual = (|| -> std::result::Result<Option<(Db, CacheKey)>, CacheError> {
        let key = read_key(secrets)?;
        if let (FileState::Encrypted, Some(key)) = (file_state(path)?, key) {
            match Db::open_at(path, Some(&key)) {
                Ok(db) => return Ok(Some((db, key))),
                Err(e) if is_wrong_key(&e) => {}
                Err(e) => return Err(e.into()),
            }
        }
        Ok(None)
    })();
    match usual {
        Ok(Some((db, key))) => {
            return Ok(OpenedCache {
                db,
                lock,
                reset: reset_pending(path),
                still_plain: false,
                files: Some(key.file_key()?),
            });
        }
        Ok(None) => {}
        Err(e) => {
            lock.unlock();
            return Err(e);
        }
    }

    // Anything else changes the keychain or the files.
    lock.unlock();
    if !lock.try_exclusive()? {
        // Another copy holds the lock. If it is changing the cache, the
        // shared lock waits until it is done; then look again.
        lock.shared()?;
        let opened = (|| -> std::result::Result<(Db, bool, Option<CacheKey>), CacheError> {
            let key = read_key(secrets)?;
            match (file_state(path)?, key) {
                (FileState::Encrypted, Some(key)) => match Db::open_at(path, Some(&key)) {
                    Ok(db) => Ok((db, false, Some(key))),
                    Err(e) if is_wrong_key(&e) => Err(CacheError::InUse),
                    Err(e) => Err(e.into()),
                },
                // The move waits for a start with no other copy.
                (FileState::Plain, key) => Ok((Db::open_at(path, None)?, true, key)),
                _ => Err(CacheError::InUse),
            }
        })()
        .and_then(|(db, still_plain, key)| {
            let files = key.map(|k| k.file_key()).transpose()?;
            Ok((db, still_plain, files))
        });
        return match opened {
            Ok((db, still_plain, files)) => Ok(OpenedCache {
                db,
                lock,
                reset: reset_pending(path),
                still_plain,
                files,
            }),
            Err(e) => {
                lock.unlock();
                Err(e)
            }
        };
    }

    // The exclusive lock: read both again, decide, then share it.
    let decided = (|| -> std::result::Result<(Db, bool, bool, CacheKey), CacheError> {
        let key = read_key(secrets)?;
        let aside = with_suffix(path, UNREADABLE);
        match (file_state(path)?, key) {
            (FileState::Encrypted, Some(key)) => match Db::open_at(path, Some(&key)) {
                Ok(db) => Ok((db, false, false, key)),
                Err(e) if is_wrong_key(&e) => {
                    let (db, key) = reset(path, secrets)?;
                    Ok((db, true, false, key))
                }
                Err(e) => Err(e.into()),
            },
            (FileState::Encrypted, None) => {
                let (db, key) = reset(path, secrets)?;
                Ok((db, true, false, key))
            }
            (FileState::Missing, key) => {
                // A reset that stopped after setting the cache aside: the
                // new cache is made now, and the window says so.
                let interrupted = aside.exists();
                let key = match key {
                    Some(key) => key,
                    None => new_key(secrets)?,
                };
                // A write-ahead log with no database beside it belongs to a
                // database that's gone: removed, so the new one can't read
                // it (it ignores one written without its key anyway).
                remove_all(&database_files(path)[1..])?;
                Ok((Db::open_at(path, Some(&key))?, interrupted, false, key))
            }
            (FileState::Plain, key) => {
                let key = match key {
                    Some(key) => key,
                    None => new_key(secrets)?,
                };
                match encrypt_plain(path, &key)? {
                    Moved::Done => Ok((Db::open_at(path, Some(&key))?, false, false, key)),
                    // A version from before encryption has it open: open it
                    // as it is, and move it at a later start.
                    Moved::Busy => Ok((Db::open_at(path, None)?, false, true, key)),
                }
            }
        }
    })();
    lock.unlock();
    match decided {
        Ok((db, reset, still_plain, key)) => {
            lock.shared()?;
            Ok(OpenedCache {
                db,
                lock,
                reset: reset || reset_pending(path),
                still_plain,
                files: Some(key.file_key()?),
            })
        }
        Err(e) => Err(e),
    }
}

/// Whether a cache set aside by a reset is still there: the window says so
/// until the notice is dismissed (`forget_reset`), so a quit or a crash
/// before the window showed it can't lose it.
fn reset_pending(path: &Path) -> bool {
    with_suffix(path, UNREADABLE).exists()
}

/// Deletes the cache a reset set aside, once its notice was dismissed: the
/// write-ahead files first and the database last, so a stop halfway leaves
/// the database, and the notice, to try again next time.
pub fn forget_reset(path: &Path) -> Result<()> {
    let mut files = database_files(&with_suffix(path, UNREADABLE));
    files.reverse();
    remove_all(&files)
}

/// Starts a new cache in place of one its key can't open, with the
/// exclusive lock held. The new key is saved and read back before anything
/// moves; then the cache is set aside (kept until the notice is dismissed)
/// and a new one made. If making it fails, the old one is put back.
fn reset(
    path: &Path,
    secrets: &dyn SecretStore,
) -> std::result::Result<(Db, CacheKey), CacheError> {
    let key = new_key(secrets)?;
    let aside = with_suffix(path, UNREADABLE);
    // A cache an earlier reset set aside gives way to this one. Write-ahead
    // files with no database there are this cache's own, from a move that
    // stopped halfway: kept, and the move finished.
    if aside.exists() {
        remove_all(&database_files(&aside))?;
    }
    set_aside(path)?;
    match Db::open_at(path, Some(&key)) {
        Ok(db) => Ok((db, key)),
        Err(e) => {
            let _ = remove_all(&database_files(path));
            for (from, to) in database_files(&aside).iter().zip(database_files(path)) {
                let _ = std::fs::rename(from, to);
            }
            Err(e.into())
        }
    }
}

/// Moves the database and its write-ahead files aside, kept until the
/// reset's notice is dismissed. The write-ahead files go first and the
/// database last, so a stop halfway never leaves a database beside a log
/// that isn't its own.
fn set_aside(path: &Path) -> Result<()> {
    let aside = with_suffix(path, UNREADABLE);
    for (from, to) in database_files(path)
        .iter()
        .zip(database_files(&aside))
        .rev()
    {
        match std::fs::rename(from, &to) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(CoreError::Other(format!("set the mail cache aside: {e}"))),
        }
    }
    Ok(())
}

/// A path as an SQLite URI's path: the characters a URI gives a meaning
/// (and spaces) percent-encoded.
fn uri_path(path: &Path) -> String {
    let mut out = String::new();
    for c in path.to_string_lossy().chars() {
        match c {
            '%' => out.push_str("%25"),
            '?' => out.push_str("%3f"),
            '#' => out.push_str("%23"),
            ' ' => out.push_str("%20"),
            c => out.push(c),
        }
    }
    out
}

fn row_counts(conn: &Connection) -> Result<Vec<(String, i64)>> {
    let tables: Vec<String> = conn
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")?
        .query_map([], |r| r.get(0))?
        .collect::<std::result::Result<_, _>>()?;
    let mut counts = Vec::with_capacity(tables.len());
    for table in tables {
        let n: i64 = conn.query_row(
            &format!("SELECT COUNT(*) FROM \"{}\"", table.replace('"', "\"\"")),
            [],
            |r| r.get(0),
        )?;
        counts.push((table, n));
    }
    Ok(counts)
}

/// Moves the plain database at `path` into an encrypted one, once, with
/// the exclusive lock held. Until the rename at the end, the plain database
/// stays valid with all its data (the checkpoint folds its write-ahead log
/// into it); a failure anywhere leaves it to try again at the next start.
/// SQLite3 Multiple Ciphers can't back up a plain database into an
/// encrypted one, nor encrypt one in place in WAL mode, so the copy is made
/// with `VACUUM INTO` a file named by a URI that carries the cipher and the
/// key.
pub(crate) fn encrypt_plain(path: &Path, key: &CacheKey) -> Result<Moved> {
    encrypt_plain_until(path, key, Stop::Never)
}

/// Where a test can stop the move, to check what's left.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Stop {
    Never,
    AfterCopy,
    AfterCheck,
}

/// What a move did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Moved {
    Done,
    /// Something else had the plain database open (a version from before
    /// encryption, which doesn't take the cache's lock): nothing changed.
    Busy,
}

pub(crate) fn encrypt_plain_until(path: &Path, key: &CacheKey, stop: Stop) -> Result<Moved> {
    let copy = with_suffix(path, ENCRYPTING);
    let copy_files = database_files(&copy);
    remove_all(&copy_files)?;
    let plain = Connection::open(path)?;
    // No other connection, from any copy or version: an exclusive lock,
    // without waiting, kept until the copy is checked.
    // Only SQLite's busy and locked mean another connection; any other
    // failure (a file that isn't a database) is an error.
    match plain.execute_batch(
        "PRAGMA busy_timeout = 0; PRAGMA locking_mode = EXCLUSIVE; BEGIN EXCLUSIVE; COMMIT;",
    ) {
        Ok(()) => {}
        Err(rusqlite::Error::SqliteFailure(f, _))
            if matches!(f.code, ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked) =>
        {
            return Ok(Moved::Busy);
        }
        Err(e) => return Err(e.into()),
    }
    plain.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()))?;
    let before = row_counts(&plain)?;

    // The copy is this user's only before anything is written to it;
    // `VACUUM INTO` accepts an empty file.
    File::create(&copy).map_err(|e| CoreError::Other(format!("create the encrypted copy: {e}")))?;
    let _ = crate::owner_only::file(&copy);
    let uri = Zeroizing::new(format!(
        "file:{}?cipher=chacha20&key=raw:{}",
        uri_path(&copy),
        key.hex().as_str()
    ));
    plain
        .execute("VACUUM INTO ?1", [uri.as_str()])
        .map_err(|_| {
            CoreError::Other("couldn't copy the mail cache into an encrypted one".into())
        })?;
    if stop == Stop::AfterCopy {
        return Err(CoreError::Other("stopped after the copy (test)".into()));
    }

    {
        let encrypted = Connection::open(&copy)?;
        apply_key(&encrypted, key)?;
        let ok: String = encrypted.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
        if ok != "ok" || row_counts(&encrypted)? != before {
            return Err(CoreError::Other(
                "the encrypted copy of the mail cache didn't match the original".into(),
            ));
        }
        encrypted.execute_batch("PRAGMA journal_mode = WAL;")?;
    }
    // Flushing needs the file opened for writing on Windows.
    OpenOptions::new()
        .write(true)
        .open(&copy)
        .and_then(|f| f.sync_all())
        .map_err(|e| CoreError::Other(format!("save the encrypted copy: {e}")))?;
    if stop == Stop::AfterCheck {
        return Err(CoreError::Other("stopped after the check (test)".into()));
    }

    // Windows can't rename over a file that's open.
    drop(plain);
    remove_all(&database_files(path)[1..])?;
    std::fs::rename(&copy, path)
        .map_err(|e| CoreError::Other(format!("put the encrypted copy in place: {e}")))?;
    remove_all(&copy_files[1..])?;
    Ok(Moved::Done)
}

/// The Google IDs (`sub`) of the accounts a previous run's cache at `path`
/// holds, read without changing anything (a clean start uses them to forget
/// their keychain entries before it deletes the folder). Plain or
/// encrypted; read-only. A cache whose key is gone or doesn't fit gives
/// none, as nothing can read it; a keychain that doesn't answer is an
/// error, so the caller can keep the folder until it does.
pub fn previous_accounts(
    path: &Path,
    secrets: &dyn SecretStore,
) -> std::result::Result<Vec<String>, CacheError> {
    let state = file_state(path)?;
    let key = match state {
        FileState::Missing => return Ok(Vec::new()),
        FileState::Plain => None,
        FileState::Encrypted => match read_key(secrets)? {
            Some(key) => Some(key),
            None => return Ok(Vec::new()),
        },
    };
    require_cipher()?;
    let read = || -> Result<Vec<String>> {
        use rusqlite::OpenFlags;
        let flags = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX;
        // With no write-ahead log left (a run that quit normally),
        // `immutable` reads the file with no locks and no side files. A log
        // left by a crash still holds data, so then it's read as usual,
        // which makes SQLite's shared-memory file.
        let conn = if database_files(path)[1].exists() {
            Connection::open_with_flags(path, flags)?
        } else {
            Connection::open_with_flags(
                format!("file:{}?immutable=1", uri_path(path)),
                flags | OpenFlags::SQLITE_OPEN_URI,
            )?
        };
        if let Some(key) = &key {
            apply_key(&conn, key)?;
        }
        let subs = conn
            .prepare("SELECT google_sub FROM accounts")?
            .query_map([], |r| r.get(0))?
            .collect::<std::result::Result<_, _>>()?;
        Ok(subs)
    };
    match read() {
        Ok(subs) => Ok(subs),
        Err(e) if is_wrong_key(&e) => Ok(Vec::new()),
        Err(e) => Err(e.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::MemoryStore;
    use crate::db::accounts;
    use std::sync::Arc;

    const MARKER: &str = "zorbleflux";

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("cache {tag}-{}", fastrand::u64(..)));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Made-up mail: an account and a setting holding the marker.
    fn fill(db: &Db) {
        accounts::upsert(
            &db.conn(),
            &accounts::NewAccount {
                google_sub: "sub-maya",
                email: "maya@x.example",
                display_name: Some("Maya Chen"),
                avatar_url: None,
                oauth_client: "default",
            },
        )
        .unwrap();
        db.conn()
            .execute(
                "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('test', ?1)",
                [MARKER],
            )
            .unwrap();
    }

    fn marker(db: &Db) -> String {
        db.conn()
            .query_row(
                "SELECT value FROM app_settings WHERE key = 'test'",
                [],
                |r| r.get(0),
            )
            .unwrap()
    }

    /// Whether `needle` is anywhere in the database's files as plain bytes.
    fn plain_anywhere(path: &Path, needle: &str) -> bool {
        database_files(path).iter().any(|f| {
            std::fs::read(f)
                .map(|b| b.windows(needle.len()).any(|w| w == needle.as_bytes()))
                .unwrap_or(false)
        })
    }

    /// Every file in `dir`, with its bytes.
    fn snapshot(dir: &Path) -> Vec<(String, Vec<u8>)> {
        let mut files: Vec<_> = std::fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap())
            .filter(|e| e.file_name() != LOCK_FILE)
            .map(|e| {
                (
                    e.file_name().to_string_lossy().into_owned(),
                    std::fs::read(e.path()).unwrap(),
                )
            })
            .collect();
        files.sort();
        files
    }

    /// A keychain that doesn't answer.
    struct Unreachable;
    impl SecretStore for Unreachable {
        fn get(&self, _: &str) -> Result<Option<String>> {
            Err(CoreError::Keychain("locked".into()))
        }
        fn set(&self, _: &str, _: &str) -> Result<()> {
            Err(CoreError::Keychain("locked".into()))
        }
        fn delete(&self, _: &str) -> Result<()> {
            Err(CoreError::Keychain("locked".into()))
        }
    }

    /// A keychain that answers reads but refuses writes (locked after a
    /// read that needed no unlocking).
    struct ReadOnlyKeychain(MemoryStore);
    impl SecretStore for ReadOnlyKeychain {
        fn get(&self, key: &str) -> Result<Option<String>> {
            self.0.get(key)
        }
        fn set(&self, _: &str, _: &str) -> Result<()> {
            Err(CoreError::Keychain("locked".into()))
        }
        fn delete(&self, _: &str) -> Result<()> {
            Err(CoreError::Keychain("locked".into()))
        }
    }

    /// Another copy's lock, held by the test.
    fn other_copy(dir: &Path) -> CacheLock {
        CacheLock::open(dir).unwrap()
    }

    #[test]
    fn a_new_cache_is_encrypted_with_a_key_kept_in_the_keychain() {
        let dir = temp_dir("new");
        let path = super::super::path_in(&dir);
        let secrets = MemoryStore::default();
        let opened = open_cache(&path, &secrets).unwrap();
        assert!(!opened.reset && !opened.still_plain);
        fill(&opened.db);
        assert!(
            !plain_anywhere(&path, MARKER),
            "nothing readable, write-ahead log included"
        );
        drop(opened);
        assert_eq!(file_state(&path).unwrap(), FileState::Encrypted);
        assert_eq!(secrets.get(KEY_ENTRY).unwrap().unwrap().len(), 64);
        let opened = open_cache(&path, &secrets).unwrap();
        assert_eq!(marker(&opened.db), MARKER);
        drop(opened);
        assert!(Db::open(&path).is_err(), "refused without the key");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_plain_cache_is_moved_into_an_encrypted_one_and_nothing_plain_is_left() {
        let dir = temp_dir("plain");
        let path = super::super::path_in(&dir);
        fill(&Db::open(&path).unwrap());
        assert_eq!(file_state(&path).unwrap(), FileState::Plain);
        let secrets = MemoryStore::default();
        let opened = open_cache(&path, &secrets).unwrap();
        assert!(!opened.reset && !opened.still_plain);
        assert_eq!(marker(&opened.db), MARKER, "the data came across");
        drop(opened);
        assert_eq!(file_state(&path).unwrap(), FileState::Encrypted);
        assert!(!plain_anywhere(&path, MARKER));
        let names: Vec<String> = snapshot(&dir).into_iter().map(|(n, _)| n).collect();
        assert!(!names.iter().any(|n| n.contains(ENCRYPTING)), "{names:?}");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_move_stopped_halfway_leaves_the_plain_cache_and_the_next_start_finishes() {
        for stop in [Stop::AfterCopy, Stop::AfterCheck] {
            let dir = temp_dir("halfway");
            let path = super::super::path_in(&dir);
            fill(&Db::open(&path).unwrap());
            let key = CacheKey::generate().unwrap();
            assert!(encrypt_plain_until(&path, &key, stop).is_err());
            assert_eq!(file_state(&path).unwrap(), FileState::Plain, "{stop:?}");
            assert_eq!(marker(&Db::open(&path).unwrap()), MARKER);
            let opened = open_cache(&path, &MemoryStore::default()).unwrap();
            assert_eq!(marker(&opened.db), MARKER);
            drop(opened);
            assert_eq!(file_state(&path).unwrap(), FileState::Encrypted);
            let _ = std::fs::remove_dir_all(dir);
        }
    }

    #[test]
    fn a_lost_key_sets_the_cache_aside_and_starts_a_new_one() {
        let dir = temp_dir("lost");
        let path = super::super::path_in(&dir);
        let secrets = MemoryStore::default();
        fill(&open_cache(&path, &secrets).unwrap().db);
        secrets.delete(KEY_ENTRY).unwrap();
        let opened = open_cache(&path, &secrets).unwrap();
        assert!(opened.reset);
        let accounts: i64 = opened
            .db
            .conn()
            .query_row("SELECT COUNT(*) FROM accounts", [], |r| r.get(0))
            .unwrap();
        assert_eq!(accounts, 0, "a new, empty cache");
        drop(opened);
        assert!(with_suffix(&path, UNREADABLE).exists(), "set aside");
        // Review: still said at the next start, as the window may not have
        // shown it (a quit or a crash first), until it is dismissed.
        let opened = open_cache(&path, &secrets).unwrap();
        assert!(opened.reset);
        drop(opened);
        forget_reset(&path).unwrap();
        assert!(
            !with_suffix(&path, UNREADABLE).exists(),
            "deleted once dismissed"
        );
        assert!(!open_cache(&path, &secrets).unwrap().reset);
        let _ = std::fs::remove_dir_all(dir);
    }

    /// Review: a write-ahead log with no database beside it (from a cache
    /// that's gone) never reaches a new cache. The new, encrypted database
    /// ignores such a log anyway; it's also removed first, so nothing
    /// depends on that.
    #[test]
    fn a_log_without_its_database_is_removed_before_a_new_one() {
        let dir = temp_dir("stray log");
        let path = super::super::path_in(&dir);
        // A real log, from another (plain) database with made-up mail,
        // copied while that database was open so the log still holds it.
        let other = dir.join("other.sqlite3");
        let db = Db::open(&other).unwrap();
        db.conn()
            .execute_batch("PRAGMA wal_autocheckpoint = 0;")
            .unwrap();
        fill(&db);
        std::fs::copy(&database_files(&other)[1], &database_files(&path)[1]).unwrap();
        drop(db);
        let secrets = MemoryStore::default();
        let opened = open_cache(&path, &secrets).unwrap();
        let accounts: i64 = opened
            .db
            .conn()
            .query_row("SELECT COUNT(*) FROM accounts", [], |r| r.get(0))
            .unwrap();
        assert_eq!(accounts, 0, "nothing from the other database's log");
        fill(&opened.db);
        drop(opened);
        assert_eq!(marker(&open_cache(&path, &secrets).unwrap().db), MARKER);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_key_that_doesnt_fit_is_treated_as_lost() {
        let dir = temp_dir("wrong");
        let path = super::super::path_in(&dir);
        let secrets = MemoryStore::default();
        fill(&open_cache(&path, &secrets).unwrap().db);
        secrets
            .set(KEY_ENTRY, &CacheKey::generate().unwrap().hex())
            .unwrap();
        assert!(open_cache(&path, &secrets).unwrap().reset);
        let _ = std::fs::remove_dir_all(dir);
    }

    /// Review: a reset whose new key the keychain won't save must not have
    /// moved the cache.
    #[test]
    fn a_reset_saves_the_new_key_before_moving_anything() {
        let dir = temp_dir("reset order");
        let path = super::super::path_in(&dir);
        let store = MemoryStore::default();
        fill(&open_cache(&path, &store).unwrap().db);
        store.delete(KEY_ENTRY).unwrap();
        let before = snapshot(&dir);
        let err = open_cache(&path, &ReadOnlyKeychain(store)).err().unwrap();
        assert!(matches!(err, CacheError::Keychain(_)), "{err}");
        assert_eq!(snapshot(&dir), before, "nothing moved");
        let _ = std::fs::remove_dir_all(dir);
    }

    /// Review: a reset that stopped after setting the cache aside makes the
    /// new cache at the next start, and still says so.
    #[test]
    fn a_reset_interrupted_after_the_move_is_finished_and_still_reported() {
        let dir = temp_dir("interrupted");
        let path = super::super::path_in(&dir);
        let secrets = MemoryStore::default();
        fill(&open_cache(&path, &secrets).unwrap().db);
        // As `reset` leaves it when it stops after the move.
        let _ = new_key(&secrets).unwrap();
        set_aside(&path).unwrap();
        let opened = open_cache(&path, &secrets).unwrap();
        assert!(opened.reset);
        drop(opened);
        forget_reset(&path).unwrap();
        assert!(!open_cache(&path, &secrets).unwrap().reset);
        let _ = std::fs::remove_dir_all(dir);
    }

    /// Review: a reset that stopped after moving the write-ahead log but
    /// not the database keeps that log when the next start finishes the
    /// move, so what it holds can still be read with the old key.
    #[test]
    fn a_reset_interrupted_halfway_keeps_the_moved_log() {
        let dir = temp_dir("halfway");
        let path = super::super::path_in(&dir);
        let secrets = MemoryStore::default();
        let old_key = {
            let opened = open_cache(&path, &secrets).unwrap();
            opened
                .db
                .conn()
                .execute_batch("PRAGMA wal_autocheckpoint = 0;")
                .unwrap();
            fill(&opened.db);
            // The files as a crash leaves them: the write only in the log.
            let crashed = dir.join("crashed");
            std::fs::create_dir_all(&crashed).unwrap();
            for f in &database_files(&path)[..2] {
                std::fs::copy(f, crashed.join(f.file_name().unwrap())).unwrap();
            }
            drop(opened);
            remove_all(&database_files(&path)).unwrap();
            for f in &database_files(&path)[..2] {
                std::fs::copy(crashed.join(f.file_name().unwrap()), f).unwrap();
            }
            read_key(&secrets).unwrap().unwrap()
        };
        // As `reset` leaves it when it stops after moving the log.
        let _ = new_key(&secrets).unwrap();
        let aside = with_suffix(&path, UNREADABLE);
        std::fs::rename(&database_files(&path)[1], &database_files(&aside)[1]).unwrap();
        let opened = open_cache(&path, &secrets).unwrap();
        assert!(opened.reset);
        drop(opened);
        assert!(database_files(&aside)[1].exists(), "the log was kept");
        let kept = Db::open_at(&aside, Some(&old_key)).unwrap();
        assert_eq!(marker(&kept), MARKER);
        drop(kept);
        let _ = std::fs::remove_dir_all(dir);
    }

    /// The cached files' key comes from the cache's: the same at every
    /// start, and a new one after a reset, so files from before don't open.
    #[test]
    fn the_files_key_follows_the_cache_key() {
        let dir = temp_dir("files key");
        let path = super::super::path_in(&dir);
        let secrets = MemoryStore::default();
        let folder = crate::sealed::Sealed::new(
            dir.join("files"),
            open_cache(&path, &secrets).unwrap().files.map(Arc::new),
        );
        let file = dir.join("files").join("1");
        assert!(folder.write(&file, "attachment/1/1", b"made-up").unwrap());
        let again = crate::sealed::Sealed::new(
            dir.join("files"),
            open_cache(&path, &secrets).unwrap().files.map(Arc::new),
        );
        assert_eq!(again.read(&file, "attachment/1/1").unwrap(), b"made-up");
        secrets.delete(KEY_ENTRY).unwrap();
        let after_reset = crate::sealed::Sealed::new(
            dir.join("files"),
            open_cache(&path, &secrets).unwrap().files.map(Arc::new),
        );
        assert!(after_reset.read(&file, "attachment/1/1").is_none());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_keychain_that_doesnt_answer_leaves_every_file_alone() {
        for plain in [true, false] {
            let dir = temp_dir("locked");
            let path = super::super::path_in(&dir);
            if plain {
                fill(&Db::open(&path).unwrap());
            } else {
                fill(&open_cache(&path, &MemoryStore::default()).unwrap().db);
            }
            let before = snapshot(&dir);
            let err = open_cache(&path, &Unreachable).err().unwrap();
            assert!(matches!(err, CacheError::Keychain(_)), "{err}");
            assert_eq!(snapshot(&dir), before, "plain: {plain}");
            let _ = std::fs::remove_dir_all(dir);
        }
    }

    #[test]
    fn with_another_copy_open_the_plain_cache_waits_for_a_later_start() {
        let dir = temp_dir("two copies");
        let path = super::super::path_in(&dir);
        fill(&Db::open(&path).unwrap());
        let other = other_copy(&dir);
        other.shared().unwrap();
        let secrets = MemoryStore::default();
        let opened = open_cache(&path, &secrets).unwrap();
        assert!(opened.still_plain);
        assert_eq!(marker(&opened.db), MARKER);
        drop(opened);
        drop(other);
        assert_eq!(file_state(&path).unwrap(), FileState::Plain);
        let opened = open_cache(&path, &secrets).unwrap();
        assert!(!opened.still_plain);
        drop(opened);
        assert_eq!(file_state(&path).unwrap(), FileState::Encrypted);
        let _ = std::fs::remove_dir_all(dir);
    }

    /// The owner's choice: a version from before encryption with the cache
    /// open, which doesn't take the lock, leaves it plain until a later start.
    #[test]
    fn an_old_copy_with_the_cache_open_leaves_it_plain_until_a_later_start() {
        let dir = temp_dir("old copy");
        let path = super::super::path_in(&dir);
        let old = Db::open(&path).unwrap();
        fill(&old);
        let secrets = MemoryStore::default();
        let opened = open_cache(&path, &secrets).unwrap();
        assert!(opened.still_plain);
        drop(opened);
        assert_eq!(marker(&old), MARKER);
        drop(old);
        assert_eq!(file_state(&path).unwrap(), FileState::Plain);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_cache_to_set_aside_while_another_copy_is_open_is_left_alone() {
        let dir = temp_dir("in use");
        let path = super::super::path_in(&dir);
        let secrets = MemoryStore::default();
        fill(&open_cache(&path, &secrets).unwrap().db);
        secrets.delete(KEY_ENTRY).unwrap();
        let other = other_copy(&dir);
        other.shared().unwrap();
        let before = snapshot(&dir);
        assert!(matches!(
            open_cache(&path, &secrets).err(),
            Some(CacheError::InUse)
        ));
        assert_eq!(snapshot(&dir), before);
        let _ = std::fs::remove_dir_all(dir);
    }

    /// Review: two first starts. The second waits while the first, holding
    /// the exclusive lock, makes the key and the cache; then it reads them
    /// again and opens the cache with that key, keeping it.
    #[test]
    fn a_start_that_waits_uses_what_the_other_copy_made() {
        let dir = temp_dir("first starts");
        let path = super::super::path_in(&dir);
        let secrets = Arc::new(MemoryStore::default());
        let first = other_copy(&dir);
        assert!(first.try_exclusive().unwrap());
        let second = {
            let (path, secrets) = (path.clone(), secrets.clone());
            std::thread::spawn(move || open_cache(&path, secrets.as_ref()).map(|o| o.reset))
        };
        std::thread::sleep(std::time::Duration::from_millis(200));
        // The first copy makes the key and the cache, then lets go.
        let key = new_key(secrets.as_ref()).unwrap();
        fill(&Db::open_at(&path, Some(&key)).unwrap());
        let kept = secrets.get(KEY_ENTRY).unwrap();
        first.unlock();
        assert!(!second.join().unwrap().unwrap(), "opened, not reset");
        assert_eq!(
            secrets.get(KEY_ENTRY).unwrap(),
            kept,
            "the key wasn't replaced"
        );
        assert_eq!(
            marker(&open_cache(&path, secrets.as_ref()).unwrap().db),
            MARKER
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    /// Review: a start that found a plain cache waits while another copy
    /// moves it; it then opens the encrypted cache with that copy's key
    /// rather than making a key of its own.
    #[test]
    fn a_start_that_waits_out_a_move_uses_the_moved_cache() {
        let dir = temp_dir("moved meanwhile");
        let path = super::super::path_in(&dir);
        fill(&Db::open(&path).unwrap());
        let secrets = Arc::new(MemoryStore::default());
        let first = other_copy(&dir);
        assert!(first.try_exclusive().unwrap());
        let second = {
            let (path, secrets) = (path.clone(), secrets.clone());
            std::thread::spawn(move || {
                open_cache(&path, secrets.as_ref()).map(|o| (o.reset, o.still_plain))
            })
        };
        std::thread::sleep(std::time::Duration::from_millis(200));
        let key = new_key(secrets.as_ref()).unwrap();
        assert_eq!(encrypt_plain(&path, &key).unwrap(), Moved::Done);
        let kept = secrets.get(KEY_ENTRY).unwrap();
        first.unlock();
        assert_eq!(second.join().unwrap().unwrap(), (false, false));
        assert_eq!(secrets.get(KEY_ENTRY).unwrap(), kept);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn the_key_never_reaches_an_error() {
        let key = CacheKey::generate().unwrap();
        let hex = key.hex().to_string();
        assert_eq!(CacheKey::from_hex(&hex).map(|k| *k.0 == *key.0), Some(true));
        assert!(CacheKey::from_hex("not a key").is_none());
        let dir = temp_dir("errors");
        let path = dir.join("x.sqlite3");
        std::fs::write(&path, b"made-up bytes that are not a database").unwrap();
        let e = Db::open_at(&path, Some(&key)).err().unwrap();
        assert!(is_wrong_key(&e), "{e}");
        assert!(!e.to_string().contains(&hex));
        let e = encrypt_plain(&path, &key).err().unwrap();
        assert!(!e.to_string().contains(&hex));
        let _ = std::fs::remove_dir_all(dir);
    }

    /// Review: reading a previous run's accounts changes nothing on disk.
    #[test]
    fn previous_accounts_reads_without_changing_anything() {
        for encrypted in [false, true] {
            let dir = temp_dir("previous");
            let path = super::super::path_in(&dir);
            let secrets = MemoryStore::default();
            assert!(previous_accounts(&path, &secrets).unwrap().is_empty());
            assert!(!path.exists(), "nothing made");
            if encrypted {
                fill(&open_cache(&path, &secrets).unwrap().db);
            } else {
                fill(&Db::open(&path).unwrap());
            }
            let before = snapshot(&dir);
            assert_eq!(previous_accounts(&path, &secrets).unwrap(), ["sub-maya"]);
            assert_eq!(snapshot(&dir), before, "encrypted: {encrypted}");
            if encrypted {
                // No key: nothing can read it. A keychain that doesn't
                // answer: an error, so the folder is kept.
                assert!(previous_accounts(&path, &MemoryStore::default())
                    .unwrap()
                    .is_empty());
                assert!(matches!(
                    previous_accounts(&path, &Unreachable),
                    Err(CacheError::Keychain(_))
                ));
            }
            let _ = std::fs::remove_dir_all(dir);
        }
    }

    #[test]
    fn file_state_reads_only_the_header() {
        let dir = temp_dir("state");
        let path = dir.join("x");
        assert_eq!(file_state(&path).unwrap(), FileState::Missing);
        std::fs::write(&path, b"").unwrap();
        assert_eq!(file_state(&path).unwrap(), FileState::Missing);
        std::fs::write(&path, b"SQLite format 3\0and more").unwrap();
        assert_eq!(file_state(&path).unwrap(), FileState::Plain);
        std::fs::write(&path, b"SQLite").unwrap();
        assert_eq!(file_state(&path).unwrap(), FileState::Encrypted);
        let _ = std::fs::remove_dir_all(dir);
    }
}
