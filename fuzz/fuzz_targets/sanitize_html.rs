#![no_main]
//! The email HTML cleaner (`mail::sanitize`) on any input: whatever an email
//! holds, what comes out must pass `mail::sanitize_check` (no script, no
//! event handler, no unsafe link, no remote image while images are held
//! back, the app's CSP first). A failure is a security bug.
//!
//! The first byte picks the reader's choices (bit 0: images allowed, bit 1:
//! the email's original colors); the rest is the email's HTML, read as UTF-8
//! with bad bytes replaced, as the app reads a body it couldn't decode. The
//! same input also goes through the plain-text path.

use std::collections::HashMap;

use libfuzzer_sys::fuzz_target;
use mail_core::mail::{sanitize, sanitize_check};

fuzz_target!(|data: &[u8]| {
    let Some((&choices, rest)) = data.split_first() else {
        return;
    };
    let allow_images = choices & 1 != 0;
    let original_colors = choices & 2 != 0;
    let html = String::from_utf8_lossy(rest);
    // An inline image (by Content-ID) and a downloaded remote one, as the
    // reader passes them, so those paths are fuzzed too.
    let inline = HashMap::from([(
        "part1@x.example".to_string(),
        "data:image/gif;base64,AA==".to_string(),
    )]);
    let cached = HashMap::from([(
        "https://x.example/a.png".to_string(),
        "data:image/png;base64,AA==".to_string(),
    )]);

    let message =
        sanitize::sanitize_html_colors(&html, allow_images, &inline, &cached, original_colors);
    let problems = sanitize_check::problems(&message, allow_images);
    assert!(problems.is_empty(), "{problems:#?}\nfrom {html:?}");

    let text = sanitize::text_document(&html);
    let problems = sanitize_check::problems(&text, false);
    assert!(
        problems.is_empty(),
        "plain text: {problems:#?}\nfrom {html:?}"
    );
});
