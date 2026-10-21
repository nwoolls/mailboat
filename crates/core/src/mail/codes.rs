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
    // Preheader padding (invisible joiners and spaces) can push the code
    // past the limit; leave it out first.
    let visible: String = text
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
    let start = floor_boundary(lower, at.saturating_sub(30));
    let end = ceil_boundary(lower, (at + 30).min(lower.len()));
    let near = &lower[start..end];
    NOT_SIGN_IN.iter().any(|w| near.contains(w))
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
            None if !has_body && subject_says_code(&subject) => needs_body.push(m),
            None => {}
        }
    }
    Ok((found, needs_body))
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
