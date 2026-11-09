//! Sign-in codes (one-time passcodes) in an email, to surface them without
//! opening it: in a notice as mail arrives, on the list row, in the macOS
//! notification. Found by wording, all on this Mac.
//!
//! A code is a short run of digits (4 to 8, maybe split as "123 456" or
//! "123-456") or a short mix of capitals and digits ("G-482910",
//! "XK7P2"), near words that say it's a code ("verification code",
//! "one-time password", "is your … code"). Things that look like codes
//! but aren't are left alone: promo and discount codes, years, prices,
//! phone and order numbers, ZIP codes.

use rusqlite::{Connection, OptionalExtension};

use crate::error::Result;
use crate::model::{AccountId, MessageId, ThreadId};

/// Words that hand over a sign-in code (weaker ones like "verify" or
/// "PIN" alone matched people writing about codes, and "confirmation code"
/// is an airline's booking reference).
const CODE_WORDS: &[&str] = &[
    "verification code",
    "security code",
    "sign-in code",
    "sign in code",
    "login code",
    "log-in code",
    "log in code",
    "authentication code",
    "recovery code",
    "one-time passcode",
    "one-time password",
    "one-time code",
    "one-time pin",
    "one time passcode",
    "one time password",
    "one time code",
    "single-use code",
    "one-time-use",
    // Not "passcode" alone: meeting recordings and dial-ins have those.
    "2fa code",
    "two-factor code",
    "guard code",
    "your code is",
];

/// Words that say a code is short-lived, for emails that name no kind of
/// code ("This code will expire in 10 minutes") and set the number apart,
/// often with only a button's label beside it. Only the words, never the
/// number they sit near, make it a code.
const EXPIRY_CUES: &[&str] = &[
    "this code will expire",
    "this code expires",
    "this code is valid for",
    "this code is only valid",
    "the code will expire",
    "the code expires",
    "code will expire in",
    "code expires in",
    "code is valid for",
];

/// How far from an expiry cue a number may stand and still be its code, in
/// bytes of the text (about as many characters, for the mostly ASCII text of
/// these emails).
const CUE_REACH: usize = 250;

/// Codes come first in these emails; looking further only finds numbers
/// in the small print.
const BODY_LIMIT: usize = 800;

/// "Code" in these is never a sign-in code.
const NOT_SIGN_IN: &[&str] = &[
    "promo code",
    "promotional code",
    "discount code",
    "coupon",
    "gift code",
    "referral code",
    "voucher",
    "zip code",
    "postal code",
    "area code",
    "qr code",
    "code of conduct",
    "source code",
    "dress code",
    "offer code",
    // Meeting passcodes (Zoom, Teams) in invitations.
    "meeting",
    "zoom",
    "webex",
    "dial",
    "conference",
];

/// More words that rule a number out, for the expiry cue only. A cue is
/// weaker evidence than a code word, and the same line sits in mail about
/// codes that open or claim something. Kept apart from `NOT_SIGN_IN`, which
/// the code-word path also uses: there, "your ticket account verification
/// code is 4831" is a sign-in code.
const CUE_NOT_SIGN_IN: &[&str] = &[
    "locker",
    "parking",
    "pickup",
    "pick-up",
    "parcel",
    "wi-fi",
    "wifi",
    "ticket",
    "entry code",
    "door code",
    "gift card",
    "room code",
    "booking",
    "reservation",
    "luggage",
    "reference",
];

/// How far either list's words reach around a number on the cue path.
const CUE_EXCLUDE_REACH: usize = 80;

/// A word that's only an HTML entity, like "&zwnj;" or "&#8204;".
fn is_entity(word: &str) -> bool {
    word.len() > 2
        && word.starts_with('&')
        && word.ends_with(';')
        && word[1..word.len() - 1]
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '#')
}

/// The sign-in code in an email, if it has one. `subject` and `text` are
/// what's known of it (the body, or Gmail's snippet before the body is
/// downloaded).
pub fn find(subject: &str, text: &str) -> Option<String> {
    // A reply or forward is people writing about a code, not one arriving;
    // an invitation's "passcode" is the meeting's.
    const NOT_A_CODE: &[&str] = &[
        "re:",
        "fw:",
        "fwd:",
        "aw:",
        "tr:",
        "invitation:",
        "updated invitation",
        "accepted:",
        "declined:",
        "tentatively accepted:",
        "canceled event",
        "cancelled event",
    ];
    let s = subject.trim_start().to_ascii_lowercase();
    if NOT_A_CODE.iter().any(|p| s.starts_with(p)) {
        return None;
    }
    // Links (tracking links run to hundreds of characters) and preheader
    // padding (invisible joiners and spaces) can push the code past the
    // limit; leave them out first.
    let visible: String = strip_links(text)
        .chars()
        .filter(|c| {
            !matches!(
                c,
                '\u{200b}'..='\u{200f}' | '\u{034f}' | '\u{00ad}' | '\u{feff}' | '\u{2060}'
            )
        })
        .collect::<String>()
        .split(' ')
        // Also padding spelled out as entities ("&zwnj;", Disney+'s).
        .filter(|w| !w.is_empty() && !is_entity(w))
        .collect::<Vec<_>>()
        .join(" ");
    let text = &visible[..ceil_boundary(&visible, BODY_LIMIT.min(visible.len()))];
    // "Confirmation code" is a booking's too, so it counts only when the
    // subject itself is about a code ("Your Mimestream Confirmation Code").
    let about_code = s.contains("code") && !NOT_SIGN_IN.iter().any(|w| s.contains(w));
    for part in [subject, text] {
        if let Some(code) = find_in(part, about_code) {
            return Some(code);
        }
    }
    // No word names the code, but the email says it expires soon, with a
    // number set apart nearby. Only when the subject already points to a
    // verification or code: an expiry line alone also sits in mail about
    // lockers, parking, tickets and meeting passcodes.
    if subject_unlocks_cue(subject) {
        if let Some(code) = near_expiry_cue(text) {
            return Some(code);
        }
    }
    // The subject says it's a code but the body sets it apart, sentences
    // away ("…expire in 15 minutes. 320641", Disney+): the code-like
    // number nearest the word "code".
    let subject_says = CODE_WORDS.iter().any(|w| s.contains(w));
    if subject_says {
        let lower = text.to_ascii_lowercase();
        let anchors: Vec<usize> = lower.match_indices("code").map(|(i, _)| i).collect();
        return candidates(text)
            .into_iter()
            .filter(|(at, _)| !sign_in_excluded(&lower, *at))
            .min_by_key(|(at, _)| anchors.iter().map(|a| a.abs_diff(*at)).min().unwrap_or(*at))
            .map(|(_, code)| code);
    }
    None
}

/// `text` without its web addresses (up to the next space, line break,
/// quote, angle bracket or comma, less any closing punctuation). A link is
/// never a code, and a long one hides what follows. One pass: each address
/// is found by "http" and checked, and the search carries on after it.
fn strip_links(text: &str) -> String {
    let lower = text.to_ascii_lowercase();
    let mut out = String::with_capacity(text.len());
    let mut from = 0;
    while let Some(at) = lower[from..].find("http").map(|i| from + i) {
        let after = &lower[at + 4..];
        let scheme = if after.starts_with("://") {
            7
        } else if after.starts_with("s://") {
            8
        } else {
            // "http" in a word: not an address; look on past it.
            out.push_str(&text[from..at + 4]);
            from = at + 4;
            continue;
        };
        out.push_str(&text[from..at]);
        let rest = &text[at + scheme..];
        let end = rest
            .find(|c: char| c.is_whitespace() || matches!(c, '"' | '<' | '>' | ','))
            .unwrap_or(rest.len());
        // Closing punctuation belongs to the sentence, not the address.
        let link = rest[..end].trim_end_matches(['.', ';', ':', '!', '?', ')', ']', '}', '\'']);
        out.push(' ');
        from = at + scheme + link.len();
    }
    out.push_str(&text[from..]);
    out
}

/// Whether the number at `at` is a length of time or a count ("in 1500
/// minutes", "for 3 days"): an expiry line holds one, and it is never the code.
fn is_duration(lower: &str, at: usize, code: &str) -> bool {
    // The token's end in the text: `code` has its inner spaces removed.
    let mut wanted = code.chars().filter(|c| !c.is_whitespace()).count();
    let mut end = at;
    for (i, c) in lower[at..].char_indices() {
        if wanted == 0 {
            break;
        }
        if !c.is_whitespace() {
            wanted -= 1;
        }
        end = at + i + c.len_utf8();
    }
    // The word right after the number, whole: "mins", "days", not "daylight".
    let word = lower[end..]
        .trim_start()
        .split(|c: char| !c.is_alphabetic())
        .next()
        .unwrap_or("");
    [
        "s", "sec", "secs", "second", "seconds", "min", "mins", "minute", "minutes", "h", "hr",
        "hrs", "hour", "hours", "day", "days", "week", "weeks", "month", "months",
    ]
    .contains(&word)
}

/// The code-like number nearest an expiry cue ("This code will expire in 10
/// minutes"), within `CUE_REACH`, unless the cue is about a promo or the
/// like.
fn near_expiry_cue(text: &str) -> Option<String> {
    let lower = text.to_ascii_lowercase();
    // The offsets below are `text`'s only if lowering kept its length.
    if lower.len() != text.len() {
        return None;
    }
    let cues: Vec<usize> = EXPIRY_CUES
        .iter()
        .flat_map(|cue| lower.match_indices(cue).map(|(i, _)| i))
        .filter(|&i| !cue_excluded(&lower, i))
        .collect();
    if cues.is_empty() {
        return None;
    }
    candidates(text)
        .into_iter()
        .filter(|(at, _)| !cue_excluded(&lower, *at))
        .filter(|(at, code)| !is_duration(&lower, *at, code))
        .filter_map(|(at, code)| {
            let reach = cues.iter().map(|c| c.abs_diff(at)).min()?;
            (reach <= CUE_REACH).then_some((reach, code))
        })
        .min_by_key(|(reach, _)| *reach)
        .map(|(_, code)| code)
}

fn find_in(text: &str, about_code: bool) -> Option<String> {
    let lower = text.to_lowercase();
    // ASCII lowercasing would keep offsets; `to_lowercase` may not, so work
    // on the lowered text for both finding and cutting.
    if lower.len() != text.len() {
        return find_in(&text.to_ascii_lowercase(), about_code).map(|c| c.to_uppercase());
    }
    let mut best: Option<(usize, String)> = None;
    let extra: &[&str] = if about_code {
        &["confirmation code"]
    } else {
        &[]
    };
    for word in CODE_WORDS.iter().chain(extra) {
        let mut from = 0;
        while let Some(i) = lower[from..].find(word).map(|i| from + i) {
            from = i + word.len();
            if !is_whole_word(&lower, i, word.len()) || sign_in_excluded(&lower, i) {
                continue;
            }
            // Codes come right after the words ("code: 123456") or right
            // before them ("123456 is your code"), in the same sentence.
            let after = window(text, from, 90, true);
            let before = window(text, i, 40, false);
            // The first code after the words, else the last one before.
            let nearest = candidates(after.1)
                .into_iter()
                .map(|(o, c)| (after.0 + o, c))
                .next()
                .or_else(|| {
                    candidates(before.1)
                        .into_iter()
                        .last()
                        .map(|(o, c)| (before.0 + o, c))
                });
            if let Some((offset, candidate)) = nearest {
                let distance = offset.abs_diff(i);
                if best.as_ref().is_none_or(|(d, _)| distance < *d) {
                    best = Some((distance, candidate));
                }
            }
        }
    }
    best.map(|(_, code)| code)
}

fn is_whole_word(lower: &str, at: usize, len: usize) -> bool {
    let before = lower[..at].chars().next_back();
    let after = lower[at + len..].chars().next();
    let edge = |c: Option<char>| c.is_none_or(|c| !c.is_alphanumeric());
    edge(before) && edge(after)
}

fn sign_in_excluded(lower: &str, at: usize) -> bool {
    near_any(lower, at, 30, NOT_SIGN_IN)
}

/// On the cue path: either list's words, further out.
fn cue_excluded(lower: &str, at: usize) -> bool {
    near_any(lower, at, CUE_EXCLUDE_REACH, NOT_SIGN_IN)
        || near_any(lower, at, CUE_EXCLUDE_REACH, CUE_NOT_SIGN_IN)
}

fn near_any(lower: &str, at: usize, reach: usize, words: &[&str]) -> bool {
    let start = floor_boundary(lower, at.saturating_sub(reach));
    let end = ceil_boundary(lower, (at + reach).min(lower.len()));
    let near = &lower[start..end];
    words.iter().any(|w| near.contains(w))
}

/// Up to `len` bytes after (or before) `at`, stopping at the end of the
/// sentence (or, before `at`, the line). Returns the window's start offset and its text.
fn window(text: &str, at: usize, len: usize, forward: bool) -> (usize, &str) {
    if forward {
        let end = ceil_boundary(text, (at + len).min(text.len()));
        let slice = &text[at..end];
        let stop = slice
            .char_indices()
            // Line breaks don't end it: codes often sit on a line of
            // their own under "Your code is below".
            .find(|&(i, c)| c == '.' && is_sentence_end(slice, i))
            .map_or(slice.len(), |(i, _)| i);
        (at, &slice[..stop])
    } else {
        let start = floor_boundary(text, at.saturating_sub(len));
        let slice = &text[start..at];
        let from = slice.rfind(['\n', '.', '!', '?']).map_or(0, |i| i + 1);
        (start + from, &slice[from..])
    }
}

/// A period that ends a sentence (not inside "1.5" or "example.com").
fn is_sentence_end(s: &str, i: usize) -> bool {
    s[i + 1..].chars().next().is_none_or(char::is_whitespace)
}

fn floor_boundary(s: &str, mut i: usize) -> usize {
    while !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

fn ceil_boundary(s: &str, mut i: usize) -> usize {
    while i < s.len() && !s.is_char_boundary(i) {
        i += 1;
    }
    i
}

/// Code-like tokens in a short stretch of text, with their offsets.
fn candidates(text: &str) -> Vec<(usize, String)> {
    let mut out = Vec::new();
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if !bytes[i].is_ascii_alphanumeric() {
            i += 1;
            continue;
        }
        // A token: letters, digits, and single inner spaces or hyphens
        // between digit groups ("123 456", "G-482910").
        let start = i;
        let mut end = i;
        while end < bytes.len() {
            let c = bytes[end];
            let joins_digits = (c == b'-' || c == b' ')
                && end + 1 < bytes.len()
                && bytes[end + 1].is_ascii_digit()
                && bytes[end - 1].is_ascii_alphanumeric()
                && (c == b'-' || bytes[end - 1].is_ascii_digit());
            if c.is_ascii_alphanumeric() || joins_digits {
                end += 1;
            } else {
                break;
            }
        }
        let token = &text[start..end];
        let prev = text[..start].chars().next_back();
        let next = text[end..].chars().next();
        if let Some(code) = as_code(token, prev, next) {
            out.push((start, code));
        }
        i = end.max(start + 1);
    }
    out
}

fn as_code(token: &str, prev: Option<char>, next: Option<char>) -> Option<String> {
    // Money, numbers, percentages, emails and links aren't codes.
    if matches!(prev, Some('$' | '£' | '€' | '#' | '+' | '@' | '/' | '.'))
        || matches!(next, Some('%' | '@' | '/'))
    {
        return None;
    }
    let compact: String = token.chars().filter(|c| *c != ' ').collect();
    let digits = compact.chars().filter(char::is_ascii_digit).count();
    let letters = compact.chars().filter(char::is_ascii_alphabetic).count();
    let plain = compact.replace('-', "");
    if letters == 0 {
        // 4 to 8 digits; not a year.
        if !(4..=8).contains(&plain.len()) {
            return None;
        }
        let year = |y: &str| y.len() == 4 && (y.starts_with("19") || y.starts_with("20"));
        // A year, or a range of them ("© 1999-2026").
        if year(&plain) || compact.split('-').filter(|p| !p.is_empty()).all(year) {
            return None;
        }
        return Some(compact);
    }
    // Capitals and digits ("G-482910", "XK7P2"): 5 to 10 long, some digits,
    // all capitals (words in the text are never all-caps codes with digits).
    if (5..=10).contains(&plain.len())
        && digits >= 1
        && compact
            .chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '-')
    {
        return Some(compact);
    }
    None
}

/// The code in one message, from its subject and Gmail's snippet and, when
/// the subject says or hints there is one and the snippet shows none, from the
/// body if it has been downloaded. For a row and a banner, which only know the
/// snippet unless this looks further: Gmail's snippet is short and often ends
/// before the line that makes a number a code.
pub fn find_cached(
    conn: &Connection,
    subject: &str,
    snippet: &str,
    message: MessageId,
) -> Option<String> {
    if let Some(code) = find(subject, snippet) {
        return Some(code);
    }
    if !may_hold_code(subject) {
        return None;
    }
    let (text, html): (Option<String>, Option<String>) = conn
        .query_row(
            "SELECT text, html FROM message_bodies WHERE message_id = ?1",
            [message],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .ok()??;
    let body = text.or_else(|| html.as_deref().map(crate::gmail::parse::html_to_text))?;
    find(subject, &body)
}

/// Whether the subject makes the body worth reading for a code: it says or
/// hints at one, and isn't a reply or forward (people writing about a code).
pub fn may_hold_code(subject: &str) -> bool {
    let s = subject.trim_start().to_ascii_lowercase();
    !["re:", "fw:", "fwd:"].iter().any(|p| s.starts_with(p))
        && (subject_says_code(subject) || subject_hints_code(subject))
}

/// The newest message of a conversation, whose snippet its row shows, with its
/// own subject (the conversation's is the first message's).
pub fn latest_message(conn: &Connection, thread: ThreadId) -> Option<(MessageId, String)> {
    conn.query_row(
        "SELECT id, subject FROM messages WHERE thread_id = ?1
         ORDER BY internal_date DESC, id DESC LIMIT 1",
        [thread],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .optional()
    .ok()?
}

/// A sign-in code in a message that just arrived.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ArrivedCode {
    pub message_id: MessageId,
    pub thread_id: ThreadId,
    pub account_id: AccountId,
    pub code: String,
    /// The sender's name, or address.
    pub sender: String,
    pub subject: String,
}

/// Codes in these new messages, from what's cached: the subject, Gmail's
/// snippet and the body if downloaded. `needs_body` lists the messages
/// whose subject says they hold a code that wasn't found yet: worth
/// downloading the body and asking again.
pub fn in_messages(
    conn: &Connection,
    messages: &[MessageId],
) -> Result<(Vec<ArrivedCode>, Vec<MessageId>)> {
    let mut found = Vec::new();
    let mut needs_body = Vec::new();
    for &m in messages {
        let row = conn
            .query_row(
                "SELECT m.thread_id, m.account_id, m.from_name, m.from_email, m.subject, m.snippet,
                        b.text, b.html,
                        EXISTS (SELECT 1 FROM message_labels ml JOIN labels l ON l.id = ml.label_id
                                WHERE ml.message_id = m.id AND l.gmail_label_id = 'SPAM')
                 FROM messages m LEFT JOIN message_bodies b ON b.message_id = m.id
                 WHERE m.id = ?1",
                [m],
                |r| {
                    Ok((
                        r.get::<_, ThreadId>(0)?,
                        r.get::<_, AccountId>(1)?,
                        r.get::<_, Option<String>>(2)?,
                        r.get::<_, String>(3)?,
                        r.get::<_, String>(4)?,
                        r.get::<_, String>(5)?,
                        r.get::<_, Option<String>>(6)?,
                        r.get::<_, Option<String>>(7)?,
                        r.get::<_, bool>(8)?,
                    ))
                },
            )
            .optional()?;
        let Some((thread, account, name, email, subject, snippet, text, html, spam)) = row else {
            continue;
        };
        if spam {
            continue;
        }
        let has_body = text.is_some() || html.is_some();
        let body = text
            .or_else(|| html.as_deref().map(crate::gmail::parse::html_to_text))
            .unwrap_or(snippet);
        match find(&subject, &body) {
            Some(code) => found.push(ArrivedCode {
                message_id: m,
                thread_id: thread,
                account_id: account,
                code,
                sender: name.filter(|n| !n.trim().is_empty()).unwrap_or(email),
                subject,
            }),
            None if !has_body && (subject_says_code(&subject) || subject_hints_code(&subject)) => {
                needs_body.push(m)
            }
            None => {}
        }
    }
    Ok((found, needs_body))
}

/// Whether the subject lets an expiry line in the body count: it says there
/// is a code, or points to a verification ("verify", "verification"; not
/// "passcode" or "one-time", which also name meeting and access codes).
fn subject_unlocks_cue(subject: &str) -> bool {
    let s = subject.to_ascii_lowercase();
    let points = ["verify", "verification"].iter().any(|w| s.contains(w))
        && !NOT_SIGN_IN.iter().any(|w| s.contains(w))
        && !CUE_NOT_SIGN_IN.iter().any(|w| s.contains(w))
        && !["re:", "fw:", "fwd:"]
            .iter()
            .any(|p| s.trim_start().starts_with(p));
    points || subject_says_code(subject)
}

/// The subject only hints that the email may hold a sign-in code ("Please
/// verify your address"). Never a claim: it makes the body worth downloading
/// to look for one, and lets an expiry line in the body count; the body has
/// to say so itself. "Verified" and "unverified" don't hint.
pub fn subject_hints_code(subject: &str) -> bool {
    let s = subject.to_ascii_lowercase();
    ["verify", "verification", "one-time", "one time", "passcode"]
        .iter()
        .any(|w| s.contains(w))
        && !NOT_SIGN_IN.iter().any(|w| s.contains(w))
        && !CUE_NOT_SIGN_IN.iter().any(|w| s.contains(w))
        && !["re:", "fw:", "fwd:"]
            .iter()
            .any(|p| s.trim_start().starts_with(p))
}

/// The subject says the email holds a sign-in code.
pub fn subject_says_code(subject: &str) -> bool {
    let s = subject.to_ascii_lowercase();
    CODE_WORDS.iter().any(|w| s.contains(w)) && !NOT_SIGN_IN.iter().any(|w| s.contains(w))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_codes_as_services_send_them() {
        let cases = [
            ("G-482910 is your Google verification code", "", "G-482910"),
            ("Your Apple Account code", "Your verification code is: 731905", "731905"),
            ("Microsoft account security code", "Please use the following security code for the Microsoft account. Security code: 4920817", "4920817"),
            ("[GitHub] Please verify your device", "Verification code: 50133418\nIf you did not attempt to sign in...", "50133418"),
            ("Your one-time password", "Your one-time password is 123 456. It expires in 10 minutes.", "123456"),
            ("Steam Guard", "Here is the Steam Guard code you need to login: XK7P2", "XK7P2"),
            ("Sign in to Slack", "Your sign-in code is below\n\n481-772\n\nEnter it in your browser", "481-772"),
            ("", "Use 8841 as your login code. Do not share it.", "8841"),
            ("433338 is your X verification code", "", "433338"),
            ("Your single-use code", "Hi, We received your request for a single-use code. Your single-use code is: 813158 Only enter this code", "813158"),
            ("Your Mimestream Confirmation Code", "137613 is your confirmation code.", "137613"),
            ("Your one-time passcode for Disney+", &format!("Here's your one-time passcode {}\n\n482913", "\u{200c} ".repeat(400)), "482913"),
            ("Your one-time passcode for Disney+", &format!("Here's your one-time passcode {}\n\n482913", "&zwnj; ".repeat(200)), "482913"),
            ("Your one-time passcode for Disney+", "96 MyDisney Email Here's your one-time passcode for Disney+ Use this passcode to verify the email address associated with your MyDisney account. It will expire in 15 minutes. 320641 If you did not make this request, please visit our Help Center.", "320641"),
        ];
        for (subject, text, want) in cases {
            assert_eq!(
                find(subject, text).as_deref(),
                Some(want),
                "{subject} / {text}"
            );
        }
    }

    #[test]
    fn leaves_things_that_only_look_like_codes() {
        let cases = [
            (
                "Save 20% today",
                "Use promo code SAVE20 at checkout. Offer ends 2026.",
            ),
            (
                "Order #123456 has shipped",
                "Your order #123456 is on its way. Total $45.99.",
            ),
            (
                "Your statement is ready",
                "Your statement for account ending in 7210 is ready. Call 1-800-555-0142.",
            ),
            (
                "Meeting moved",
                "The review moved to Thursday 3pm in room 4B.",
            ),
            (
                "Welcome to 2026",
                "Happy new year! Your PIN reminder: visit the site to reset.",
            ),
            ("Shipping update", "Delivery to ZIP code 04107 on Monday."),
            (
                "Here's your one-time-use support code.",
                "Questions? Call us. Copyright 1999-2026 GoDaddy Operating Company",
            ),
            (
                "Re: 25328546 is your Facebook account recovery code",
                "Thanks, that worked.",
            ),
            (
                "It's time to check in - JHSDBD",
                "Your confirmation code: JHSDBD. Flight 3008 departs at 6:05.",
            ),
        ];
        for (subject, text) in cases {
            assert_eq!(find(subject, text), None, "{subject} / {text}");
        }
    }

    /// A made-up email shaped like one the owner reported: the number alone
    /// at the top with a button's label beside it, a link of hundreds of
    /// characters, and only then a line saying the code expires. Nothing in
    /// it names the kind of code.
    fn link() -> String {
        format!(
            "http://links.x.example/ls/click?upn={}",
            "Ab3d-2B".repeat(130)
        )
    }

    fn set_apart_text() -> String {
        format!(
            " 4821 or Confirm Address ( {} )\n\nNote: this code expires in 15 minutes. If this wasn't you, ignore this message.\nNobody reads replies sent to this mailbox.\n\nSent by Example Mail Checks\n{} ( {} )",
            link(),
            link(),
            link()
        )
    }

    const SET_APART_SUBJECT: &str = "Please verify your address";

    #[test]
    fn finds_a_code_set_apart_with_only_an_expiry_line() {
        assert_eq!(
            find(SET_APART_SUBJECT, &set_apart_text()),
            Some("4821".into())
        );
    }

    #[test]
    fn finds_it_in_the_html_too() {
        let html = format!(
            "<html><head><style>body {{ font-size: 14px; }}</style></head><body><table>\
             <tr><td><img src=\"https://img.x.example/logo\"/></td></tr>\
             <tr><td class=\"big\">4821</td></tr><tr><td>or</td></tr>\
             <tr><td><a href=\"{}\">Confirm Address</a></td></tr>\
             <tr><td>Note:</td></tr>\
             <tr><td>This code expires in 15 minutes.</td></tr>\
             <tr><td>If this wasn't you, ignore this message.</td></tr>\
             </table></body></html>",
            link()
        );
        let text = crate::gmail::parse::html_to_text(&html);
        assert_eq!(find(SET_APART_SUBJECT, &text), Some("4821".into()));
    }

    #[test]
    fn a_long_link_does_not_hide_the_code_words_behind_it() {
        let text = format!(
            "Open the page ( {} ) to continue.\nYour verification code is 5512",
            link()
        );
        assert!(text.len() > BODY_LIMIT);
        assert_eq!(find("", &text), Some("5512".into()));
    }

    #[test]
    fn an_expiry_line_alone_does_not_make_a_number_a_code() {
        let far = format!(
            "1234 {}This code will expire in 10 minutes",
            "word ".repeat(120)
        );
        let cases = [
            (
                "Your coupon",
                "Use coupon SAVE2026X. This code will expire in 10 days.",
            ),
            (
                "Your offer",
                "Take 15% off with the discount code SPRING24. This code will expire on Friday.",
            ),
            (
                "Order shipped",
                "Order 48213 shipped. Tracking number 77120934 is on its way.",
            ),
            ("Welcome", "This code will expire in 10 minutes"),
            ("Email verification", far.as_str()),
            (
                "Invitation: Standup",
                "Dial in with 482913. This code will expire in 10 minutes.",
            ),
        ];
        for (subject, text) in cases {
            assert_eq!(find(subject, text), None, "{subject} / {text:.40}");
        }
    }

    /// The expiry line alone must not make a number a code: it also sits in
    /// mail about lockers, parking, tickets, gift cards and meeting
    /// passcodes. It counts only when the subject points to a verification.
    #[test]
    fn an_expiry_line_counts_only_under_a_subject_that_points_to_a_verification() {
        let without_a_hint = [
            ("Your locker pickup", "Locker code 4821 is ready.\nThis code expires in 3 days."),
            ("Delivery access", "Door code for the courier: 551234\nThis code is valid for today only."),
            ("Parking permit", "Your parking code 99102\nThe code expires at 6pm."),
            ("Gift card ready", "Card code 847291.\nThanks for shopping.\nThis code is valid for 90 days."),
            ("Your tickets", "Event entry code: 229184\nShow this at the door.\nThis code expires after the event."),
            ("Order ready for pickup", "Pick-up code: 4410\nThis code will expire in 2 hours."),
            ("Guest Wi-Fi", "WiFi code 33881\nThis code expires when you check out."),
            ("Member reward", "Use 7721 at checkout. Terms apply to every order placed this season, in store or online. This code will expire in 10 days."),
            // A meeting passcode, with no "Invitation:" and nothing near it.
            ("Standup tomorrow", "Access code: 482913\n\nJoin five minutes early if you can.\nThis code will expire in 10 minutes."),
        ];
        for (subject, text) in without_a_hint {
            assert_eq!(find(subject, text), None, "{subject}");
        }
        // The same body under a subject that points to a verification.
        assert_eq!(
            find(
                "Please verify your address",
                "Access code: 482913\n\nJoin five minutes early if you can.\nThis code will expire in 10 minutes."
            ),
            Some("482913".into())
        );
        // And a hinting subject still doesn't override what the words near the number say.
        for (subject, text) in [
            (
                "Please verify",
                "Locker code 4821 is ready.\nThis code expires in 3 days.",
            ),
            (
                "Please verify",
                "Gift card 847291 is yours.\nThis code is valid for 90 days.",
            ),
        ] {
            assert_eq!(find(subject, text), None, "{subject} / {text:.30}");
        }
    }

    /// Words that only the expiry cue needs to rule out must not cost the
    /// code-word path a code it found before ("your ticket account
    /// verification code is …").
    #[test]
    fn the_cue_s_extra_exclusions_leave_the_code_word_path_alone() {
        for (subject, text) in [
            ("Welcome", "Your ticket account verification code is 4831."),
            (
                "",
                "Have your ticket ready. Your verification code is 4831.",
            ),
            ("", "Acme Locker Co verification code: 4831"),
            ("", "Your parking garage verification code is 4831"),
            ("", "Connect to wifi first. Your login code is 4831."),
        ] {
            assert_eq!(find(subject, text), Some("4831".into()), "{text}");
        }
    }

    /// A subject that points to a verification still doesn't turn a booking,
    /// a room or an access code into a sign-in code, and only "verify" and
    /// "verification" unlock the cue: "passcode" and "one-time" also name
    /// meeting and access codes.
    #[test]
    fn a_pointing_subject_does_not_turn_other_codes_into_sign_in_codes() {
        let meeting = "Access code: 482913\n\nJoin five minutes early if you can.\nThis code will expire in 10 minutes.";
        for (subject, text) in [
            ("Please verify", "Your booking is ready. Collect your luggage at the desk. 4821\nThis code expires in 3 days."),
            ("Please verify your visit", "Room code 5512\nThis code expires in 2 hours."),
            ("Verify your reservation", "Booking reference 884421\nThis code will expire in 24 hours if unused."),
            ("Standup passcode", meeting),
            ("Your passcode for today", "551234\nThis code is valid for today only."),
            ("Your one-time access", "551234\nThis code is valid for today only."),
        ] {
            assert_eq!(find(subject, text), None, "{subject} / {text:.30}");
        }
        // Whereas the same shape under a plain verification subject is a code.
        assert_eq!(
            find(
                "Please verify your address",
                "551234\nThis code is valid for today only."
            ),
            Some("551234".into())
        );
    }

    /// Abbreviated units count as a length of time, as whole words.
    #[test]
    fn abbreviated_times_are_times_too() {
        let subject = "Please verify your address";
        for text in [
            "This code expires in 1500 mins.",
            "This code expires in 1500 hrs.",
            "This code expires in 9000 secs.",
        ] {
            assert_eq!(find(subject, text), None, "{text}");
        }
        // A word that only starts like a unit ("daylight") doesn't make it one.
        assert_eq!(
            find(
                subject,
                "Code: 4821 daylight. This code expires soon, in the evening."
            ),
            Some("4821".into()),
        );
    }

    /// The length of time in the expiry line is never the code.
    #[test]
    fn the_time_in_an_expiry_line_is_not_the_code() {
        let subject = "Please verify your address";
        for text in [
            "Access is available now. This code expires in 1500 minutes. Your code: 4831",
            "Your code: 4831. Access is available now. This code expires in 1500 minutes.",
            "Code 4831 (good for 2 hours)\nThis code will expire in 120 minutes.",
        ] {
            assert_eq!(find(subject, text), Some("4831".into()), "{text}");
        }
        assert_eq!(
            find(
                subject,
                "Access is available now. This code expires in 1500 minutes."
            ),
            None
        );
    }

    /// A link comes out; the sentence around it stays.
    #[test]
    fn links_leave_the_words_beside_them() {
        for (text, code) in [
            ("Read https://x.example,verification code 4831", "4831"),
            (
                "Go to https://x.example/a/b. Your verification code is 5512",
                "5512",
            ),
            ("(https://x.example/p) Your login code is 7781", "7781"),
            (
                "See <https://x.example/q> then use your login code 9034",
                "9034",
            ),
            ("the xhttp5555 page. Your login code is 8811", "8811"),
            ("HTTPS://X.EXAMPLE/Z Your verification code: 6120", "6120"),
        ] {
            assert_eq!(find("", text), Some(code.into()), "{text}");
        }
        assert!(!strip_links("a https://x.example/long?q=1 b").contains("example"));
        assert_eq!(
            strip_links("no links, http alone, https:// or httpx"),
            "no links, http alone, https:// or httpx".replace("https://", " ")
        );
    }

    /// Taking out links is one pass: a body of tens of thousands of them
    /// (the database is held while it is read) takes no time to read.
    #[test]
    fn a_body_of_thousands_of_links_is_read_in_one_pass() {
        let body = "see http://a.example/x ".repeat(50_000);
        let started = std::time::Instant::now();
        let stripped = strip_links(&body);
        assert!(started.elapsed() < std::time::Duration::from_secs(3));
        assert!(!stripped.contains("example"));
        assert_eq!(find("Please verify", &body), None);
    }

    #[test]
    fn a_subject_that_hints_at_a_code_is_worth_a_look_but_never_a_claim() {
        for yes in [
            "Please verify your address",
            "Verify your email",
            "Your one-time link",
            "Confirm: passcode inside",
        ] {
            assert!(subject_hints_code(yes), "{yes}");
        }
        for no in [
            "Weekly digest",
            "Account verified successfully",
            "UNVERIFIED sender report",
            "Re: email verification",
            "Fwd: Verify your email",
            "Verify your coupon offer",
            "Invitation: verification meeting",
        ] {
            assert!(!subject_hints_code(no), "{no}");
        }
        // And a hint alone finds nothing.
        assert_eq!(find("Verify your email", "Click the button below."), None);
    }

    /// A made-up email shaped like the one that was missed: a hinting subject,
    /// and a snippet with the number and the start of a link but not the line
    /// that says the code expires. Returns its message and conversation.
    fn seed_hinting_message(db: &crate::db::Db, label: &str) -> (MessageId, ThreadId) {
        use crate::db::accounts;
        use crate::db::store::{upsert_thread, IncomingMessage, IncomingThread};
        use crate::model::Address;
        let account = accounts::upsert(
            &db.conn(),
            &accounts::NewAccount {
                google_sub: "a",
                email: "a@x.example",
                display_name: None,
                avatar_url: None,
                oauth_client: "default",
            },
        )
        .unwrap()
        .id;
        let mut conn = db.conn();
        let thread = upsert_thread(
            &mut conn,
            account,
            &IncomingThread {
                gmail_thread_id: "t1".into(),
                messages: vec![IncomingMessage {
                    gmail_message_id: "m1".into(),
                    label_ids: vec![label.into()],
                    internal_date: crate::db::now_millis(),
                    subject: SET_APART_SUBJECT.into(),
                    snippet: format!(" 4821 or Confirm Address ( {:.60}", link()),
                    from: Some(Address {
                        name: None,
                        email: "noreply@verify.x.example".into(),
                    }),
                    ..Default::default()
                }],
            },
        )
        .unwrap();
        let m: MessageId = conn
            .query_row("SELECT id FROM messages", [], |r| r.get(0))
            .unwrap();
        (m, thread)
    }

    fn download_body(db: &crate::db::Db, m: MessageId) {
        use crate::db::store::{set_body, StoredBody};
        set_body(
            &mut db.conn(),
            m,
            &StoredBody {
                html: None,
                text: Some(set_apart_text()),
            },
            &[],
        )
        .unwrap();
    }

    #[test]
    fn a_hinting_subject_asks_for_the_body_and_then_finds_the_code() {
        let db = crate::db::Db::open_in_memory().unwrap();
        let (m, _) = seed_hinting_message(&db, "INBOX");
        // Before the body: nothing to show, but worth downloading it.
        let (found, needs_body) = in_messages(&db.conn(), &[m]).unwrap();
        assert!(found.is_empty());
        assert_eq!(needs_body, vec![m]);
        // With it: the code.
        download_body(&db, m);
        let (found, needs_body) = in_messages(&db.conn(), &[m]).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].code, "4821");
        assert!(needs_body.is_empty());
    }

    #[test]
    fn a_downloaded_body_gives_the_row_and_the_banner_the_code() {
        use crate::db::query::thread_summary;
        let db = crate::db::Db::open_in_memory().unwrap();
        let (m, thread) = seed_hinting_message(&db, "INBOX");
        let account = thread_summary(&db.conn(), thread).unwrap().account_id;
        // On the snippet alone, neither has a code.
        assert_eq!(
            thread_summary(&db.conn(), thread).unwrap().sign_in_code,
            None
        );
        let before = crate::mail::notify::notices(&db.conn(), account, &[m], None).unwrap();
        assert_eq!(before[0].title, "noreply@verify.x.example");
        // With the body downloaded, both read it.
        download_body(&db, m);
        assert_eq!(
            thread_summary(&db.conn(), thread)
                .unwrap()
                .sign_in_code
                .as_deref(),
            Some("4821")
        );
        let after = crate::mail::notify::notices(&db.conn(), account, &[m], None).unwrap();
        assert_eq!(after[0].title, "4821 · noreply@verify.x.example");
        assert!(after[0].body.starts_with("Sign-in code · "));
    }

    #[test]
    fn a_body_is_read_only_for_a_subject_that_says_or_hints_at_a_code() {
        use crate::db::query::thread_summary;
        let db = crate::db::Db::open_in_memory().unwrap();
        let (m, thread) = seed_hinting_message(&db, "INBOX");
        download_body(&db, m);
        // The same body under an ordinary subject is no code.
        db.conn()
            .execute("UPDATE messages SET subject = 'Your weekly digest'", [])
            .unwrap();
        db.conn()
            .execute("UPDATE threads SET subject = 'Your weekly digest'", [])
            .unwrap();
        assert_eq!(
            thread_summary(&db.conn(), thread).unwrap().sign_in_code,
            None
        );
        assert_eq!(
            find_cached(&db.conn(), "Your weekly digest", "4821 or Confirm", m),
            None
        );
    }

    #[test]
    fn a_reply_that_quotes_the_code_does_not_bring_the_pill_back() {
        use crate::db::query::thread_summary;
        use crate::db::store::{upsert_thread, IncomingMessage, IncomingThread};
        let db = crate::db::Db::open_in_memory().unwrap();
        let (m, thread) = seed_hinting_message(&db, "INBOX");
        download_body(&db, m);
        let account = thread_summary(&db.conn(), thread).unwrap().account_id;
        assert_eq!(
            thread_summary(&db.conn(), thread)
                .unwrap()
                .sign_in_code
                .as_deref(),
            Some("4821")
        );
        // A reply in the same conversation, whose body quotes the original.
        let now = crate::db::now_millis();
        let original = format!(" 4821 or Confirm Address ( {:.60}", link());
        upsert_thread(
            &mut db.conn(),
            account,
            &IncomingThread {
                gmail_thread_id: "t1".into(),
                messages: vec![
                    IncomingMessage {
                        gmail_message_id: "m1".into(),
                        label_ids: vec!["INBOX".into()],
                        internal_date: now - 1_000,
                        subject: SET_APART_SUBJECT.into(),
                        snippet: original,
                        ..Default::default()
                    },
                    IncomingMessage {
                        gmail_message_id: "m2".into(),
                        label_ids: vec!["INBOX".into()],
                        internal_date: now,
                        subject: format!("Re: {SET_APART_SUBJECT}"),
                        snippet: "Thanks, that worked.".into(),
                        ..Default::default()
                    },
                ],
            },
        )
        .unwrap();
        let reply: MessageId = db
            .conn()
            .query_row(
                "SELECT id FROM messages WHERE gmail_message_id = 'm2'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        crate::db::store::set_body(
            &mut db.conn(),
            reply,
            &crate::db::store::StoredBody {
                html: None,
                text: Some(format!("Thanks, that worked.\n\n> {}", set_apart_text())),
            },
            &[],
        )
        .unwrap();
        assert_eq!(
            thread_summary(&db.conn(), thread).unwrap().sign_in_code,
            None
        );
    }

    #[test]
    fn a_reply_with_a_code_word_subject_and_a_quoted_snippet_shows_no_pill() {
        use crate::db::query::thread_summary;
        use crate::db::store::{upsert_thread, IncomingMessage, IncomingThread};
        let db = crate::db::Db::open_in_memory().unwrap();
        let (_, thread) = seed_hinting_message(&db, "INBOX");
        let account = thread_summary(&db.conn(), thread).unwrap().account_id;
        let now = crate::db::now_millis();
        let subject = "Your example account security code";
        let message = |id: &str, at: i64, subject: String, snippet: &str| IncomingMessage {
            gmail_message_id: id.into(),
            label_ids: vec!["INBOX".into()],
            internal_date: at,
            subject,
            snippet: snippet.into(),
            ..Default::default()
        };
        // The conversation's own subject is the first message's: a code word
        // that would show a pill on the quoted code in the reply's snippet.
        upsert_thread(
            &mut db.conn(),
            account,
            &IncomingThread {
                gmail_thread_id: "t2".into(),
                messages: vec![
                    message("n1", now - 1_000, subject.into(), "Security code: 4920817"),
                    message(
                        "n2",
                        now,
                        format!("Re: {subject}"),
                        "> Security code: 4920817 Thanks, that worked.",
                    ),
                ],
            },
        )
        .unwrap();
        let id: ThreadId = db
            .conn()
            .query_row(
                "SELECT thread_id FROM messages WHERE gmail_message_id = 'n2'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(thread_summary(&db.conn(), id).unwrap().sign_in_code, None);
        // The first message alone does show one.
        db.conn()
            .execute("DELETE FROM messages WHERE gmail_message_id = 'n2'", [])
            .unwrap();
        assert_eq!(
            thread_summary(&db.conn(), id)
                .unwrap()
                .sign_in_code
                .as_deref(),
            Some("4920817")
        );
    }

    #[test]
    fn only_so_many_rows_of_a_page_read_a_body() {
        use crate::db::query::list_threads;
        use crate::db::store::{upsert_thread, IncomingMessage, IncomingThread};
        use crate::model::{AccountFilter, ListQuery, MailView, SystemLabel};
        let db = crate::db::Db::open_in_memory().unwrap();
        let (_, first) = seed_hinting_message(&db, "INBOX");
        let account = crate::db::query::thread_summary(&db.conn(), first)
            .unwrap()
            .account_id;
        let now = crate::db::now_millis();
        // Twenty-four more, each a verification email whose snippet shows
        // no code and whose body has one.
        for n in 0..24 {
            upsert_thread(
                &mut db.conn(),
                account,
                &IncomingThread {
                    gmail_thread_id: format!("many{n}"),
                    messages: vec![IncomingMessage {
                        gmail_message_id: format!("many{n}"),
                        label_ids: vec!["INBOX".into()],
                        internal_date: now - n,
                        subject: SET_APART_SUBJECT.into(),
                        snippet: "Confirm Address".into(),
                        ..Default::default()
                    }],
                },
            )
            .unwrap();
        }
        let ids: Vec<MessageId> = db
            .conn()
            .prepare("SELECT id FROM messages")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        for id in ids {
            download_body(&db, id);
        }
        let page = list_threads(
            &db.conn(),
            &ListQuery {
                accounts: AccountFilter::All,
                view: MailView::System {
                    label: SystemLabel::Inbox,
                },
                cursor: None,
                limit: 100,
            },
        )
        .unwrap();
        assert_eq!(page.threads.len(), 25);
        let shown = page
            .threads
            .iter()
            .filter(|t| t.sign_in_code.is_some())
            .count();
        assert_eq!(shown, 20, "a page reads 20 bodies, no more");
    }

    #[test]
    fn a_row_in_spam_shows_no_code_from_its_body() {
        use crate::db::query::thread_summary;
        let db = crate::db::Db::open_in_memory().unwrap();
        let (m, thread) = seed_hinting_message(&db, "SPAM");
        download_body(&db, m);
        let row = thread_summary(&db.conn(), thread).unwrap();
        assert!(row.in_spam);
        assert_eq!(row.sign_in_code, None);
    }

    #[test]
    fn the_nearest_code_to_the_words_wins() {
        assert_eq!(
            find(
                "",
                "Order 99881 confirmed.\nYour verification code is 551203."
            ),
            Some("551203".into())
        );
    }
}
