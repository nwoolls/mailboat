//! Received attachments: downloading them into a local cache folder, safe
//! file names, and the inline (`cid:`) images an email shows itself.
//!
//! Files live under `<cache>/<account id>/<attachment id>/<file name>`, so
//! one account's files never mix with another's, and removing an account
//! removes its folder. Only the path recorded in the database is trusted;
//! a file left over from a deleted row is never served.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use base64::Engine;

use crate::db::store::{self, AttachmentRef};
use crate::db::Db;
use crate::error::{CoreError, Result};
use crate::gmail::{parse, GmailClient};
use crate::model::{AccountId, AttachmentId, MessageId};

/// Image types shown inline. Others (and SVG, which can carry scripts if
/// ever opened as a page) stay placeholders.
const INLINE_IMAGE_TYPES: &[&str] = &[
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/gif",
    "image/webp",
    "image/bmp",
];

/// Inline images are embedded in the email's document as `data:` URLs;
/// bigger ones are left out rather than bloating it.
pub const MAX_INLINE_IMAGE_BYTES: u64 = 5 * 1024 * 1024;

/// The folder holding one account's downloaded attachments.
pub fn account_dir(cache_dir: &Path, account: AccountId) -> PathBuf {
    cache_dir.join(account.0.to_string())
}

/// A file name that is safe to create: no folders (an email can name its
/// attachment `../../.zshrc`), no control characters or characters macOS
/// and Windows reject, not hidden, not empty, and not absurdly long.
pub fn safe_filename(name: &str) -> String {
    let last = name.rsplit(['/', '\\']).next().unwrap_or("");
    let cleaned: String = last
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                '_'
            } else {
                c
            }
        })
        .collect();
    let trimmed = cleaned.trim().trim_start_matches('.').trim();
    let trimmed = trimmed.trim_end_matches(['.', ' ']);
    if trimmed.is_empty() {
        return "attachment".into();
    }
    // Keep the extension when shortening.
    const MAX_CHARS: usize = 150;
    if trimmed.chars().count() <= MAX_CHARS {
        return trimmed.to_string();
    }
    let (stem, ext) = split_extension(trimmed);
    let keep = MAX_CHARS.saturating_sub(ext.chars().count());
    format!("{}{}", stem.chars().take(keep).collect::<String>(), ext)
}

/// "report.final.pdf" → ("report.final", ".pdf"); no extension → (name, "").
fn split_extension(name: &str) -> (&str, &str) {
    match name.rfind('.') {
        Some(i) if i > 0 && name.len() - i <= 10 => (&name[..i], &name[i..]),
        _ => (name, ""),
    }
}

/// A path in `dir` for `filename` that doesn't exist yet: "a.pdf", then
/// "a (1).pdf", "a (2).pdf", … as browsers name repeated downloads.
pub fn unique_path(dir: &Path, filename: &str) -> PathBuf {
    let name = safe_filename(filename);
    let first = dir.join(&name);
    if !first.exists() {
        return first;
    }
    let (stem, ext) = split_extension(&name);
    (1..)
        .map(|n| dir.join(format!("{stem} ({n}){ext}")))
        .find(|p| !p.exists())
        .unwrap_or(first)
}

/// Downloads an attachment into the cache (once) and returns its path.
pub async fn download(
    db: &Db,
    gmail: &GmailClient,
    id: AttachmentId,
    cache_dir: &Path,
) -> Result<PathBuf> {
    let a = store::attachment_ref(&db.conn(), id)?;
    if let Some(cached) = &a.cached_path {
        let path = PathBuf::from(cached);
        if path.is_file() && path.starts_with(cache_dir) {
            return Ok(path);
        }
    }
    let bytes = fetch_bytes(gmail, &a).await?;
    let dir = account_dir(cache_dir, a.account).join(a.id.0.to_string());
    std::fs::create_dir_all(&dir).map_err(|e| io_error("create the attachment folder", e))?;
    let path = dir.join(safe_filename(&a.filename));
    std::fs::write(&path, &bytes).map_err(|e| io_error("save the attachment", e))?;
    store::set_attachment_cached_path(&db.conn(), a.id, &path.to_string_lossy())?;
    Ok(path)
}

/// An attachment's bytes from Gmail. Gmail's attachment IDs change between
/// fetches, so if the stored one is refused, the message is fetched again
/// for a fresh one. Small parts have no ID: their data comes with the
/// message itself.
async fn fetch_bytes(gmail: &GmailClient, a: &AttachmentRef) -> Result<Vec<u8>> {
    if let Some(attachment_id) = &a.gmail_attachment_id {
        match gmail.attachment(&a.gmail_message_id, attachment_id).await {
            Ok(bytes) => return Ok(bytes),
            Err(CoreError::NotFound(_)) | Err(CoreError::Api { status: 400, .. }) => {}
            Err(e) => return Err(e),
        }
    }
    let full = gmail.message_full(&a.gmail_message_id).await?;
    let payload = full
        .payload
        .as_ref()
        .ok_or_else(|| CoreError::NotFound(format!("attachment {}", a.id.0)))?;
    if let Some(bytes) = parse::part_data(payload, &a.part_id) {
        return Ok(bytes);
    }
    match parse::part_attachment_id(payload, &a.part_id) {
        Some(fresh) => gmail.attachment(&a.gmail_message_id, &fresh).await,
        None => Err(CoreError::NotFound(format!("attachment {}", a.id.0))),
    }
}

/// The inline images of a message as `data:` URLs, keyed by lowercased
/// Content-ID, for the sanitizer to put in place of `cid:` links. Images
/// that can't be fetched, are too big or of an unsafe type are left out
/// (they stay placeholders); the email still opens.
pub async fn inline_images(
    db: &Db,
    gmail: &GmailClient,
    message: MessageId,
    cache_dir: &Path,
) -> HashMap<String, String> {
    let parts = match store::inline_parts(&db.conn(), message) {
        Ok(parts) => parts,
        Err(_) => return HashMap::new(),
    };
    let mut images = HashMap::new();
    for part in parts {
        let mime = part.mime_type.to_ascii_lowercase();
        let Some(cid) = part.content_id.as_deref() else {
            continue;
        };
        if !INLINE_IMAGE_TYPES.contains(&mime.as_str()) || part.size > MAX_INLINE_IMAGE_BYTES {
            continue;
        }
        let Ok(path) = download(db, gmail, part.id, cache_dir).await else {
            continue;
        };
        let Ok(bytes) = std::fs::read(&path) else {
            continue;
        };
        if bytes.len() as u64 > MAX_INLINE_IMAGE_BYTES {
            continue;
        }
        let data = base64::engine::general_purpose::STANDARD.encode(&bytes);
        images.insert(
            cid.to_ascii_lowercase(),
            format!("data:{mime};base64,{data}"),
        );
    }
    images
}

fn io_error(what: &str, e: std::io::Error) -> CoreError {
    CoreError::Other(format!("could not {what}: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_names_cannot_escape_or_hide() {
        assert_eq!(safe_filename("../../.zshrc"), "zshrc");
        assert_eq!(safe_filename(r"C:\Users\x\evil.exe"), "evil.exe");
        assert_eq!(safe_filename("a\u{0}b:c?.pdf"), "a_b_c_.pdf");
        assert_eq!(safe_filename("  ...  "), "attachment");
        assert_eq!(safe_filename(""), "attachment");
        assert_eq!(safe_filename("report.pdf. "), "report.pdf");
        assert_eq!(safe_filename("Résumé 2026.pdf"), "Résumé 2026.pdf");
        let long = format!("{}.pdf", "x".repeat(400));
        let short = safe_filename(&long);
        assert!(short.ends_with(".pdf") && short.chars().count() == 150);
    }

    #[test]
    fn repeated_downloads_get_numbered_names() {
        let dir = std::env::temp_dir().join(format!("mailboat-unique-{}", fastrand::u64(..)));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(unique_path(&dir, "a.pdf"), dir.join("a.pdf"));
        std::fs::write(dir.join("a.pdf"), b"1").unwrap();
        assert_eq!(unique_path(&dir, "a.pdf"), dir.join("a (1).pdf"));
        std::fs::write(dir.join("a (1).pdf"), b"2").unwrap();
        assert_eq!(unique_path(&dir, "a.pdf"), dir.join("a (2).pdf"));
        std::fs::write(dir.join("notes"), b"3").unwrap();
        assert_eq!(unique_path(&dir, "notes"), dir.join("notes (1)"));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
