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
/// names the same host), or a name under it, to be safe. Never an image's
/// host: loading one would ask the app to open a link (`mail::sanitize`).
pub fn is_link_host(host: &str) -> bool {
    host.trim_end_matches('.')
        .strip_suffix(".localhost")
        .is_some_and(|name| name == SCHEME || name.ends_with(&format!(".{SCHEME}")))
}

/// Only these may be opened from an email.
fn is_openable(url: &url::Url) -> bool {
    matches!(url.scheme(), "http" | "https" | "mailto")
}

/// Query parameters that only tell a site or an ad network where a click
/// came from, removed from every web link in an email (as known tracking
/// pixels are). Matched by name, ignoring case. Only names that a page
/// never needs to work are listed: codes that identify the reader to the
/// site itself (an unsubscribe or sign-in token, Marketo's `mkt_tok`,
/// HubSpot's `_hsenc`) stay, since taking them away can break the link.
///
/// In order: ad click IDs (Google, Microsoft, Meta, X, TikTok, Yandex),
/// Instagram's share tag, Mailchimp's campaign and member tags on the
/// landing page, and HubSpot's analytics cookies carried across sites.
const TRACKING_PARAMS: &[&str] = &[
    "gclid", "gclsrc", "dclid", "gbraid", "wbraid", "msclkid", "fbclid", "twclid", "ttclid",
    "yclid", "igshid", "mc_cid", "mc_eid", "__hstc", "__hssc", "__hsfp",
];

/// Any parameter starting with this goes too: Google Analytics' campaign
/// tags (`utm_source`, `utm_medium`, `utm_campaign`...).
const TRACKING_PREFIX: &str = "utm_";

fn is_tracking_param(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    name.starts_with(TRACKING_PREFIX) || TRACKING_PARAMS.contains(&name.as_str())
}

/// `url` without its tracking parameters (`TRACKING_PARAMS`). The rest of
/// the query is kept as written, in order, so nothing else changes; a query
/// left empty goes. Only web links: a `mailto:` link's query is the email.
fn strip_tracking(url: &mut url::Url) {
    if !matches!(url.scheme(), "http" | "https") {
        return;
    }
    let Some(query) = url.query() else { return };
    let kept: Vec<&str> = query
        .split('&')
        .filter(|pair| {
            let name = pair.split('=').next().unwrap_or_default();
            let name = url::form_urlencoded::parse(name.as_bytes())
                .next()
                .map(|(k, _)| k.into_owned())
                .unwrap_or_default();
            !is_tracking_param(&name)
        })
        .collect();
    if kept.len() == query.split('&').count() {
        return;
    }
    let kept = kept.join("&");
    url.set_query((!kept.is_empty()).then_some(kept.as_str()));
}

/// The link an email link opens: an `http`, `https` or `mailto` address,
/// without tracking parameters (`strip_tracking`), or `None` if it
/// shouldn't be clickable at all (scripts, files, relative paths...).
pub fn target(href: &str) -> Option<url::Url> {
    let mut target = url::Url::parse(href.trim()).ok().filter(is_openable)?;
    strip_tracking(&mut target);
    Some(target)
}

/// The `email-link:` URL for an email link (`target`), or `None` if the link
/// shouldn't be clickable at all.
pub fn wrap(href: &str) -> Option<String> {
    target(href).map(|t| wrap_target(&t))
}

/// The `email-link:` URL that opens `target`, from `target`.
pub fn wrap_target(target: &url::Url) -> String {
    let encoded: String =
        url::form_urlencoded::byte_serialize(target.as_str().as_bytes()).collect();
    format!("{}?u={encoded}", link_base())
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
    fn tracking_codes_are_removed_and_the_rest_kept_as_written() {
        for (link, clean) in [
            (
                "https://shop.example/sale?utm_source=news&utm_medium=email&id=42",
                "https://shop.example/sale?id=42",
            ),
            // Any case, anywhere in the query, and the rest's encoding untouched.
            (
                "https://x.example/a?q=one+two%20three&UTM_Campaign=x&fbclid=abc&page=2#top",
                "https://x.example/a?q=one+two%20three&page=2#top",
            ),
            (
                "https://x.example/?gclid=1&msclkid=2&mc_cid=3&mc_eid=4&__hstc=5",
                "https://x.example/",
            ),
            // A name merely like one stays.
            (
                "https://x.example/?utm=1&my_utm_source=2&gclid_note=3",
                "https://x.example/?utm=1&my_utm_source=2&gclid_note=3",
            ),
            // Codes a page needs to work stay.
            (
                "https://x.example/unsubscribe?mkt_tok=abc&_hsenc=def&token=ghi",
                "https://x.example/unsubscribe?mkt_tok=abc&_hsenc=def&token=ghi",
            ),
            // An encoded name is still recognized.
            (
                "https://x.example/?utm%5Fsource=a&b=c",
                "https://x.example/?b=c",
            ),
            // A mail link's query is the email itself.
            (
                "mailto:a@b.example?subject=Hi&utm_source=x",
                "mailto:a@b.example?subject=Hi&utm_source=x",
            ),
        ] {
            assert_eq!(target(link).unwrap().as_str(), clean, "{link}");
            assert_eq!(unwrap(&wrap(link).unwrap()).unwrap(), clean, "{link}");
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
