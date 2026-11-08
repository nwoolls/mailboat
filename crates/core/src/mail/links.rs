//! Links inside emails.
//!
//! The email is shown in a sandboxed iframe where nothing can run, and the
//! macOS web view doesn't let the app catch clicks inside it. So the
//! sanitizer rewrites each web/mail link to the app's own `email-link:`
//! scheme. Clicking one makes the iframe request that URL; the app's scheme
//! handler opens the real link in the default browser and answers
//! "204 No Content", so the email stays on screen.

/// The custom scheme registered by the Tauri app.
pub const SCHEME: &str = "email-link";

/// Where link clicks go. Windows' web view exposes custom schemes as
/// `http://<scheme>.localhost`.
pub fn link_base() -> &'static str {
    if cfg!(windows) {
        "http://email-link.localhost/open"
    } else {
        "email-link://localhost/open"
    }
}

/// Whether `host` is where Windows' web view serves the app's link address
/// (`email-link.localhost`, as `url` writes it: lowercased; a trailing dot
/// names the same host). Never an image's host: loading one would ask the
/// app to open a link (`mail::sanitize`).
pub fn is_link_host(host: &str) -> bool {
    host.trim_end_matches('.')
        .strip_suffix(".localhost")
        .is_some_and(|name| name == SCHEME)
}

/// Only these may be opened from an email.
fn is_openable(url: &url::Url) -> bool {
    matches!(url.scheme(), "http" | "https" | "mailto")
}

/// The `email-link:` URL for an email link, or `None` if the link shouldn't
/// be clickable at all (scripts, files, relative paths...).
pub fn wrap(href: &str) -> Option<String> {
    let target = url::Url::parse(href.trim()).ok().filter(is_openable)?;
    let encoded: String =
        url::form_urlencoded::byte_serialize(target.as_str().as_bytes()).collect();
    Some(format!("{}?u={encoded}", link_base()))
}

/// The real link carried by a `email-link:` request, if it's safe to open.
pub fn unwrap(request_uri: &str) -> Option<String> {
    let uri = url::Url::parse(request_uri).ok()?;
    let (_, target) = uri.query_pairs().find(|(k, _)| k == "u")?;
    let target = url::Url::parse(&target).ok().filter(is_openable)?;
    Some(target.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn web_and_mail_links_round_trip() {
        for link in [
            "https://vendor.example/pay?a=1&b=two#x",
            "http://example.com/",
            "mailto:a@b.example?subject=Hi%20there",
        ] {
            let wrapped = wrap(link).unwrap();
            assert!(wrapped.starts_with(link_base()));
            assert_eq!(
                unwrap(&wrapped).unwrap(),
                url::Url::parse(link).unwrap().as_str()
            );
        }
    }

    #[test]
    fn unsafe_links_are_not_clickable() {
        for link in [
            "javascript:alert(1)",
            "file:///etc/passwd",
            "/relative",
            "cid:part1",
            "",
            "tel:123",
        ] {
            assert_eq!(wrap(link), None, "{link}");
        }
    }

    #[test]
    fn handler_refuses_crafted_requests() {
        assert_eq!(
            unwrap("email-link://localhost/open?u=javascript%3Aalert(1)"),
            None
        );
        assert_eq!(
            unwrap("email-link://localhost/open?u=file%3A%2F%2F%2Fetc%2Fpasswd"),
            None
        );
        assert_eq!(unwrap("email-link://localhost/open"), None);
    }
}
