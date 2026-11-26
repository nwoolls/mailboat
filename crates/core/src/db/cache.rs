//! The encrypted mail cache: its key, kept in the OS keychain; opening it;
//! moving a plain database (from before encryption) into an encrypted one,
//! once; and starting a new cache when the key is gone.
//!
//! Every copy of the app holds a shared lock on `mail.lock` in the data
//! folder while it runs, so several copies (a development build beside the
//! installed app) still work on one cache. Moving the plain database, or
//! setting an unreadable one aside, takes the exclusive lock first: with
//! another copy open, that waits for a later start. A file lock covers
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

/// The keychain entry holding the cache's key, beside the Google tokens
/// (same service name).
pub const KEY_ENTRY: &str = "cache-key";

/// The lock file in the data folder (see the module's comment).
pub const LOCK_FILE: &str = "mail.lock";

/// The copy being made during the move to an encrypted database.
const ENCRYPTING: &str = ".encrypting";

/// A database set aside because its key was lost; deleted at the next start.
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

/// The lock that every running copy holds, shared (see the module's
/// comment). Dropping it releases it.
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

    /// The exclusive lock, if no other copy holds the lock in any way.
    fn try_exclusive(&self) -> bool {
        self.file.try_lock().is_ok()
    }

    /// The shared lock, waiting while another copy holds it exclusively
    /// (moving its database, a few seconds).
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
    /// A new cache was started because the key was gone: the app says so
    /// once.
    pub reset: bool,
    /// The plain database couldn't be moved yet (another copy was open):
    /// it's open as it was, and the move is tried at the next start.
    pub still_plain: bool,
}

/// Why the cache didn't open.
#[derive(Debug)]
pub enum CacheError {
    /// The keychain didn't answer (locked, access denied, no keyring on a
    /// Linux desktop). Nothing on disk was changed; the app asks to unlock
    /// the keychain and try again.
    Keychain(String),
    /// Another copy of the app is open and the cache needs the exclusive
    /// lock to be set aside; nothing on disk was changed.
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
/// encrypted with it: a key the keychain didn't keep would lose the cache.
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
/// When the keychain doesn't answer, nothing on disk is touched.
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
    // The keychain first: if it doesn't answer, nothing below runs.
    let key = read_key(secrets)?;
    let state = file_state(path)?;

    let needs_exclusive =
        state == FileState::Plain || (state == FileState::Encrypted && key.is_none());
    if needs_exclusive && lock.try_exclusive() {
        let opened = (|| -> std::result::Result<OpenedCache, CacheError> {
            remove_all(&database_files(&with_suffix(path, UNREADABLE)))?;
            let (key, reset) = match (state, key) {
                (FileState::Plain, Some(key)) => {
                    encrypt_plain(path, &key)?;
                    (key, false)
                }
                (FileState::Plain, None) => {
                    let key = new_key(secrets)?;
                    encrypt_plain(path, &key)?;
                    (key, false)
                }
                _ => {
                    set_aside(path)?;
                    (new_key(secrets)?, true)
                }
            };
            lock.unlock();
            lock.shared()?;
            let db = Db::open_at(path, Some(&key))?;
            Ok(OpenedCache {
                db,
                lock: CacheLock {
                    file: lock
                        .file
                        .try_clone()
                        .map_err(|e| CoreError::Other(format!("lock the mail cache: {e}")))?,
                },
                reset,
                still_plain: false,
            })
        })();
        if opened.is_err() {
            lock.unlock();
        }
        return opened;
    }

    // Shared: wait out a copy that is moving or setting aside the cache,
    // then look again, as it may have changed both the file and the key.
    lock.shared()?;
    // A cache an earlier start set aside: nothing uses it.
    remove_all(&database_files(&with_suffix(path, UNREADABLE)))?;
    let key = read_key(secrets)?;
    match (file_state(path)?, key) {
        (FileState::Missing, key) => {
            let key = match key {
                Some(key) => key,
                None => new_key(secrets)?,
            };
            let db = Db::open_at(path, Some(&key))?;
            Ok(OpenedCache {
                db,
                lock,
                reset: false,
                still_plain: false,
            })
        }
        // Another copy is open, so the plain database stays as it is until a
        // start with no other copy.
        (FileState::Plain, _) => {
            let db = Db::open_at(path, None)?;
            Ok(OpenedCache {
                db,
                lock,
                reset: false,
                still_plain: true,
            })
        }
        (FileState::Encrypted, Some(key)) => match Db::open_at(path, Some(&key)) {
            Ok(db) => Ok(OpenedCache {
                db,
                lock,
                reset: false,
                still_plain: false,
            }),
            Err(e) if is_wrong_key(&e) => reset_wrong_key(path, secrets, lock),
            Err(e) => Err(e.into()),
        },
        (FileState::Encrypted, None) => Err(CacheError::InUse),
    }
}

/// The key in the keychain doesn't open the cache (a keychain restored from
/// elsewhere): set the cache aside and start a new one, as for a lost key,
/// when no other copy is open.
fn reset_wrong_key(
    path: &Path,
    secrets: &dyn SecretStore,
    lock: CacheLock,
) -> std::result::Result<OpenedCache, CacheError> {
    lock.unlock();
    if !lock.try_exclusive() {
        lock.shared()?;
        return Err(CacheError::InUse);
    }
    let opened = (|| -> std::result::Result<Db, CacheError> {
        remove_all(&database_files(&with_suffix(path, UNREADABLE)))?;
        set_aside(path)?;
        let key = new_key(secrets)?;
        lock.unlock();
        lock.shared()?;
        Ok(Db::open_at(path, Some(&key))?)
    })();
    match opened {
        Ok(db) => Ok(OpenedCache {
            db,
            lock,
            reset: true,
            still_plain: false,
        }),
        Err(e) => {
            lock.unlock();
            Err(e)
        }
    }
}

/// Moves the database and its write-ahead files aside, to be deleted at
/// the next start.
fn set_aside(path: &Path) -> Result<()> {
    let aside = with_suffix(path, UNREADABLE);
    for (from, to) in database_files(path).iter().zip(database_files(&aside)) {
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
pub(crate) fn encrypt_plain(path: &Path, key: &CacheKey) -> Result<()> {
    encrypt_plain_until(path, key, Stop::Never)
}

/// Where a test can stop the move, to check what's left.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Stop {
    Never,
    AfterCopy,
    AfterCheck,
}

pub(crate) fn encrypt_plain_until(path: &Path, key: &CacheKey, stop: Stop) -> Result<()> {
    let copy = with_suffix(path, ENCRYPTING);
    let copy_files = database_files(&copy);
    remove_all(&copy_files)?;
    let plain = Connection::open(path)?;
    // No other connection, from any copy or version: an exclusive lock,
    // without waiting, kept until the copy is checked.
    plain
        .execute_batch(
            "PRAGMA busy_timeout = 0; PRAGMA locking_mode = EXCLUSIVE; BEGIN EXCLUSIVE; COMMIT;",
        )
        .map_err(|_| CoreError::Other("the mail cache is open elsewhere".into()))?;
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
    Ok(())
}

/// The database a previous run left at `path`, opened only to read it (a
/// clean start reads its accounts to forget their keychain entries): plain,
/// or encrypted with the key in `secrets`. Nothing is made or changed.
pub fn open_existing(path: &Path, secrets: &dyn SecretStore) -> Option<Db> {
    match file_state(path).ok()? {
        FileState::Missing => None,
        FileState::Plain => Db::open_at(path, None).ok(),
        FileState::Encrypted => {
            let key = read_key(secrets).ok()??;
            Db::open_at(path, Some(&key)).ok()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::MemoryStore;
    use crate::db::accounts;

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

    /// A store whose keychain doesn't answer.
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
        let stored = secrets.get(KEY_ENTRY).unwrap().unwrap();
        assert_eq!(stored.len(), 64);
        // Reopened with the same key; refused without one.
        let opened = open_cache(&path, &secrets).unwrap();
        assert_eq!(marker(&opened.db), MARKER);
        drop(opened);
        assert!(Db::open(&path).is_err());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_plain_cache_is_moved_into_an_encrypted_one_and_nothing_plain_is_left() {
        let dir = temp_dir("plain");
        let path = super::super::path_in(&dir);
        {
            let db = Db::open(&path).unwrap();
            fill(&db);
        }
        assert_eq!(file_state(&path).unwrap(), FileState::Plain);
        let secrets = MemoryStore::default();
        let opened = open_cache(&path, &secrets).unwrap();
        assert!(!opened.reset && !opened.still_plain);
        assert_eq!(marker(&opened.db), MARKER, "the data came across");
        drop(opened);
        assert_eq!(file_state(&path).unwrap(), FileState::Encrypted);
        assert!(!plain_anywhere(&path, MARKER));
        let names: Vec<String> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert!(!names.iter().any(|n| n.contains(ENCRYPTING)), "{names:?}");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_move_stopped_halfway_leaves_the_plain_cache_and_the_next_start_finishes() {
        for stop in [Stop::AfterCopy, Stop::AfterCheck] {
            let dir = temp_dir("halfway");
            let path = super::super::path_in(&dir);
            {
                let db = Db::open(&path).unwrap();
                fill(&db);
            }
            let key = CacheKey::generate().unwrap();
            assert!(encrypt_plain_until(&path, &key, stop).is_err());
            assert_eq!(file_state(&path).unwrap(), FileState::Plain, "{stop:?}");
            assert_eq!(marker(&Db::open(&path).unwrap()), MARKER);
            let secrets = MemoryStore::default();
            let opened = open_cache(&path, &secrets).unwrap();
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
        // Deleted at the next start.
        let opened = open_cache(&path, &secrets).unwrap();
        assert!(!opened.reset);
        drop(opened);
        assert!(!with_suffix(&path, UNREADABLE).exists());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_key_that_doesnt_fit_is_treated_as_lost() {
        let dir = temp_dir("wrong");
        let path = super::super::path_in(&dir);
        let secrets = MemoryStore::default();
        fill(&open_cache(&path, &secrets).unwrap().db);
        let other = CacheKey::generate().unwrap();
        secrets.set(KEY_ENTRY, &other.hex()).unwrap();
        let opened = open_cache(&path, &secrets).unwrap();
        assert!(opened.reset);
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
            let before: Vec<Vec<u8>> = database_files(&path)
                .iter()
                .map(|f| std::fs::read(f).unwrap_or_default())
                .collect();
            let err = open_cache(&path, &Unreachable).err().unwrap();
            assert!(matches!(err, CacheError::Keychain(_)), "{err}");
            let after: Vec<Vec<u8>> = database_files(&path)
                .iter()
                .map(|f| std::fs::read(f).unwrap_or_default())
                .collect();
            assert_eq!(before, after, "plain: {plain}");
            assert!(!with_suffix(&path, UNREADABLE).exists());
            let _ = std::fs::remove_dir_all(dir);
        }
    }

    #[test]
    fn with_another_copy_open_the_plain_cache_waits_for_a_later_start() {
        let dir = temp_dir("two copies");
        let path = super::super::path_in(&dir);
        fill(&Db::open(&path).unwrap());
        // Another copy of the new version holds the shared lock.
        let other = CacheLock::open(&dir).unwrap();
        other.shared().unwrap();
        let secrets = MemoryStore::default();
        let opened = open_cache(&path, &secrets).unwrap();
        assert!(opened.still_plain);
        assert_eq!(marker(&opened.db), MARKER);
        drop(opened);
        drop(other);
        assert_eq!(file_state(&path).unwrap(), FileState::Plain);
        // No other copy now: it moves.
        let opened = open_cache(&path, &secrets).unwrap();
        assert!(!opened.still_plain);
        drop(opened);
        assert_eq!(file_state(&path).unwrap(), FileState::Encrypted);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn an_old_copy_with_the_database_open_stops_the_move_and_leaves_it_plain() {
        let dir = temp_dir("old copy");
        let path = super::super::path_in(&dir);
        let old = Db::open(&path).unwrap();
        fill(&old);
        let key = CacheKey::generate().unwrap();
        let err = encrypt_plain(&path, &key).unwrap_err();
        assert!(err.to_string().contains("open elsewhere"), "{err}");
        assert_eq!(marker(&old), MARKER);
        drop(old);
        assert_eq!(file_state(&path).unwrap(), FileState::Plain);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn the_key_never_reaches_an_error() {
        let key = CacheKey::generate().unwrap();
        let hex = key.hex().to_string();
        assert_eq!(CacheKey::from_hex(&hex).map(|k| *k.0 == *key.0), Some(true));
        assert!(CacheKey::from_hex("not a key").is_none());
        // A file that isn't a database: every error is free of the key.
        let dir = temp_dir("errors");
        let path = dir.join("x.sqlite3");
        std::fs::write(&path, b"made-up bytes that are not a database").unwrap();
        let conn = Connection::open(&path).unwrap();
        let _ = apply_key(&conn, &key);
        let e = Db::open_at(&path, Some(&key)).err().unwrap();
        assert!(is_wrong_key(&e), "{e}");
        assert!(!e.to_string().contains(&hex));
        let e = encrypt_plain(&path, &key).err().unwrap();
        assert!(!e.to_string().contains(&hex));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn open_existing_reads_a_previous_run_without_changing_it() {
        let dir = temp_dir("existing");
        let path = super::super::path_in(&dir);
        let secrets = MemoryStore::default();
        assert!(open_existing(&path, &secrets).is_none());
        assert!(!path.exists(), "nothing made");
        fill(&open_cache(&path, &secrets).unwrap().db);
        assert_eq!(marker(&open_existing(&path, &secrets).unwrap()), MARKER);
        assert!(open_existing(&path, &MemoryStore::default()).is_none());
        let _ = std::fs::remove_dir_all(dir);
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
