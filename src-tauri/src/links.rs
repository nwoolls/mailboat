//! Handles clicks on links inside emails (`mailboat-link:` scheme; see
//! `mailboat_core::mail::links`). Follows MonoCode's `artifacts::serve_html`
//! custom-scheme pattern.

use tauri::http::{Request, Response};

/// Opens the real link in the default browser and answers 204 No Content,
/// which tells the web view to keep showing the email.
pub fn handle(request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let status = match mailboat_core::mail::links::unwrap(&request.uri().to_string()) {
        Some(url) => match open::that_detached(&url) {
            Ok(()) => 204,
            Err(e) => {
                eprintln!("could not open link: {e}");
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
