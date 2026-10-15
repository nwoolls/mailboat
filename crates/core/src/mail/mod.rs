//! Preparing message content for display.

pub mod links;
pub mod sanitize;

use crate::db::store::StoredBody;
pub use sanitize::SafeMessage;

/// Picks the best body part and makes it safe to show.
pub fn safe_message(body: &StoredBody, allow_images: bool) -> SafeMessage {
    match (&body.html, &body.text) {
        (Some(html), _) if !html.trim().is_empty() => sanitize::sanitize_html(html, allow_images),
        (_, Some(text)) => sanitize::text_document(text),
        _ => sanitize::text_document(""),
    }
}
