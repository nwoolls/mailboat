//! Preparing message content for display.

pub mod colors;
pub mod images;
pub mod links;
pub mod sanitize;

use std::collections::HashMap;

use crate::db::store::StoredBody;
pub use sanitize::SafeMessage;

/// Picks the best body part and makes it safe to show. `inline_images`
/// maps lowercased Content-IDs to `data:` URLs (see `attachments`).
pub fn safe_message(
    body: &StoredBody,
    allow_images: bool,
    inline_images: &HashMap<String, String>,
) -> SafeMessage {
    match (&body.html, &body.text) {
        (Some(html), _) if !html.trim().is_empty() => {
            sanitize::sanitize_html_with(html, allow_images, inline_images)
        }
        (_, Some(text)) => sanitize::text_document(text),
        _ => sanitize::text_document(""),
    }
}
