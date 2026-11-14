//! Preparing message content for display.

pub mod codes;
pub mod colors;
pub mod images;
pub mod invite;
pub mod links;
pub mod mailto;
pub mod notify;
pub mod original;
pub mod prefetch;
pub mod sanitize;
/// Checks the cleaner's output is safe: for the property tests, and the fuzz
/// target in `fuzz/` (built with the `fuzzing` feature). Not in the app.
#[cfg(any(test, feature = "fuzzing"))]
pub mod sanitize_check;
pub mod saved_image;
pub mod stylesheet;
mod windows_zones;

use std::collections::HashMap;

use crate::db::store::StoredBody;
pub use sanitize::SafeMessage;

/// Picks the best body part and makes it safe to show. `inline_images`
/// maps lowercased Content-IDs to `data:` URLs (see `attachments`).
pub fn safe_message(
    body: &StoredBody,
    allow_images: bool,
    inline_images: &HashMap<String, String>,
    cached_images: &HashMap<String, String>,
    original_colors: bool,
) -> SafeMessage {
    match (&body.html, &body.text) {
        (Some(html), _) if !html.trim().is_empty() => sanitize::sanitize_html_colors(
            html,
            allow_images,
            inline_images,
            cached_images,
            original_colors,
        ),
        (_, Some(text)) => sanitize::text_document(text),
        _ => sanitize::text_document(""),
    }
}

/// A message for printing: as `safe_message` with original colors, and a
/// plain-text one on white too, since a printed page is never dark.
pub fn printable_message(
    body: &StoredBody,
    allow_images: bool,
    inline_images: &HashMap<String, String>,
    cached_images: &HashMap<String, String>,
) -> SafeMessage {
    match (&body.html, &body.text) {
        (Some(html), _) if !html.trim().is_empty() => {
            sanitize::sanitize_html_colors(html, allow_images, inline_images, cached_images, true)
        }
        (_, Some(text)) => sanitize::text_document_on_white(text),
        _ => sanitize::text_document_on_white(""),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn body(html: Option<&str>, text: Option<&str>) -> StoredBody {
        StoredBody {
            html: html.map(str::to_string),
            text: text.map(str::to_string),
        }
    }

    #[test]
    fn printed_messages_are_never_dark() {
        let none = HashMap::new();
        for b in [
            body(None, Some("Hi Maya")),
            body(Some("<p>Hi <b>Maya</b></p>"), None),
            body(None, None),
        ] {
            let printed = printable_message(&b, false, &none, &none);
            assert!(!printed.adaptive, "{:?}", b.html);
            assert!(printed.document.contains("color-scheme:light!important"));
            assert!(!printed.document.contains("prefers-color-scheme:dark"));
        }
        // On screen, plain text still follows the app's scheme.
        let shown = safe_message(&body(None, Some("Hi Maya")), false, &none, &none, true);
        assert!(shown.adaptive);
        // An email the reader recolors for dark mode keeps its own colors
        // on paper.
        let colored = body(Some(r#"<p style="color:#333333">Hi Maya</p>"#), None);
        assert!(safe_message(&colored, false, &none, &none, false).adaptive);
        let printed = printable_message(&colored, false, &none, &none);
        assert!(!printed.adaptive);
        assert!(!printed.document.contains("prefers-color-scheme:dark"));
    }
}
