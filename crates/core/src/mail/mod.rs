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
pub mod saved_image;
pub mod stylesheet;

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
