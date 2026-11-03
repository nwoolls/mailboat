//! Handles clicks on links inside emails (`email-link:` scheme; see
//! `mail_core::mail::links`). Follows MonoCode's `artifacts::serve_html`
//! custom-scheme pattern.

use tauri::http::{Request, Response};
use tauri::AppHandle;

/// Opens the real link in the default browser (a `mailto:` link becomes a
/// new message here) and answers 204 No Content, which tells the web view
/// to keep showing the email.
pub fn handle(app: &AppHandle, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let status = match mail_core::mail::links::unwrap(&request.uri().to_string()) {
        Some(url) => match open(app, &url) {
            Ok(()) => 204,
            Err(e) => {
                // Only the kind: the launcher's own message includes the link, which
                // can carry a private token.
                eprintln!("could not open a link ({:?})", e.kind());
                500
            }
        },
        None => 400,
    };
    Response::builder()
        .status(status)
        .body(Vec::new())
        .unwrap_or_default()
}

/// Opens an email's link: a `mailto:` link as a new message here, any
/// other in the default browser.
pub fn open(app: &AppHandle, url: &str) -> std::io::Result<()> {
    if crate::mail_handler::open(app, url) {
        return Ok(());
    }
    open::that_detached(url)
}
