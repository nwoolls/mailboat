//! Cached files (downloaded attachments and images) encrypted on disk, so
//! the cache folder holds nothing readable without the mail cache's key.
//!
//! Each file is AES-256-GCM (`aws-lc-rs`) with a key derived from the mail
//! cache's key in the keychain (HKDF-SHA256), so there is no second key to
//! keep or lose. A file starts with a short header and a random nonce, and
//! its place in the cache (which account and which attachment or image) is
//! bound to it as associated data: a file copied over another's name, or
//! into another account's folder, doesn't open. A file that doesn't open
//! counts as missing, and is fetched again.
//!
//! When the cache has no key (an older copy of the app kept the database
//! plain this run, `db::cache::OpenedCache::files`), nothing is written to
//! the cache folder: attachments are fetched each time and images load
//! live.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use aws_lc_rs::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM, NONCE_LEN};
use aws_lc_rs::hkdf::{Salt, HKDF_SHA256};
use aws_lc_rs::rand::{SecureRandom, SystemRandom};

use crate::error::{CoreError, Result};

/// The start of every encrypted file, with the format's version.
const MAGIC: &[u8; 4] = b"SLD1";
/// What the file key is derived for (HKDF's `info`).
const INFO: &[u8] = b"cached-files-v1";
const TAG_LEN: usize = 16;

/// The key the cached files are encrypted with.
pub struct FileKey(LessSafeKey);

impl FileKey {
    /// The file key for a mail cache's key.
    pub(crate) fn derive(cache_key: &[u8]) -> Result<Self> {
        let prk = Salt::new(HKDF_SHA256, &[]).extract(cache_key);
        let okm = prk
            .expand(&[INFO], &AES_256_GCM)
            .map_err(|_| CoreError::Other("couldn't derive the cached files' key".into()))?;
        Ok(Self(LessSafeKey::new(UnboundKey::from(okm))))
    }

    /// A random key, for tests.
    pub fn generate() -> Result<Self> {
        let mut bytes = zeroize::Zeroizing::new([0u8; 32]);
        SystemRandom::new()
            .fill(&mut bytes[..])
            .map_err(|_| CoreError::Other("couldn't make a key".into()))?;
        Self::derive(&bytes[..])
    }

    /// `plain` encrypted for `place`: the header, the nonce, then the
    /// encrypted bytes and their tag.
    fn seal(&self, place: &str, plain: &[u8]) -> Result<Vec<u8>> {
        let mut nonce = [0u8; NONCE_LEN];
        SystemRandom::new()
            .fill(&mut nonce)
            .map_err(|_| CoreError::Other("couldn't encrypt a cached file".into()))?;
        let start = MAGIC.len() + NONCE_LEN;
        let mut out = Vec::with_capacity(start + plain.len() + TAG_LEN);
        out.extend_from_slice(MAGIC);
        out.extend_from_slice(&nonce);
        out.extend_from_slice(plain);
        let tag = self
            .0
            .seal_in_place_separate_tag(
                Nonce::assume_unique_for_key(nonce),
                aad(place),
                &mut out[start..],
            )
            .map_err(|_| CoreError::Other("couldn't encrypt a cached file".into()))?;
        out.extend_from_slice(tag.as_ref());
        Ok(out)
    }

    /// The bytes `seal` encrypted for `place`, or `None` when `sealed`
    /// isn't such a file, was changed, or belongs somewhere else.
    fn open(&self, place: &str, mut sealed: Vec<u8>) -> Option<Vec<u8>> {
        let start = MAGIC.len() + NONCE_LEN;
        if sealed.len() < start + TAG_LEN || &sealed[..MAGIC.len()] != MAGIC {
            return None;
        }
        let nonce = Nonce::try_assume_unique_for_key(&sealed[MAGIC.len()..start]).ok()?;
        let plain_len = self
            .0
            .open_in_place(nonce, aad(place), &mut sealed[start..])
            .ok()?
            .len();
        sealed.drain(..start);
        sealed.truncate(plain_len);
        Some(sealed)
    }
}

/// The associated data: the header and the file's place.
fn aad(place: &str) -> Aad<Vec<u8>> {
    let mut data = MAGIC.to_vec();
    data.extend_from_slice(place.as_bytes());
    Aad::from(data)
}

/// A cache folder whose files are encrypted, with the key (if the cache has
/// one this run).
#[derive(Clone)]
pub struct Sealed {
    pub dir: PathBuf,
    key: Option<Arc<FileKey>>,
}

impl std::fmt::Debug for Sealed {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Sealed")
            .field("dir", &self.dir)
            .field("key", &self.key.is_some())
            .finish()
    }
}

impl Sealed {
    pub fn new(dir: PathBuf, key: Option<Arc<FileKey>>) -> Self {
        Self { dir, key }
    }

    /// Whether files can be kept this run.
    pub fn keeps_files(&self) -> bool {
        self.key.is_some()
    }

    /// Writes `plain`, encrypted for `place`, to `path` (in this folder):
    /// first to a temporary name beside it, made this user's only, then
    /// renamed, so a reader never finds half a file. Returns false, and
    /// writes nothing, when files aren't kept this run.
    pub fn write(&self, path: &Path, place: &str, plain: &[u8]) -> Result<bool> {
        let Some(key) = &self.key else {
            return Ok(false);
        };
        let sealed = key.seal(place, plain)?;
        let folder = path
            .parent()
            .ok_or_else(|| CoreError::Other("a cached file has no folder".into()))?;
        let save_error = |e: std::io::Error| CoreError::Other(format!("save a cached file: {e}"));
        std::fs::create_dir_all(folder).map_err(save_error)?;
        let temp = folder.join(format!(".incoming-{}.tmp", fastrand::u64(..)));
        let written = std::fs::write(&temp, &sealed)
            .and_then(|()| crate::owner_only::file(&temp))
            .and_then(|()| std::fs::rename(&temp, path));
        if let Err(e) = written {
            let _ = std::fs::remove_file(&temp);
            return Err(save_error(e));
        }
        Ok(true)
    }

    /// The file at `path`, decrypted for `place`, or `None` when it isn't
    /// there, files aren't kept this run, or it doesn't open (changed, or
    /// moved from elsewhere): the caller fetches it again.
    pub fn read(&self, path: &Path, place: &str) -> Option<Vec<u8>> {
        let key = self.key.as_ref()?;
        let sealed = std::fs::read(path).ok()?;
        key.open(place, sealed)
    }
}

/// Empties `dir` of everything in it, and makes it this user's only. For
/// the folder of decrypted copies other apps open, at every start and quit;
/// a file another app still holds open (Windows) goes at the next one.
/// A link there (or, on Windows, a junction) is left alone, and so is what
/// it points at: the app makes none, so one there wasn't the app's.
pub fn empty_dir(dir: &Path) {
    if std::fs::symlink_metadata(dir).is_ok_and(|m| !m.file_type().is_dir()) {
        return;
    }
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let _ = if entry.file_type().is_ok_and(|t| t.is_dir()) {
                std::fs::remove_dir_all(&path)
            } else {
                std::fs::remove_file(&path)
            };
        }
    }
    let _ = crate::owner_only::dir(dir);
}

/// A decrypted copy of a cached file, for another app to open (the default
/// app, Quick Look): `<dir>/<random>/<name>`, so the app shows the file's
/// own name. The folder is emptied at every start and quit (`empty_dir`).
pub fn decrypted_copy(dir: &Path, name: &str, plain: &[u8]) -> Result<PathBuf> {
    let error = |e: std::io::Error| CoreError::Other(format!("couldn't open the file: {e}"));
    crate::owner_only::dir(dir).map_err(error)?;
    // Never into a folder a link leads to (see `empty_dir`).
    if !std::fs::symlink_metadata(dir)
        .map_err(error)?
        .file_type()
        .is_dir()
    {
        return Err(CoreError::Other(
            "couldn't open the file: its folder is a link".into(),
        ));
    }
    let folder = dir.join(format!("{:016x}", fastrand::u64(..)));
    crate::owner_only::dir(&folder).map_err(error)?;
    let path = folder.join(crate::attachments::safe_filename(name));
    std::fs::write(&path, plain).map_err(error)?;
    crate::owner_only::file(&path).map_err(error)?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    const MARKER: &[u8] = b"made-up invoice for Maya Chen, total 42.00";

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("sealed-{}", fastrand::u64(..)));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn holds(bytes: &[u8], needle: &[u8]) -> bool {
        bytes.windows(needle.len()).any(|w| w == needle)
    }

    #[test]
    fn a_file_is_kept_encrypted_and_reads_back() {
        let dir = temp_dir();
        let sealed = Sealed::new(dir.clone(), Some(Arc::new(FileKey::generate().unwrap())));
        let path = dir.join("1").join("7");
        assert!(sealed.write(&path, "attachment/1/7", MARKER).unwrap());
        let on_disk = std::fs::read(&path).unwrap();
        assert!(!holds(&on_disk, b"Maya Chen"), "no plain bytes on disk");
        assert_eq!(sealed.read(&path, "attachment/1/7").unwrap(), MARKER);
        let strays: Vec<_> = std::fs::read_dir(dir.join("1")).unwrap().collect();
        assert_eq!(strays.len(), 1, "no temporary file left");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_file_in_another_place_or_changed_or_with_another_key_doesnt_open() {
        let dir = temp_dir();
        let key = Arc::new(FileKey::generate().unwrap());
        let sealed = Sealed::new(dir.clone(), Some(key));
        let path = dir.join("f");
        sealed.write(&path, "attachment/1/7", MARKER).unwrap();
        assert!(
            sealed.read(&path, "attachment/2/7").is_none(),
            "another account"
        );
        assert!(
            sealed.read(&path, "attachment/1/8").is_none(),
            "another file"
        );
        let other = Sealed::new(dir.clone(), Some(Arc::new(FileKey::generate().unwrap())));
        assert!(other.read(&path, "attachment/1/7").is_none(), "another key");
        let mut bytes = std::fs::read(&path).unwrap();
        let last = bytes.len() - 1;
        bytes[last] ^= 1;
        std::fs::write(&path, &bytes).unwrap();
        assert!(sealed.read(&path, "attachment/1/7").is_none(), "changed");
        std::fs::write(&path, MARKER).unwrap();
        assert!(
            sealed.read(&path, "attachment/1/7").is_none(),
            "a plain file"
        );
        std::fs::write(&path, b"SLD1").unwrap();
        assert!(sealed.read(&path, "attachment/1/7").is_none(), "too short");
        assert!(sealed.read(&dir.join("missing"), "x").is_none());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn the_same_cache_key_gives_the_same_file_key() {
        let a = FileKey::derive(&[7u8; 32]).unwrap();
        let b = FileKey::derive(&[7u8; 32]).unwrap();
        let c = FileKey::derive(&[8u8; 32]).unwrap();
        let sealed = a.seal("image/1/x", MARKER).unwrap();
        assert_eq!(b.open("image/1/x", sealed.clone()).unwrap(), MARKER);
        assert!(c.open("image/1/x", sealed).is_none());
        // Each file gets its own nonce.
        assert_ne!(a.seal("p", MARKER).unwrap(), a.seal("p", MARKER).unwrap());
    }

    #[test]
    fn without_a_key_nothing_is_written() {
        let dir = temp_dir();
        let sealed = Sealed::new(dir.clone(), None);
        assert!(!sealed.keeps_files());
        let path = dir.join("f");
        assert!(!sealed.write(&path, "p", MARKER).unwrap());
        assert!(!path.exists());
        assert!(sealed.read(&path, "p").is_none());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn decrypted_copies_keep_their_name_and_are_emptied() {
        let dir = temp_dir().join("opened");
        let copy = decrypted_copy(&dir, "../report.pdf", MARKER).unwrap();
        assert_eq!(copy.file_name().unwrap(), "report.pdf");
        assert!(copy.starts_with(&dir));
        assert_eq!(std::fs::read(&copy).unwrap(), MARKER);
        let second = decrypted_copy(&dir, "report.pdf", MARKER).unwrap();
        assert_ne!(copy, second, "each copy in its own folder");
        empty_dir(&dir);
        assert!(dir.exists());
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0);
        empty_dir(&dir.join("missing"));
        let _ = std::fs::remove_dir_all(dir.parent().unwrap());
    }

    /// Review: a link in place of the folder is neither emptied (what it
    /// points at stays) nor written into.
    #[cfg(unix)]
    #[test]
    fn a_link_in_place_of_the_folder_is_left_alone() {
        let root = temp_dir();
        let elsewhere = root.join("elsewhere");
        std::fs::create_dir_all(&elsewhere).unwrap();
        std::fs::write(elsewhere.join("keep.txt"), b"x").unwrap();
        let dir = root.join("opened");
        std::os::unix::fs::symlink(&elsewhere, &dir).unwrap();
        empty_dir(&dir);
        assert!(elsewhere.join("keep.txt").exists());
        assert!(decrypted_copy(&dir, "report.pdf", MARKER).is_err());
        assert_eq!(std::fs::read_dir(&elsewhere).unwrap().count(), 1);
        let _ = std::fs::remove_dir_all(root);
    }
}
