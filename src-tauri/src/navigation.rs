//! The window never leaves the app.
//!
//! A file dropped where nothing in the page takes it was opened by the web
//! view in place of the app, filling the window with no way back but
//! quitting (owner, 2026-11-19: a PDF dropped on a reply's signature, which
//! is shown in a frame of its own). The page now takes those drops
//! (`guardFrameDrops`), and this refuses, at the web view, any navigation to
//! a page that isn't the app's own, whatever starts it. Links in mail open
//! in the browser through `link_open`, never in the window.

use tauri::Url;

/// Whether the window (or a frame in it) may go to `url`: the app's own
/// pages (`tauri://localhost` on the Mac, `http(s)://tauri.localhost` on
/// Windows, the dev server in development) and the frames mail is shown in
/// (`about:srcdoc`, `about:blank`).
pub fn allowed(url: &Url, dev_url: Option<&Url>) -> bool {
    match url.scheme() {
        "about" => true,
        "tauri" => url.host_str() == Some("localhost"),
        "http" | "https" => {
            url.host_str() == Some("tauri.localhost")
                || dev_url.is_some_and(|dev| dev.origin() == url.origin())
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn the_apps_own_pages_and_mail_frames_are_allowed() {
        assert!(allowed(&url("tauri://localhost/"), None));
        assert!(allowed(&url("tauri://localhost/index.html#x"), None));
        assert!(allowed(&url("http://tauri.localhost/"), None));
        assert!(allowed(&url("https://tauri.localhost/"), None));
        assert!(allowed(&url("about:srcdoc"), None));
        assert!(allowed(&url("about:blank"), None));
    }

    #[test]
    fn the_dev_server_only_in_development() {
        let dev = url("http://localhost:1420");
        assert!(allowed(&url("http://localhost:1420/"), Some(&dev)));
        assert!(!allowed(&url("http://localhost:1420/"), None));
        assert!(!allowed(&url("http://localhost:9999/"), Some(&dev)));
    }

    #[test]
    fn a_dropped_file_or_a_web_page_is_refused() {
        assert!(!allowed(&url("file:///Users/x/Downloads/report.pdf"), None));
        assert!(!allowed(&url("https://example.com/"), None));
        assert!(!allowed(&url("http://localhost/"), None));
        assert!(!allowed(&url("tauri://example.com/"), None));
        assert!(!allowed(&url("data:text/html,hi"), None));
        assert!(!allowed(&url("blob:tauri://localhost/1"), None));
    }
}
