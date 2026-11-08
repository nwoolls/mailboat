//! Checks that a document `mail::sanitize` returned is safe to show, whatever
//! email went in. Used by the property tests below (every `cargo test`) and by
//! the fuzz target in `fuzz/` (coverage-guided, run weekly and by hand).
//!
//! It reads the cleaner's output on its own terms, sharing no code with the
//! cleaner, so a mistake there isn't repeated here. What it requires:
//! - the document opens with the app's own head: the charset, then the
//!   Content-Security-Policy for the image choice, then the referrer policy;
//! - no element that runs script, loads another document or submits
//!   anything (`script`, frames, `object`, `form`, `base`, `link`, `svg`…),
//!   and no `meta` beyond those three;
//! - no event-handler attribute (`on…`) and no attribute that turns into a
//!   request on its own (`formaction`, `srcdoc`, `xlink:href`…);
//! - every link and image address uses a safe scheme (`http`, `https`,
//!   `mailto`, `tel`, `cid`, or `data:image/…` for an image), read the way a
//!   browser reads it (entities decoded, tabs and line breaks dropped);
//! - every image address (`<img src>`, a `background`, a CSS `url()`) uses
//!   `http`, `https`, `cid` or `data:image/…`, and never the app's own link
//!   address (loading one would open its link with no click);
//! - with remote images held back, no image that points at another server.
//!
//! What the cleaner leaves to the Content-Security-Policy on purpose is left
//! to it here too, and the CSP is checked instead: `@import` and
//! `@font-face` (`mail::stylesheet` doesn't rewrite them; `style-src` and
//! `font-src` allow no server), and CSS that only an old browser would run
//! (`expression(`, `behavior:`: the frame has no scripts, and neither WebKit
//! nor WebView2 runs them). Image addresses in CSS are checked like any
//! other image's.
//!
//! CSS is read with the same tokenizer library as the cleaner (`cssparser`),
//! since a hand-written one would disagree with browsers more than it would
//! catch; the check is on the final document, after every rewrite.

use std::cell::RefCell;

use cssparser::{Parser, Token};
use lol_html::{element, rewrite_str, text, RewriteStrSettings};

use super::sanitize::{csp, SafeMessage};

/// Elements the cleaner must never let through.
const FORBIDDEN_ELEMENTS: &[&str] = &[
    "script", "iframe", "frame", "frameset", "object", "embed", "applet", "form", "input",
    "button", "select", "textarea", "base", "link", "svg", "math", "video", "audio", "source",
    "track", "portal", "noscript", "template", "dialog",
];

/// Attributes that make a request or run something by themselves.
const FORBIDDEN_ATTRIBUTES: &[&str] = &[
    "formaction",
    "action",
    "srcdoc",
    "xlink:href",
    "http-equiv",
    "ping",
    "data",
    "codebase",
    "manifest",
];

/// Attributes that hold one address.
const URL_ATTRIBUTES: &[&str] = &["href", "src", "background", "cite", "poster", "longdesc"];

/// The head every document starts with (see `wrap_document`).
fn expected_head(allow_images: bool) -> String {
    format!(
        r#"<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="{}"><meta name="referrer" content="no-referrer">"#,
        csp(allow_images)
    )
}

/// An attribute value as a browser reads it: character references decoded.
fn decode_entities(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut rest = value;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        rest = &rest[at..];
        let end = rest[1..]
            .find(|c: char| !(c.is_ascii_alphanumeric() || c == '#'))
            .map(|i| i + 1)
            .unwrap_or(rest.len());
        let name = &rest[1..end];
        let decoded = if let Some(hex) = name.strip_prefix("#x").or_else(|| name.strip_prefix("#X"))
        {
            u32::from_str_radix(hex, 16).ok().and_then(char::from_u32)
        } else if let Some(dec) = name.strip_prefix('#') {
            dec.parse::<u32>().ok().and_then(char::from_u32)
        } else {
            match name.to_ascii_lowercase().as_str() {
                "amp" => Some('&'),
                "lt" => Some('<'),
                "gt" => Some('>'),
                "quot" => Some('"'),
                "apos" => Some('\''),
                "nbsp" => Some('\u{a0}'),
                "tab" => Some('\t'),
                "newline" => Some('\n'),
                "colon" => Some(':'),
                _ => None,
            }
        };
        match decoded {
            Some(c) => {
                out.push(c);
                rest = &rest[end..];
                if rest.starts_with(';') {
                    rest = &rest[1..];
                }
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// An address as a browser's URL parser reads it (the URL Standard): control
/// characters and spaces trimmed from both ends, tabs and line breaks
/// dropped anywhere, lowercased. HTML entities are not decoded here: only an
/// attribute's value has them (`attribute_url`); a `<style>` sheet's text
/// and the link inside an `email-link:` address don't.
fn normalized_url(value: &str) -> String {
    value
        .trim_matches(|c: char| c <= ' ')
        .chars()
        .filter(|c| !matches!(c, '\t' | '\n' | '\r'))
        .collect::<String>()
        .to_ascii_lowercase()
}

/// The scheme of a normalized address, if it has one (`None` for a relative
/// one). A scheme is an ASCII letter, then letters, digits, `+`, `-` or `.`.
fn scheme(url: &str) -> Option<&str> {
    let colon = url.find(':')?;
    let name = &url[..colon];
    let valid = name.starts_with(|c: char| c.is_ascii_alphabetic())
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "+-.".contains(c));
    valid.then_some(name)
}

/// The host an address reaches, read as `is_remote` reads it, if any.
fn web_host(url: &str) -> Option<String> {
    let parsed = match url::Url::parse(url) {
        Ok(u) => Some(u),
        Err(url::ParseError::RelativeUrlWithoutBase) => {
            url::Url::parse("https://relative.invalid/")
                .and_then(|base| base.join(url))
                .ok()
        }
        Err(_) => None,
    }?;
    matches!(parsed.scheme(), "http" | "https")
        .then(|| parsed.host_str().map(str::to_string))
        .flatten()
        .filter(|h| h != "relative.invalid")
}

/// Whether a host is where Windows' web view serves the app's link address
/// (`email-link.localhost`, or a name under it).
fn is_app_link_host(host: &str) -> bool {
    let host = host.trim_end_matches('.');
    host == "email-link.localhost" || host.ends_with(".email-link.localhost")
}

/// Whether an address points at another server, parsed as a browser parses
/// it (the `url` crate follows the URL Standard): absolute if it can be (so
/// `https:host/x` is `https://host/x`, as the frame's base isn't a web
/// address), else against a web base (so `//host` and `\\\\host` count). An
/// address no browser could fetch (a bad or empty host) doesn't.
fn is_remote(url: &str) -> bool {
    let web = |u: &url::Url| {
        matches!(u.scheme(), "http" | "https")
            && u.host_str().is_some_and(|h| h != "relative.invalid")
    };
    match url::Url::parse(url) {
        Ok(u) => web(&u),
        Err(url::ParseError::RelativeUrlWithoutBase) => {
            url::Url::parse("https://relative.invalid/")
                .and_then(|base| base.join(url))
                .is_ok_and(|u| web(&u))
        }
        Err(_) => false,
    }
}

/// The link an `email-link:` address carries (the cleaner routes web and mail
/// links through the app this way, `mail::links`), or `None` if it isn't one.
/// Both forms, as macOS and as Windows' web view expose the scheme.
fn carried_link(url: &str) -> Option<String> {
    let query = url
        .strip_prefix("email-link://localhost/open?")
        .or_else(|| url.strip_prefix("http://email-link.localhost/open?"))?;
    let (_, target) = url::form_urlencoded::parse(query.as_bytes()).find(|(k, _)| k == "u")?;
    Some(normalized_url(&target))
}

/// What's wrong with an address in `attribute` of `element`, if anything.
fn url_problem(element: &str, attribute: &str, value: &str, allow_images: bool) -> Option<String> {
    let image = attribute == "background"
        || attribute == "poster"
        || (element == "img" && attribute == "src");
    let place = format!("<{element} {attribute}>");
    address_problem(&place, &attribute_url(value), image, allow_images)
        .map(|problem| format!("{problem}: {value:?}"))
}

/// An attribute's address as a browser reads it: its entities decoded once,
/// then as `normalized_url`.
fn attribute_url(value: &str) -> String {
    normalized_url(&decode_entities(value))
}

/// What's wrong with a normalized address, if anything. `image`: it is loaded
/// as an image (`<img src>`, a background, a CSS `url()`), not followed as a
/// link when clicked.
fn address_problem(place: &str, url: &str, image: bool, allow_images: bool) -> Option<String> {
    if let Some(link) = carried_link(url) {
        // Loaded as an image, it would ask the app to open the link with no
        // click, whatever the link is.
        if image {
            return Some(format!("{place} loads the app's link address as an image"));
        }
        // Only links the app may open: http, https and mail.
        return (!matches!(scheme(&link), Some("http" | "https" | "mailto")))
            .then(|| format!("{place} routes a link the app shouldn't open ({link:?})"));
    }
    if image && web_host(url).is_some_and(|h| is_app_link_host(&h)) {
        return Some(format!("{place} loads the app's link host as an image"));
    }
    match scheme(url) {
        None | Some("http" | "https" | "cid") => {}
        Some("mailto" | "tel") if !image => {}
        Some("data") if image && url.starts_with("data:image/") => {}
        Some(other) => return Some(format!("{place} uses the {other}: scheme")),
    }
    (image && !allow_images && is_remote(url))
        .then(|| format!("{place} loads a remote image while images are held back"))
}

/// Every address a style attribute or sheet would load an image from, read
/// with `cssparser` (Servo's tokenizer, as `mail::stylesheet` uses: escapes,
/// strings and broken `url(` tokens are read as a browser reads them).
/// `url(…)` in either form, and the strings of `image-set()`. `@import`,
/// `@font-face` and `@namespace` are left to the CSP (see the top).
fn css_image_urls(css: &str) -> Vec<String> {
    let mut urls = Vec::new();
    walk_css(&mut Parser::new(css), false, &mut urls);
    urls
}

fn walk_css(p: &mut Parser<'_>, in_image_set: bool, urls: &mut Vec<String>) {
    type Ignored = cssparser::ParseError<()>;
    while let Ok(token) = p.next_including_whitespace_and_comments().cloned() {
        match token {
            Token::UnquotedUrl(url) => urls.push(url.to_string()),
            Token::QuotedString(s) if in_image_set => urls.push(s.to_string()),
            Token::Function(name) if name.eq_ignore_ascii_case("url") => {
                // The first string is the address; anything after it makes
                // the `url()` invalid, so a browser loads nothing more.
                let _ = p.parse_nested_block(|p| {
                    while let Ok(t) = p.next() {
                        if let Token::QuotedString(s) = t {
                            urls.push(s.to_string());
                            break;
                        }
                    }
                    Ok::<_, Ignored>(())
                });
            }
            Token::AtKeyword(name)
                if ["import", "font-face", "namespace"]
                    .iter()
                    .any(|n| name.eq_ignore_ascii_case(n)) =>
            {
                while let Ok(t) = p.next() {
                    if matches!(t, Token::Semicolon | Token::CurlyBracketBlock) {
                        break;
                    }
                }
            }
            Token::Function(name) => {
                let image_set = name.to_ascii_lowercase().ends_with("image-set");
                let _ = p.parse_nested_block(|p| {
                    walk_css(p, image_set, urls);
                    Ok::<_, Ignored>(())
                });
            }
            Token::ParenthesisBlock | Token::SquareBracketBlock | Token::CurlyBracketBlock => {
                let _ = p.parse_nested_block(|p| {
                    walk_css(p, false, urls);
                    Ok::<_, Ignored>(())
                });
            }
            _ => {}
        }
    }
}

/// What's wrong with a style attribute or sheet, one line each: every
/// address it loads is an image (`address_problem`).
fn css_problems(place: &str, css: &str, allow_images: bool) -> Vec<String> {
    css_image_urls(css)
        .into_iter()
        .filter_map(|url| {
            address_problem(place, &normalized_url(&url), true, allow_images)
                .map(|problem| format!("{problem}: {url:?}"))
        })
        .collect()
}

/// Everything unsafe about a document the cleaner returned, one line each
/// (empty when it is safe). `allow_images` is what the cleaner was asked for.
pub fn problems(message: &SafeMessage, allow_images: bool) -> Vec<String> {
    let document = &message.document;
    let mut problems = Vec::new();
    if !document.starts_with(&expected_head(allow_images)) {
        problems.push("the document doesn't open with the app's head and CSP".to_string());
    }

    // lol_html drops one U+FEFF at the start of an attribute's value, which a
    // browser keeps (a BOM before `data:` makes a relative address, not a
    // `data:` one). The cleaner's output always quotes its attributes, so
    // doubling a BOM after `="` lets the browser's reading through.
    let readable = document.replace("=\"\u{feff}", "=\"\u{feff}\u{feff}");
    let found = RefCell::new(Vec::<String>::new());
    let metas = RefCell::new(0u32);
    let sheets = RefCell::new(String::new());
    let result = rewrite_str(
        &readable,
        RewriteStrSettings::new()
            .append_element_content_handler(element!("*", |el| {
                let tag = el.tag_name().to_ascii_lowercase();
                let mut found = found.borrow_mut();
                if tag == "meta" {
                    *metas.borrow_mut() += 1;
                } else if FORBIDDEN_ELEMENTS.contains(&tag.as_str()) {
                    found.push(format!("a <{tag}> element"));
                }
                for attribute in el.attributes() {
                    let name = attribute.name().to_ascii_lowercase();
                    let value = attribute.value();
                    if name.starts_with("on") {
                        found.push(format!("<{tag}> has an event handler, {name}"));
                    } else if tag != "meta" && FORBIDDEN_ATTRIBUTES.contains(&name.as_str()) {
                        found.push(format!("<{tag}> has {name}"));
                    } else if URL_ATTRIBUTES.contains(&name.as_str()) {
                        found.extend(url_problem(&tag, &name, &value, allow_images));
                    } else if name == "srcset" {
                        // Decoded first, as a browser does, then split.
                        for candidate in decode_entities(&value).split(',') {
                            let url = candidate.split_whitespace().next().unwrap_or("");
                            let place = format!("<{tag} srcset>");
                            found.extend(
                                address_problem(&place, &normalized_url(url), true, allow_images)
                                    .map(|problem| format!("{problem}: {url:?}")),
                            );
                        }
                    } else if name == "style" {
                        found.extend(css_problems(
                            &format!("<{tag} style>"),
                            &decode_entities(&value),
                            allow_images,
                        ));
                    }
                }
                Ok(())
            }))
            .append_element_content_handler(text!("style", |t| {
                let mut sheets = sheets.borrow_mut();
                sheets.push_str(t.as_str());
                if t.last_in_text_node() {
                    sheets.push('\n');
                }
                Ok(())
            })),
    );
    if let Err(e) = result {
        problems.push(format!("the document couldn't be read back: {e}"));
    }
    problems.extend(found.into_inner());
    let metas = metas.into_inner();
    if metas != 3 {
        problems.push(format!("{metas} <meta> elements, not the head's three"));
    }
    problems.extend(css_problems(
        "a <style> sheet",
        &sheets.into_inner(),
        allow_images,
    ));
    problems
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use proptest::prelude::*;

    use super::super::sanitize::{sanitize_html_colors, text_document};
    use super::*;

    /// The cleaner's own wrapper around a body, for checking the checker.
    fn document(body: &str, allow_images: bool) -> SafeMessage {
        SafeMessage {
            document: format!(
                "{}</head><body>{body}</body></html>",
                expected_head(allow_images)
            ),
            blocked_images: 0,
            loaded_images: 0,
            trackers_removed: 0,
            adaptive: false,
            recolorable: false,
        }
    }

    #[test]
    fn the_checker_accepts_a_safe_document() {
        let body = r#"<p style="color:red">Hi <a href="https://x.example/a?b=1&amp;c=2">link</a>
            <a href="mailto:maya@x.example">mail</a>
            <a href="email-link://localhost/open?u=https%3A%2F%2Fx.example%2F">routed</a> <img src="data:image/gif;base64,AA==">
            <img src="cid:part1@x.example"></p><style>p{color:blue}</style>"#;
        assert_eq!(
            problems(&document(body, false), false),
            Vec::<String>::new()
        );
        let remote = r#"<img src="https://x.example/a.png" style="background:url(https://x.example/b.png)">"#;
        assert_eq!(
            problems(&document(remote, true), true),
            Vec::<String>::new()
        );
    }

    #[test]
    fn the_checker_catches_each_kind_of_problem() {
        // Each of these must be reported, or the property tests prove nothing.
        let bad = [
            "<script>alert(1)</script>",
            r#"<img src="x" onerror="alert(1)">"#,
            r#"<a href="javascript:alert(1)">x</a>"#,
            r#"<a href="&#106;avascript:alert(1)">x</a>"#,
            r#"<a href="java&#x09;script:alert(1)">x</a>"#,
            r#"<a href=" JaVaScRiPt:alert(1)">x</a>"#,
            r#"<a href="data:text/html,x">x</a>"#,
            r#"<a href="email-link://localhost/open?u=javascript%3Aalert(1)">x</a>"#,
            r#"<td background="email-link://localhost/open?u=https%3A%2F%2Fx.example%2F">"#,
            r#"<p style="background:url(email-link://localhost/open?u=https%3A%2F%2Fx.example%2F)">"#,
            r#"<td background="javascript:alert(1)">"#,
            r#"<img src="https://email-link.localhost/open?u=x">"#,
            r#"<p style="background:url(//a.email-link.localhost/open?u=x)">"#,
            r#"<p style="background:url(javascript:x)">"#,
            r#"<style>p{background:url('data:text/html,x')}</style>"#,
            r#"<a href="http://email-link.localhost/open?u=file%3A%2F%2F%2Fx">x</a>"#,
            r#"<iframe src="https://x.example"></iframe>"#,
            r#"<meta http-equiv="refresh" content="0;url=https://x.example">"#,
            r#"<form><button formaction="https://x.example">x</button></form>"#,
            r#"<img src="https://x.example/a.png">"#,
            r#"<img src="//x.example/a.png">"#,
            r#"<img src="\\x.example\a.png">"#,
            r#"<img src="https:x.example/a.png">"#,
            r#"<img srcset="data:image/gif;base64,AA== 1x, https://x.example/a.png 2x">"#,
            r#"<td background="https://x.example/a.png">"#,
            r#"<p style="background:url(https://x.example/a.png)">"#,
            r#"<p style="background:u\72 l(https://x.example/a.png)">"#,
            "<style>p{background:url('//x.example/a.png')}</style>",
            "<style>@import 'x.css'; p{background:url(https://x.example/a.png)}</style>",
            "<style>@font-face{src:url(f.woff)} p{background:url(https://x.example/a.png)}</style>",
        ];
        for body in bad {
            assert_ne!(
                problems(&document(body, false), false),
                Vec::<String>::new(),
                "{body}"
            );
        }
        let mut wrong_csp = document("", false);
        wrong_csp.document = wrong_csp.document.replace("img-src data:", "img-src *");
        assert_ne!(problems(&wrong_csp, false), Vec::<String>::new());
    }

    #[test]
    fn an_address_no_browser_could_fetch_is_not_remote() {
        for url in [
            "https://x.examp%le/a.png",
            "//x.exam<p",
            "https:/?x.example/a",
            "//x:port/a",
        ] {
            assert!(!is_remote(url), "{url}");
        }
        for url in [
            "https://x.example/a.png",
            "//x.example",
            "\\\\x.example\\a",
            "https:x.example/a",
        ] {
            assert!(is_remote(url), "{url}");
        }
    }

    #[test]
    fn entities_decode_in_attributes_only_and_once() {
        // In a <style> sheet `&colon;` is just text: the address is relative.
        let sheet = "<style>p{background:url(javascript&colon;x)}</style>";
        assert_eq!(problems(&document(sheet, true), true), Vec::<String>::new());
        // In an attribute it decodes, once.
        let attribute = r#"<a href="javascript&colon;x">x</a>"#;
        assert_ne!(
            problems(&document(attribute, true), true),
            Vec::<String>::new()
        );
        let twice = r#"<a href="javascript&amp;colon;x">x</a>"#;
        assert_eq!(problems(&document(twice, true), true), Vec::<String>::new());
    }

    #[test]
    fn a_bom_before_a_scheme_reads_as_a_relative_address_as_in_a_browser() {
        let body = "<img src=\"\u{feff}data:text/html,x\"><a href=\"\u{feff}javascript:x\">x</a>";
        assert_eq!(
            problems(&document(body, false), false),
            Vec::<String>::new()
        );
    }

    #[test]
    fn what_the_cleaner_leaves_to_the_csp_is_blocked_by_it() {
        // `@import` and `@font-face` pass through the cleaner by design; the
        // CSP must allow no server for sheets or fonts, whatever the images.
        let body = "<style>@import url(https://x.example/a.css);@font-face{src:url(https://x.example/f.woff)}</style>";
        assert_eq!(
            problems(&document(body, false), false),
            Vec::<String>::new()
        );
        for allow_images in [false, true] {
            let policy = csp(allow_images);
            assert!(policy.contains("default-src 'none'"), "{policy}");
            assert!(policy.contains("style-src 'unsafe-inline';"), "{policy}");
            assert!(policy.contains("font-src data:;"), "{policy}");
            assert!(policy.contains("form-action 'none'"), "{policy}");
            assert!(policy.contains("base-uri 'none'"), "{policy}");
        }
    }

    /// Pieces that the HTML cleaner has to get right, mixed into random input.
    fn fragment() -> impl Strategy<Value = String> {
        let pieces: &[&str] = &[
            "<script>",
            "</script>",
            "<img src=",
            "<img srcset=",
            "<a href=",
            "<iframe src=",
            "<svg><script>",
            "<math>",
            "<style>",
            "</style>",
            "<base href=",
            "<meta http-equiv=",
            "<link rel=stylesheet href=",
            "<object data=",
            "<form action=",
            "<button formaction=",
            "<table background=",
            "<td background=",
            "<p style=",
            "<font color=",
            "<div ",
            "<noscript>",
            "<template>",
            "<xmp>",
            "<plaintext>",
            "<textarea>",
            "<title>",
            "<!--",
            "-->",
            "<![CDATA[",
            "]]>",
            "<!doctype html>",
            "</",
            ">",
            "/>",
            "\"",
            "'",
            "=",
            " ",
            "\t",
            "\n",
            "\0",
            "&",
            "&#",
            "&#x",
            ";",
            "&amp;",
            "&#106;",
            "&#x09;",
            "&colon;",
            "&tab;",
            "javascript:",
            "JaVaScRiPt:",
            "java\tscript:",
            "vbscript:",
            "data:text/html,",
            "data:image/gif;base64,AA==",
            "https://x.example/a.png",
            "http://x.example/",
            "//x.example/a.png",
            "cid:part1@x.example",
            "mailto:a@x.example",
            "tel:555-0100",
            "onerror=",
            "onload=",
            "OnClIcK=",
            "style=",
            "url(",
            "u\\72 l(",
            ")",
            "expression(",
            "@import ",
            "-moz-binding:",
            "behavior:",
            "\\",
            "/*",
            "*/",
            "background:",
            "background-image:",
            "color:",
            "#fff",
            "!important",
            "{",
            "}",
            "@media (prefers-color-scheme:dark){",
            "x",
            "é",
            "\u{202e}",
            "\u{feff}",
        ];
        prop_oneof![
            3 => proptest::sample::select(pieces).prop_map(str::to_string),
            1 => "\\PC{0,8}",
        ]
    }

    fn email() -> impl Strategy<Value = String> {
        proptest::collection::vec(fragment(), 0..60).prop_map(|parts| parts.concat())
    }

    /// The maps the reader passes in: an inline image and a downloaded remote one.
    fn image_maps() -> (HashMap<String, String>, HashMap<String, String>) {
        let inline = HashMap::from([(
            "part1@x.example".to_string(),
            "data:image/gif;base64,AA==".to_string(),
        )]);
        let cached = HashMap::from([(
            "https://x.example/a.png".to_string(),
            "data:image/png;base64,AA==".to_string(),
        )]);
        (inline, cached)
    }

    proptest! {
        #![proptest_config(ProptestConfig { cases: 512, ..ProptestConfig::default() })]

        #[test]
        fn any_email_comes_out_safe(
            html in email(),
            allow_images: bool,
            original_colors: bool,
        ) {
            let (inline, cached) = image_maps();
            let message = sanitize_html_colors(&html, allow_images, &inline, &cached, original_colors);
            prop_assert_eq!(problems(&message, allow_images), Vec::<String>::new());
        }

        #[test]
        fn any_plain_text_comes_out_safe(text in email()) {
            prop_assert_eq!(problems(&text_document(&text), false), Vec::<String>::new());
        }
    }
}
