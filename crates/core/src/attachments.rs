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

/// The longest a file name may be, in characters and in bytes. File systems
/// stop at 255 bytes (macOS APFS; Windows NTFS counts UTF-16 units, never
/// more than UTF-8 bytes), and a Japanese or emoji name is three to four bytes
/// a character, so characters alone don't do. 200 leaves room for the `_` of
/// a device name. A numbered copy (`unique_path`) is fitted into the same
/// limits, so a name that fits stays as it is when cleaned again.
const MAX_NAME_CHARS: usize = 150;
const MAX_NAME_BYTES: usize = 200;

/// Characters that change which way text runs: without them replaced,
/// `photo<RLO>gpj.exe` shows as `photoexe.jpg` in a file manager.
fn is_direction_control(c: char) -> bool {
    matches!(c, '\u{61c}' | '\u{200e}' | '\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
}

/// What a name may not start or end with: Windows drops trailing dots and
/// spaces, and a leading dot hides a file.
fn is_edge_junk(c: char) -> bool {
    c == '.' || c.is_whitespace()
}

/// Whether Windows treats this name as a device, not a file: `CON`, `PRN`,
/// `AUX`, `NUL`, `COM0`-`COM9` and `LPT0`-`LPT9` (also with the superscript
/// digits `¹ ² ³`), and the console handles `CONIN$` and `CONOUT$`, by the
/// part before the first dot, whatever the case and trailing spaces. Saving
/// to one writes to the device, not to a file.
fn is_windows_device(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or("").trim_end_matches(' ');
    let upper = stem.to_uppercase();
    if matches!(
        upper.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
    ) {
        return true;
    }
    ["COM", "LPT"].iter().any(|prefix| {
        let mut rest = upper.strip_prefix(prefix).unwrap_or("-").chars();
        matches!(
            (rest.next(), rest.next()),
            (Some('0'..='9' | '¹' | '²' | '³'), None)
        )
    })
}

/// A file name that is safe to create, or `None` if nothing usable is left
/// of `name`: no folders (an email can name its attachment
/// `../../.zshrc`), no control, line-separator or text-direction characters
/// or characters macOS and Windows reject, not hidden, no trailing dot or
/// space (Windows drops them), not a Windows device name (a `_` goes in
/// front), and not absurdly long, in characters or bytes.
pub fn clean_filename(name: &str) -> Option<String> {
    let last = name.rsplit(['/', '\\']).next().unwrap_or("");
    let cleaned: String = last
        .chars()
        .map(|c| {
            if c.is_control()
                || is_direction_control(c)
                || matches!(c, '\u{2028}' | '\u{2029}')
                || matches!(c, ':' | '*' | '?' | '"' | '<' | '>' | '|')
            {
                '_'
            } else {
                c
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches(is_edge_junk);
    if trimmed.is_empty() {
        return None;
    }
    let short = shorten(trimmed);
    // Cutting can land on a device name (`CON`, spaces, then `.txt`), so it is
    // checked after; the `_` is then counted in the limits.
    Some(if is_windows_device(&short) {
        shorten(&format!("_{short}"))
    } else {
        short
    })
}

/// `clean_filename`, or "attachment" when nothing is left.
pub fn safe_filename(name: &str) -> String {
    clean_filename(name).unwrap_or_else(|| "attachment".into())
}

/// The start of `stem` that fits the limits next to `ext` and a suffix of
/// `suffix_chars` characters and `suffix_bytes` bytes.
fn cut_stem<'a>(stem: &'a str, ext: &str, suffix_chars: usize, suffix_bytes: usize) -> &'a str {
    let room_chars = MAX_NAME_CHARS.saturating_sub(ext.chars().count() + suffix_chars);
    let room_bytes = MAX_NAME_BYTES.saturating_sub(ext.len() + suffix_bytes);
    let (mut chars, mut bytes) = (0, 0);
    for (i, c) in stem.char_indices() {
        if chars + 1 > room_chars || bytes + c.len_utf8() > room_bytes {
            return &stem[..i];
        }
        chars += 1;
        bytes += c.len_utf8();
    }
    stem
}

/// Cuts a name down to `MAX_NAME_CHARS` and `MAX_NAME_BYTES`, keeping its
/// extension, and never leaving a trailing dot or space.
fn shorten(name: &str) -> String {
    if name.chars().count() <= MAX_NAME_CHARS && name.len() <= MAX_NAME_BYTES {
        return name.to_string();
    }
    let (stem, ext) = split_extension(name);
    let kept = cut_stem(stem, ext, 0, 0);
    // Without an extension, the cut may land after a dot or a space.
    let kept = if ext.is_empty() {
        kept.trim_end_matches(is_edge_junk)
    } else {
        kept
    };
    format!("{kept}{ext}")
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
    (1..)
        .map(|n| dir.join(numbered_filename(&name, n)))
        .find(|p| !p.exists())
        .unwrap_or(first)
}

/// `name` (already cleaned) as its `n`th copy: "a (2).pdf". The number goes in
/// before the extension, and the stem gives up the room it takes, so a
/// numbered name fits the limits like any other.
pub(crate) fn numbered_filename(name: &str, n: u32) -> String {
    let (stem, ext) = split_extension(name);
    let suffix = format!(" ({n})");
    let kept = cut_stem(stem, ext, suffix.chars().count(), suffix.len());
    format!("{kept}{suffix}{ext}")
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

    /// Found by fuzzing the file-name code (made-up names throughout).
    #[test]
    fn text_direction_controls_cannot_disguise_an_extension() {
        for control in [
            '\u{202e}', '\u{202d}', '\u{202a}', '\u{2066}', '\u{2069}', '\u{200e}', '\u{200f}',
            '\u{61c}',
        ] {
            let name = safe_filename(&format!("photo{control}gpj.exe"));
            assert_eq!(name, "photo_gpj.exe", "{control:?}");
        }
        // Other invisible characters, which the scripts that need them do, stay.
        assert_eq!(safe_filename("a\u{200d}b.pdf"), "a\u{200d}b.pdf");
    }

    #[test]
    fn windows_device_names_get_a_prefix_so_they_are_files() {
        for (name, saved) in [
            ("NUL.pdf", "_NUL.pdf"),
            ("con", "_con"),
            ("Aux.tar.gz", "_Aux.tar.gz"),
            ("PRN.txt", "_PRN.txt"),
            ("com1.txt", "_com1.txt"),
            ("LPT9", "_LPT9"),
            ("LPT¹.txt", "_LPT¹.txt"),
            ("COM0", "_COM0"),
            ("aux .txt", "_aux .txt"),
        ] {
            assert_eq!(safe_filename(name), saved);
        }
        // Names that only start like one are files already.
        for name in [
            "CONFIG.txt",
            "console.log",
            "COM10.txt",
            "com.txt",
            "NULL",
            "auxiliary",
            "A.nul",
        ] {
            assert_eq!(safe_filename(name), name);
        }
    }

    #[test]
    fn a_name_fits_a_file_system_in_bytes_not_only_characters() {
        for text in ["あ", "😀", "é", "x"] {
            for name in [
                text.repeat(300),
                format!("{}.pdf", text.repeat(300)),
                format!("{}.{}", text.repeat(120), "y".repeat(50)),
            ] {
                let short = safe_filename(&name);
                assert!(short.len() <= 200, "{} bytes: {short:?}", short.len());
                assert!(short.chars().count() <= 150);
                assert!(short.starts_with(text), "{short:?}");
            }
        }
        // The extension stays, and a name that already fits is left alone.
        let kept = safe_filename(&format!("{}.pdf", "あ".repeat(300)));
        assert!(kept.ends_with(".pdf"), "{kept:?}");
        let fits = format!("{}.pdf", "あ".repeat(60));
        assert_eq!(safe_filename(&fits), fits);
    }

    #[test]
    fn cutting_a_long_name_never_leaves_a_trailing_dot_or_space() {
        for name in [
            format!("{} {}", "x".repeat(149), "y".repeat(20)),
            format!("{}.{}", "x".repeat(149), "y".repeat(20)),
            format!("{}. .{}", "x".repeat(148), "y".repeat(20)),
            format!("{} {}", "あ".repeat(66), "y".repeat(20)),
        ] {
            let short = safe_filename(&name);
            assert!(!short.ends_with(['.', ' ']), "{short:?}");
            assert!(!short.starts_with(['.', ' ']), "{short:?}");
        }
    }

    #[test]
    fn cleaning_a_name_twice_changes_nothing() {
        let names = [
            "photo\u{202e}gpj.exe".to_string(),
            "NUL.pdf".into(),
            "あ".repeat(300),
            format!("{} {}", "x".repeat(149), "y".repeat(20)),
            "  ..hidden.pdf. ".into(),
            "a:b*c?d.txt".into(),
            "../../.zshrc".into(),
            "".into(),
        ];
        for name in names {
            let once = safe_filename(&name);
            assert_eq!(safe_filename(&once), once, "{name:?}");
        }
    }

    /// Review of the fix: a numbered copy went past the limit its own
    /// cleaning applies, so the reveal command (which cleans a file name
    /// again) looked for a different file.
    #[test]
    fn a_numbered_copy_fits_the_limits_and_survives_cleaning_again() {
        let dir = std::env::temp_dir().join(format!("attachments-numbered-{}", fastrand::u64(..)));
        std::fs::create_dir_all(&dir).unwrap();
        for name in [
            format!("{}.png", "あ".repeat(66)),
            format!("{}.png", "x".repeat(146)),
            "x".repeat(300),
            format!("{}.png", "😀".repeat(50)),
        ] {
            let mut previous = None;
            for _ in 0..3 {
                let path = unique_path(&dir, &name);
                let file = path.file_name().unwrap().to_string_lossy().into_owned();
                assert_eq!(path.parent(), Some(dir.as_path()));
                assert!(
                    file.len() <= 200 && file.chars().count() <= 150,
                    "{} bytes: {file:?}",
                    file.len()
                );
                assert_eq!(safe_filename(&file), file, "reveal cleans it again");
                assert_ne!(Some(&path), previous.as_ref());
                std::fs::write(&path, b"x").unwrap();
                previous = Some(path);
            }
        }
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// Review of the fix: a cut can make a device name (`CON`, spaces, `.txt`).
    #[test]
    fn a_cut_cannot_land_on_a_windows_device_name() {
        for name in [
            format!("CON{}x.txt", " ".repeat(160)),
            format!("nul{}x", " ".repeat(300)),
            format!("COM1{}y.pdf", " ".repeat(160)),
            format!("aux{}.tar.gz", " ".repeat(160)),
        ] {
            let name = safe_filename(&name);
            assert!(name.starts_with('_'), "{name:?}");
            assert!(
                name.len() <= 200 && name.chars().count() <= 150,
                "{} bytes",
                name.len()
            );
            assert_eq!(safe_filename(&name), name);
        }
    }

    #[test]
    fn the_console_handles_are_devices_too() {
        assert_eq!(safe_filename("CONIN$"), "_CONIN$");
        assert_eq!(safe_filename("conout$.txt"), "_conout$.txt");
        assert_eq!(safe_filename("CONIN$x"), "CONIN$x");
    }

    #[test]
    fn line_and_paragraph_separators_are_replaced() {
        assert_eq!(safe_filename("a\u{2028}b\u{2029}c.pdf"), "a_b_c.pdf");
    }

    /// Review of the fix: dots and non-breaking spaces mixed at the ends were
    /// trimmed one kind at a time, so a second cleaning trimmed more.
    #[test]
    fn dots_and_unusual_spaces_at_the_ends_are_all_trimmed_at_once() {
        assert_eq!(safe_filename(".\u{a0}.x"), "x");
        assert_eq!(safe_filename("abc.\u{a0}."), "abc");
        assert_eq!(safe_filename("\u{3000}. .pdf"), "pdf");
        let cut = safe_filename(&format!("{}\u{a0}{}", "x".repeat(149), "y".repeat(20)));
        assert!(!cut.ends_with(char::is_whitespace), "{cut:?}");
        assert_eq!(safe_filename(&cut), cut);
    }

    #[test]
    fn repeated_downloads_get_numbered_names() {
        let dir =
            std::env::temp_dir().join(format!("attachments-unique-test-{}", fastrand::u64(..)));
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
