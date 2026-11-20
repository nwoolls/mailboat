//! The window never leaves the app.
//!
//! A file dropped where nothing in the page takes it was opened by the web
//! view in place of the app, filling the window with no way back but
//! quitting (owner, 2026-11-19: a PDF dropped on a reply's signature, which
//! is shown in a frame of its own). During a file drag the frames now let
//! the drop through to the page (`useIgnoreStrayDrops` in `Shell`), and
//! this refuses, at the web view, a navigation to a file or a page that
//! isn't one of the app's own. Links in mail go to the app's `email-link:`
//! address, whose handler opens them in the browser (`mail::links`).

use tauri::Url;

/// Whether the window (or a frame in it) may go to `url`: the app's own
/// pages (`tauri://localhost` on the Mac, `http(s)://tauri.localhost` on
/// Windows, the dev server in development), the frames mail is shown in
/// (`about:srcdoc`, `about:blank`), and a link clicked in an email, which
/// goes to the app's `email-link:` address (`email-link://localhost`, or
/// `http://email-link.localhost` on Windows). On the Mac this is asked for
/// frames' navigations too, so a link's click comes through here; on
/// Windows only for the window's own.
pub fn allowed(url: &Url, dev_url: Option<&Url>) -> bool {
    use mail_core::mail::links;
    match url.scheme() {
        "about" => true,
        "tauri" => url.host_str() == Some("localhost"),
        s if s == links::SCHEME => url.host_str() == Some("localhost"),
        "http" | "https" => {
            url.host_str()
                .is_some_and(|h| h == "tauri.localhost" || links::is_link_host(h))
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

    /// The address the sanitizer gives a link in an email, on this
    /// computer and on Windows.
    #[test]
    fn a_link_clicked_in_an_email_is_allowed() {
        let link = mail_core::mail::links::link_base();
        assert!(allowed(
            &url(&format!("{link}?u=https%3A%2F%2Fexample.com%2F")),
            None
        ));
        assert!(allowed(
            &url("email-link://localhost/open?u=mailto%3Aa%40x.example"),
            None
        ));
        assert!(allowed(
            &url("http://email-link.localhost/open?u=https%3A%2F%2Fexample.com"),
            None
        ));
        assert!(!allowed(&url("email-link://example.com/open"), None));
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
