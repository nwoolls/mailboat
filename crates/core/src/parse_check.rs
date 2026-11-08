//! Checks for the code that reads untrusted text other than HTML (which
//! `mail::sanitize_check` covers): a `mailto:` link, an email's raw source,
//! the message a Gmail response holds, and the file names an email picks.
//! Used by the property tests below (every `cargo test`) and by the fuzz
//! targets in `fuzz/` (coverage-guided, weekly and by hand). A check that
//! fails is a bug in code that handles what a stranger sent.
//!
//! Each `*_problems` function runs the code on one input and lists what is
//! wrong with the result, one line each (empty when it is fine). They state
//! what the rest of the app relies on, not what the code happens to do:
//! - a `mailto:` link: read only when it is one, its recipients trimmed and
//!   never empty, its body free of carriage returns;
//! - an email's raw source: sizes and the cut-off as stated, and
//!   authentication results shown only if the topmost header is Gmail's (for
//!   a well-formed header block; a broken one is only read without panicking);
//! - a Gmail message: read without panicking, addresses with an `@` and no
//!   stray padding, and every attachment name safe to save;
//! - a file name: one path component, nothing the file systems of macOS and
//!   Windows reject or treat as a device, no text-direction controls (they
//!   make `photo<RLO>gpj.exe` read as `photoexe.jpg`), short enough in bytes,
//!   and the same when cleaned again.

use std::path::Path;

use crate::attachments::{numbered_filename, safe_filename, unique_path};
use crate::gmail::parse;
use crate::gmail::types::{Message, MessagePart};
use crate::mail::mailto::{self, Mailto};
use crate::mail::original;
use crate::model::Address;

/// The longest a file name may be, in bytes: macOS (APFS) and Windows (NTFS,
/// in UTF-16 units, which are never more than UTF-8 bytes) both stop at 255.
const MAX_NAME_BYTES: usize = 255;

/// Names Windows reserves for devices, with or without an extension
/// (`NUL.pdf` is still the null device).
const WINDOWS_DEVICES: &[&str] = &["CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$"];

/// Characters that change which way text runs. A name that holds one can show
/// its extension somewhere else than where it is.
fn is_direction_control(c: char) -> bool {
    matches!(c, '\u{61c}' | '\u{200e}' | '\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
}

/// Whether Windows would treat this as a device, not a file: `CON`, `PRN`,
/// `AUX`, `NUL`, `COM1`-`COM9`, `LPT1`-`LPT9` (also with the superscript
/// digits `¹ ² ³`), by the part before the first dot, trailing spaces ignored.
fn is_windows_device(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or("").trim_end_matches(' ');
    let upper = stem.to_uppercase();
    if WINDOWS_DEVICES.contains(&upper.as_str()) {
        return true;
    }
    for prefix in ["COM", "LPT"] {
        if let Some(rest) = upper.strip_prefix(prefix) {
            let mut chars = rest.chars();
            if let (Some(digit), None) = (chars.next(), chars.next()) {
                if matches!(digit, '0'..='9' | '¹' | '²' | '³') {
                    return true;
                }
            }
        }
    }
    false
}

/// What is wrong with a file name the app would create, if anything.
pub fn filename_result_problems(name: &str) -> Vec<String> {
    let mut problems = Vec::new();
    let mut say = |what: &str| problems.push(format!("{what}: {name:?}"));
    if name.is_empty() {
        say("is empty");
    }
    if name.contains(['/', '\\']) {
        say("holds a path separator");
    }
    if name
        .chars()
        .any(|c| c.is_control() || matches!(c, '\u{2028}' | '\u{2029}'))
    {
        say("holds a control or line-separator character");
    }
    if name
        .chars()
        .any(|c| matches!(c, ':' | '*' | '?' | '"' | '<' | '>' | '|'))
    {
        say("holds a character Windows or macOS rejects");
    }
    if name.chars().any(is_direction_control) {
        say("holds a text-direction control, which can hide its extension");
    }
    if name == "." || name == ".." || name.starts_with('.') {
        say("is hidden or a dot name");
    }
    if name.ends_with('.')
        || name.ends_with(char::is_whitespace)
        || name.starts_with(char::is_whitespace)
    {
        say("starts with whitespace or ends with a dot or whitespace (Windows drops them)");
    }
    if name.len() > MAX_NAME_BYTES {
        say("is longer than the 255 bytes a file system takes");
    }
    if is_windows_device(name) {
        say("is a Windows device name");
    }
    problems
}

/// Cleans `name` and checks the result: the rules above, the same again if
/// cleaned twice, the right place in a folder, and, as a downloaded
/// original is named, that `.eml` stays on the end.
pub fn filename_problems(name: &str) -> Vec<String> {
    let cleaned = safe_filename(name);
    let mut problems = filename_result_problems(&cleaned);
    if safe_filename(&cleaned) != cleaned {
        problems.push(format!(
            "changes when cleaned again: {name:?} -> {cleaned:?}"
        ));
    }
    // Nothing on disk is touched: the folder doesn't exist, so the first name is free.
    let dir = Path::new("/nonexistent-folder-for-checks");
    let path = unique_path(dir, name);
    if path.parent() != Some(dir) {
        problems.push(format!(
            "a saved path leaves its folder: {name:?} -> {path:?}"
        ));
    }
    // Numbered copies, as a second download of the same name is saved.
    for n in [1, 2, 9, 10, 99, 1000, u32::MAX] {
        let copy = numbered_filename(&cleaned, n);
        problems.extend(
            filename_result_problems(&copy)
                .into_iter()
                .map(|p| format!("copy {n}: {p}")),
        );
        if !copy.contains(&format!("({n})")) {
            problems.push(format!("copy {n} lost its number: {copy:?}"));
        }
    }
    let original = safe_filename(&original::file_name(Some(name)));
    if !original.ends_with(".eml") {
        problems.push(format!(
            "a downloaded original loses `.eml`: {name:?} -> {original:?}"
        ));
    }
    problems.extend(
        filename_result_problems(&original)
            .into_iter()
            .map(|p| format!("downloaded original: {p}")),
    );
    problems
}

/// What is wrong with how `mailto::parse` read `link`.
pub fn mailto_result_problems(link: &str, parsed: Option<&Mailto>) -> Vec<String> {
    let is_link = link
        .trim()
        .get(..7)
        .is_some_and(|scheme| scheme.eq_ignore_ascii_case("mailto:"));
    let mut problems = Vec::new();
    if is_link != parsed.is_some() {
        problems.push(format!(
            "read as a mailto link: {is_link}, but parsed: {}",
            parsed.is_some()
        ));
    }
    if let Some(m) = parsed {
        for (field, list) in [("to", &m.to), ("cc", &m.cc), ("bcc", &m.bcc)] {
            for item in list {
                if item.is_empty() || item.trim() != item {
                    problems.push(format!(
                        "{field} holds an empty or untrimmed recipient: {item:?}"
                    ));
                }
            }
        }
        if m.body.contains('\r') {
            problems.push("the body holds a carriage return".to_string());
        }
    }
    problems
}

/// Runs `mailto::parse` on `link` and checks the result.
pub fn mailto_problems(link: &str) -> Vec<String> {
    mailto_result_problems(link, mailto::parse(link).as_ref())
}

/// For a well-formed header block, the authserv-id (the name before the first
/// `;`) of its topmost `Authentication-Results` header, read straight from the
/// source without the parser the app uses. The outer `None` means the block
/// isn't well-formed (a line without a plain `Name:`, a name with a space or
/// control character, a stray carriage return, folded lines with nothing to
/// fold into), where the parser recovers in its own way and a plain scan can't
/// say what it should find; the inner `None` means there is no such header.
fn well_formed_topmost_authserv(raw: &[u8]) -> Option<Option<String>> {
    let text = String::from_utf8_lossy(raw);
    let mut headers: Vec<String> = Vec::new();
    for line in text.split('\n') {
        let line = line.strip_suffix('\r').unwrap_or(line);
        if line.is_empty() {
            break;
        }
        if line.contains('\r') || line.chars().any(|c| c.is_control() && c != '\t') {
            return None;
        }
        if line.starts_with([' ', '\t']) {
            // A folded line has to continue a header.
            let last = headers.last_mut()?;
            last.push(' ');
            last.push_str(line.trim());
        } else {
            let (name, _) = line.split_once(':')?;
            if name.is_empty() || !name.chars().all(|c| c.is_ascii_graphic()) {
                return None;
            }
            headers.push(line.to_string());
        }
    }
    let value = headers.iter().find_map(|h| {
        let (name, value) = h.split_once(':')?;
        name.eq_ignore_ascii_case("authentication-results")
            .then(|| value.trim().to_string())
    });
    Some(value.map(|value| {
        let authserv = value.split(';').next().unwrap_or("");
        authserv.split_whitespace().next().unwrap_or("").to_string()
    }))
}

/// What is wrong with what `original::read` made of a raw email.
pub fn original_result_problems(raw: &[u8], read: &original::Original) -> Vec<String> {
    let mut problems = Vec::new();
    if read.truncated != (raw.len() > original::SHOWN_BYTES) {
        problems.push(format!(
            "truncated is {} for {} bytes",
            read.truncated,
            raw.len()
        ));
    }
    if u64::from(read.size) != (raw.len() as u64).min(u64::from(u32::MAX)) {
        problems.push(format!("size is {} for {} bytes", read.size, raw.len()));
    }
    if !read.truncated && read.source != String::from_utf8_lossy(raw) {
        problems.push("the source isn't the whole message".to_string());
    }
    if read.truncated {
        // The first SHOWN_BYTES bytes as text. If the cut split a character
        // (the bytes end in an unfinished one), its replacement mark must be
        // gone; otherwise the source is exactly that text, or, when the bytes
        // themselves end in a bad byte, that text without its last mark.
        let shown = &raw[..raw.len().min(original::SHOWN_BYTES)];
        let whole = String::from_utf8_lossy(shown);
        let trimmed = whole.strip_suffix('\u{FFFD}').unwrap_or(&whole);
        let split = std::str::from_utf8(shown).is_err_and(|e| e.error_len().is_none());
        let fine = if split {
            read.source == trimmed
        } else {
            read.source == whole || read.source == trimmed
        };
        if !fine {
            problems.push("the shown source isn't the start of the message".to_string());
        }
    }
    // A cut at SHOWN_BYTES, then lossy UTF-8: every bad byte may become 3.
    if read.source.len() > 3 * original::SHOWN_BYTES {
        problems.push(format!("the source is {} bytes", read.source.len()));
    }
    if read.checks.len() > 3 {
        problems.push("more than three authentication checks".to_string());
    }
    let methods: Vec<&str> = read.checks.iter().map(|c| c.method.as_str()).collect();
    let in_order = ["SPF", "DKIM", "DMARC"]
        .iter()
        .filter(|m| methods.contains(m))
        .copied()
        .collect::<Vec<_>>();
    if methods != in_order {
        problems.push(format!("checks out of order or repeated: {methods:?}"));
    }
    if read
        .checks
        .iter()
        .any(|c| c.result != c.result.to_ascii_lowercase())
    {
        problems.push("a check's result isn't lowercase".to_string());
    }
    // Only Gmail's own verdict counts: the topmost header has to name it.
    if !read.checks.is_empty() {
        if let Some(top) = well_formed_topmost_authserv(raw) {
            if top.as_deref() != Some("mx.google.com") {
                problems.push(format!(
                    "checks are shown, but the topmost Authentication-Results names {top:?}"
                ));
            }
        }
    }
    problems
}

/// Runs `original::read` on `raw` and checks the result.
pub fn original_problems(raw: &[u8]) -> Vec<String> {
    original_result_problems(raw, &original::read(raw))
}

fn part_headers<'a>(part: &'a MessagePart, out: &mut Vec<&'a str>) {
    out.extend(part.headers.iter().map(|h| h.value.as_str()));
    for child in &part.parts {
        part_headers(child, out);
    }
}

/// What is wrong with one address the app shows: it needs an `@`, no padding
/// around it, and a name that is either absent or not empty or padded.
pub fn address_result_problems(address: &Address) -> Vec<String> {
    let mut problems = Vec::new();
    if !address.email.contains('@') || address.email.trim() != address.email {
        problems.push(format!(
            "an address with no `@` or with padding: {:?}",
            address.email
        ));
    }
    if address
        .name
        .as_deref()
        .is_some_and(|n| n.trim() != n || n.is_empty())
    {
        problems.push(format!(
            "an address name with padding or empty: {:?}",
            address.name
        ));
    }
    problems
}

/// What is wrong with how a Gmail `messages.get` response (as JSON text) is
/// read: nothing if it isn't a message at all.
pub fn message_problems(json: &str) -> Vec<String> {
    let Ok(message) = serde_json::from_str::<Message>(json) else {
        return Vec::new();
    };
    let mut problems = Vec::new();
    let incoming = parse::message_to_incoming(&message);
    for address in incoming
        .from
        .iter()
        .chain(&incoming.to)
        .chain(&incoming.cc)
        .chain(&incoming.reply_to)
    {
        problems.extend(address_result_problems(address));
    }
    let Some(payload) = message.payload.as_ref() else {
        return problems;
    };
    let mut values = Vec::new();
    part_headers(payload, &mut values);
    for value in values {
        for address in parse::parse_address_list(value) {
            if !address.email.contains('@') {
                problems.push(format!("an address with no `@`: {:?}", address.email));
            }
        }
    }
    let body = parse::extract_body(payload);
    let attachments = parse::extract_attachments(payload, body.html.as_deref());
    for attachment in &attachments {
        problems.extend(
            filename_problems(&attachment.filename)
                .into_iter()
                .map(|p| format!("attachment name: {p}")),
        );
        // Looking the part up again must not panic.
        let _ = parse::part_data(payload, &attachment.part_id);
        let _ = parse::part_attachment_id(payload, &attachment.part_id);
    }
    let _ = parse::calendar_part(payload);
    problems
}

#[cfg(test)]
mod tests {
    use proptest::prelude::*;

    use super::*;

    #[test]
    fn the_name_rules_accept_a_good_name_and_catch_each_bad_one() {
        assert_eq!(
            filename_result_problems("Quarterly report.pdf"),
            Vec::<String>::new()
        );
        assert_eq!(
            filename_result_problems("résumé (final).docx"),
            Vec::<String>::new()
        );
        let long = "あ".repeat(85); // 255 bytes
        assert_eq!(filename_result_problems(&long), Vec::<String>::new());
        for bad in [
            "",
            "a/b",
            "a\\b",
            "a\u{0}b",
            "a\tb",
            "a:b",
            "a*b",
            "a?b",
            "a\"b",
            "a<b",
            "a>b",
            "a|b",
            "photo\u{202e}gpj.exe",
            "a\u{200f}b",
            "a\u{2066}b",
            ".",
            "..",
            ".hidden",
            "name.",
            "name ",
            " name",
            &"あ".repeat(86),
            "CON",
            "nul.pdf",
            "Aux.tar.gz",
            "com1",
            "LPT9.txt",
            "COM¹",
            "con .txt",
            "conin$",
            "CONOUT$.txt",
            "a\u{2028}b",
            "a\u{2029}b",
            "name\u{a0}",
            "\u{3000}name",
        ] {
            assert_ne!(
                filename_result_problems(bad),
                Vec::<String>::new(),
                "{bad:?}"
            );
        }
        // Not devices.
        for fine in [
            "CONFIG.txt",
            "console.log",
            "COM10.txt",
            "com.txt",
            "NULL",
            "auxiliary",
        ] {
            assert_eq!(
                filename_result_problems(fine),
                Vec::<String>::new(),
                "{fine:?}"
            );
        }
    }

    #[test]
    fn long_names_stay_within_the_limits_as_numbered_copies_too() {
        for name in [
            format!("{}.pdf", "a".repeat(400)),
            format!("{}.pdf", "あ".repeat(100)),
            "x".repeat(300),
            format!("name.{}", "e".repeat(300)),
        ] {
            assert_eq!(filename_problems(&name), Vec::<String>::new(), "{name:.20}");
        }
    }

    #[test]
    fn the_mailto_rules_catch_each_kind_of_problem() {
        let ok = Mailto {
            to: vec!["maya@x.example".into()],
            ..Mailto::default()
        };
        assert_eq!(
            mailto_result_problems("mailto:maya@x.example", Some(&ok)),
            Vec::<String>::new()
        );
        assert_ne!(
            mailto_result_problems("mailto:a@x.example", None),
            Vec::<String>::new()
        );
        assert_ne!(
            mailto_result_problems("https://x.example", Some(&ok)),
            Vec::<String>::new()
        );
        let padded = Mailto {
            to: vec![" a@x.example".into()],
            ..Mailto::default()
        };
        assert_ne!(
            mailto_result_problems("mailto:a@x.example", Some(&padded)),
            Vec::<String>::new()
        );
        let empty = Mailto {
            cc: vec![String::new()],
            ..Mailto::default()
        };
        assert_ne!(
            mailto_result_problems("mailto:?cc=a", Some(&empty)),
            Vec::<String>::new()
        );
        let cr = Mailto {
            body: "a\rb".into(),
            ..Mailto::default()
        };
        assert_ne!(
            mailto_result_problems("mailto:?body=a", Some(&cr)),
            Vec::<String>::new()
        );
    }

    const GMAIL_RESULTS: &str = "Authentication-Results: mx.google.com;\r\n       spf=pass smtp.mailfrom=a@x.example;\r\n       dmarc=pass header.from=x.example\r\nSubject: Hi\r\n\r\nbody";

    #[test]
    fn the_original_rules_accept_gmails_verdict_and_catch_each_kind_of_problem() {
        let raw = GMAIL_RESULTS.as_bytes();
        assert_eq!(original_problems(raw), Vec::<String>::new());
        assert!(!original::read(raw).checks.is_empty());
        // Wrong numbers.
        let mut read = original::read(raw);
        read.size += 1;
        assert_ne!(original_result_problems(raw, &read), Vec::<String>::new());
        let mut read = original::read(raw);
        read.truncated = true;
        assert_ne!(original_result_problems(raw, &read), Vec::<String>::new());
        let mut read = original::read(raw);
        read.source.push('x');
        assert_ne!(original_result_problems(raw, &read), Vec::<String>::new());
        // Verdicts shown for a header that isn't Gmail's.
        let other = GMAIL_RESULTS.replace("mx.google.com", "mx.evil.example");
        let mut read = original::read(other.as_bytes());
        assert!(
            read.checks.is_empty(),
            "the app shows nothing for another server's header"
        );
        read.checks = original::read(raw).checks;
        assert_ne!(
            original_result_problems(other.as_bytes(), &read),
            Vec::<String>::new()
        );
        // A broken header block is read without a verdict about its verdicts: the
        // parser recovers from it its own way.
        let spaced = GMAIL_RESULTS.replace("Authentication-Results:", "Authentication-Results :");
        assert_eq!(original_problems(spaced.as_bytes()), Vec::<String>::new());
        let garbage = format!("\t\t\x0b\r\rample\r\ns2;\r\n  {GMAIL_RESULTS}");
        assert_eq!(original_problems(garbage.as_bytes()), Vec::<String>::new());
        // A header further down, or a body line, doesn't count as the topmost.
        let buried = format!("Subject: x\r\n{GMAIL_RESULTS}");
        assert_eq!(original_problems(buried.as_bytes()), Vec::<String>::new());
        let in_body = "Subject: x\r\n\r\nAuthentication-Results: mx.google.com; spf=pass\r\n";
        assert_eq!(original_problems(in_body.as_bytes()), Vec::<String>::new());
        assert!(original::read(in_body.as_bytes()).checks.is_empty());
    }

    const PAYLOAD: &str = r#"{"id":"m1","threadId":"t1","snippet":"Hi &amp; bye","internalDate":"1700000000000",
        "payload":{"partId":"","mimeType":"multipart/mixed","headers":[
            {"name":"From","value":"\"Doe, Jane\" <jane@x.example>"},{"name":"To","value":"bob@y.example, Ann <ann@z.example>"}],
          "parts":[
            {"partId":"0","mimeType":"text/plain","filename":"","body":{"size":2,"data":"SGk="}},
            {"partId":"1","mimeType":"application/pdf","filename":"../../.zshrc","body":{"size":9,"attachmentId":"att1"}}]}}"#;

    #[test]
    fn the_cut_off_rules_check_what_is_shown_of_a_long_message() {
        let limit = original::SHOWN_BYTES;
        let head = "Subject: big\r\n\r\n";
        // Cut cleanly, through a multi-byte character, and exactly at the limit.
        for pad in [0, 1, 2, 3] {
            let mut raw = head.to_string();
            raw.push_str(&"a".repeat(limit - head.len() - pad));
            raw.push_str(&"é".repeat(pad + 10));
            let bytes = raw.as_bytes();
            assert!(bytes.len() > limit);
            assert_eq!(original_problems(bytes), Vec::<String>::new(), "pad {pad}");
        }
        let exact = format!("{head}{}", "a".repeat(limit - head.len()));
        assert_eq!(exact.len(), limit);
        assert!(!original::read(exact.as_bytes()).truncated);
        assert_eq!(original_problems(exact.as_bytes()), Vec::<String>::new());
        // Source that isn't the start of the message.
        let raw = format!("{head}{}", "a".repeat(limit));
        let mut read = original::read(raw.as_bytes());
        assert!(read.truncated);
        read.source = read.source.replacen("aaa", "aab", 1);
        assert_ne!(
            original_result_problems(raw.as_bytes(), &read),
            Vec::<String>::new()
        );
        // A cut through a character must not leave its replacement mark.
        let mut split = format!("{head}{}", "a".repeat(limit - head.len() - 1));
        split.push('é');
        let mut read = original::read(split.as_bytes());
        assert!(read.truncated && !read.source.ends_with('\u{FFFD}'));
        read.source.push('\u{FFFD}');
        assert_ne!(
            original_result_problems(split.as_bytes(), &read),
            Vec::<String>::new()
        );
        let mut read = original::read(raw.as_bytes());
        read.source.truncate(read.source.len() - 5);
        assert_ne!(
            original_result_problems(raw.as_bytes(), &read),
            Vec::<String>::new()
        );
    }

    #[test]
    fn the_message_rules_read_a_normal_message_and_clean_its_attachment_names() {
        assert_eq!(message_problems(PAYLOAD), Vec::<String>::new());
        assert_eq!(message_problems("not json"), Vec::<String>::new());
        assert_eq!(message_problems("{}"), Vec::<String>::new());
    }

    #[test]
    fn the_message_rules_reach_the_parser() {
        // The checks only mean something if the parser sees the addresses and
        // the attachment the sample holds.
        let message: Message = serde_json::from_str(PAYLOAD).expect("a message");
        let incoming = parse::message_to_incoming(&message);
        assert!(incoming.from.is_some());
        assert_eq!(incoming.to.len(), 2);
        let payload = message.payload.as_ref().expect("a payload");
        let body = parse::extract_body(payload);
        let attachments = parse::extract_attachments(payload, body.html.as_deref());
        assert_eq!(attachments.len(), 1);
        assert_eq!(attachments[0].filename, "../../.zshrc");
        assert_eq!(
            filename_problems(&attachments[0].filename),
            Vec::<String>::new()
        );
    }

    #[test]
    fn the_address_rules_catch_each_kind_of_problem() {
        let address = |name: Option<&str>, email: &str| Address {
            name: name.map(str::to_string),
            email: email.to_string(),
        };
        assert_eq!(
            address_result_problems(&address(Some("Jane Doe"), "jane@x.example")),
            Vec::<String>::new()
        );
        assert_eq!(
            address_result_problems(&address(None, "jane@x.example")),
            Vec::<String>::new()
        );
        for bad in [
            address(None, "jane"),
            address(None, " jane@x.example"),
            address(None, "jane@x.example "),
            address(Some(""), "jane@x.example"),
            address(Some(" Jane"), "jane@x.example"),
            address(Some("Jane "), "jane@x.example"),
        ] {
            assert_ne!(
                address_result_problems(&bad),
                Vec::<String>::new(),
                "{bad:?}"
            );
        }
    }

    /// Strings an email can hold, with the characters that matter to the readers.
    fn nasty_text() -> impl Strategy<Value = String> {
        let pieces: &[&str] = &[
            "mailto:",
            "MAILTO:",
            "?",
            "&",
            "=",
            "%",
            "%0D%0A",
            "%0a",
            "%00",
            "%zz",
            "%e2%80%ae",
            "+",
            "@",
            ",",
            ";",
            "<",
            ">",
            "\"",
            "\\",
            "(",
            ")",
            ":",
            ".",
            "..",
            "/",
            " ",
            "\t",
            "\r",
            "\n",
            "\0",
            "to=",
            "cc=",
            "bcc=",
            "subject=",
            "body=",
            "a@x.example",
            "Maya Chen <maya@x.example>",
            "\"Doe, Jane\" <jane@x.example>",
            "undisclosed-recipients:;",
            "CON",
            "NUL",
            "com1",
            "LPT9",
            "AUX.txt",
            "photo",
            "\u{202e}",
            "\u{200f}",
            "\u{2066}",
            "\u{200b}",
            "\u{feff}",
            "exe",
            "pdf",
            "eml",
            "あ",
            "é",
            "\u{1f600}",
            "report",
            "x",
        ];
        proptest::collection::vec(
            prop_oneof![
                4 => proptest::sample::select(pieces).prop_map(str::to_string),
                1 => "\\PC{0,6}",
            ],
            0..24,
        )
        .prop_map(|parts| parts.concat())
    }

    proptest! {
        #![proptest_config(ProptestConfig { cases: 512, ..ProptestConfig::default() })]

        #[test]
        fn any_mailto_link_is_read_sensibly(link in nasty_text()) {
            prop_assert_eq!(mailto_problems(&link), Vec::<String>::new());
            prop_assert_eq!(mailto_problems(&format!("mailto:{link}")), Vec::<String>::new());
        }

        #[test]
        fn a_link_built_from_parts_reads_back_as_the_parts(
            to in "[a-z]{1,8}@x\\.example",
            cc in "[a-z]{1,8}@y\\.example",
            subject in "[A-Za-z0-9 ]{0,16}",
            body in "[A-Za-z0-9 ]{0,16}",
        ) {
            let enc = |s: &str| percent_encoding::utf8_percent_encode(s, percent_encoding::NON_ALPHANUMERIC).to_string();
            let link = format!("mailto:{}?cc={}&subject={}&body={}", enc(&to), enc(&cc), enc(&subject), enc(&body));
            let m = mailto::parse(&link).expect("a mailto link");
            prop_assert_eq!(m.to, vec![to]);
            prop_assert_eq!(m.cc, vec![cc]);
            prop_assert_eq!(m.subject, subject);
            prop_assert_eq!(m.body, body);
        }

        #[test]
        fn any_name_comes_out_as_a_safe_file_name(name in nasty_text()) {
            prop_assert_eq!(filename_problems(&name), Vec::<String>::new());
        }

        #[test]
        fn any_raw_email_is_read_sensibly(
            top in nasty_text(),
            results in nasty_text(),
            tail in nasty_text(),
        ) {
            let raw = format!("{top}\r\nAuthentication-Results: {results}\r\nSubject: {tail}\r\n\r\n{tail}");
            prop_assert_eq!(original_problems(raw.as_bytes()), Vec::<String>::new());
            let gmail = format!("Authentication-Results: mx.google.com; {results}\r\n\r\n{tail}");
            prop_assert_eq!(original_problems(gmail.as_bytes()), Vec::<String>::new());
        }

        #[test]
        fn any_message_is_read_sensibly(
            from in nasty_text(),
            filename in nasty_text(),
            mime in nasty_text(),
            data in "[A-Za-z0-9_=-]{0,12}",
        ) {
            let json = serde_json::json!({
                "id": "m1", "threadId": "t1", "snippet": from,
                "payload": {
                    "partId": "", "mimeType": "multipart/mixed",
                    "headers": [{"name": "From", "value": from}, {"name": "To", "value": from}],
                    "parts": [
                        {"partId": "0", "mimeType": "text/html", "filename": "", "body": {"size": 1, "data": data}},
                        {"partId": "1", "mimeType": mime, "filename": filename, "body": {"size": 1, "attachmentId": "a"}},
                    ],
                },
            });
            prop_assert_eq!(message_problems(&json.to_string()), Vec::<String>::new());
        }
    }
}
