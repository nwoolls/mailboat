//! Makes email HTML safe to display.
//!
//! Defense in depth, in three layers:
//! 1. `ammonia` removes scripts, event handlers, forms, frames, `<base>`,
//!    `<meta>`, `<link>` and dangerous URL schemes.
//! 2. A rewrite pass removes tracking pixels and, unless the sender is
//!    trusted, strips remote image URLs.
//! 3. The returned document carries its own Content-Security-Policy, and the
//!    UI shows it in an `<iframe sandbox>` without `allow-scripts`.
//!
//! Emails whose colors are all inline (or plain text) are also made
//! "adaptive": their page background becomes transparent so they sit on
//! the reader's glass, and a dark-mode style sheet remaps their colors
//! (`mail::colors`). Only attributes and colors computed here are added.

use std::cell::{Cell, RefCell};
use std::collections::HashMap;

use lol_html::{element, rewrite_str, RewriteStrSettings};

use super::colors::{self, DarkBackground};
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SafeMessage {
    /// A complete HTML document for the iframe's `srcdoc`.
    pub document: String,
    /// Remote images held back (see `mail::images` for when).
    pub blocked_images: u32,
    /// Remote images left in to load, so the reader can offer "Block".
    pub loaded_images: u32,
    /// Tracking pixels removed (always removed, even for trusted senders).
    pub trackers_removed: u32,
    /// The email sits on the reader's glass with colors adapted for dark
    /// mode. False for emails with their own style sheet or that ask for
    /// light only: those keep a white card.
    pub adaptive: bool,
}

/// Hosts (or host suffixes) that only serve open-tracking pixels.
const TRACKER_HOSTS: &[&str] = &[
    "mailtrack.io",
    "mailstat.us",
    "yesware.com",
    "getnotify.com",
    "bananatag.com",
    "track.hubspot.com",
    "r.superhuman.com",
    "pixel.mailchimp.com",
    "open.convertkit-mail.com",
    "trk.klclick.com",
    "email.mg.",
    "pixel.watch",
    "google-analytics.com",
];

/// URL path fragments used by common open-tracking endpoints.
const TRACKER_PATHS: &[&str] = &[
    "/wf/open",
    "/track/open",
    "/open.gif",
    "/open.aspx",
    "/e/o/",
    "/trk/open",
    "/pixel.gif",
];

fn is_remote(url: &str) -> bool {
    let u = url.trim().to_ascii_lowercase();
    u.starts_with("http://") || u.starts_with("https://") || u.starts_with("//")
}

fn is_tiny(value: Option<String>) -> bool {
    value.is_some_and(|v| matches!(v.trim().trim_end_matches("px"), "0" | "1"))
}

fn looks_like_tracker(
    src: &str,
    width: Option<String>,
    height: Option<String>,
    style: Option<String>,
) -> bool {
    let lower = src.to_ascii_lowercase();
    let host = url::Url::parse(&lower)
        .ok()
        .and_then(|u| u.host_str().map(str::to_string))
        .unwrap_or_default();
    let style = style
        .unwrap_or_default()
        .replace(' ', "")
        .to_ascii_lowercase();
    let hidden = style.contains("display:none")
        || style.contains("visibility:hidden")
        || (style.contains("width:1px") && style.contains("height:1px"))
        || (style.contains("width:0") && style.contains("height:0"));
    (is_tiny(width) && is_tiny(height))
        || hidden
        || TRACKER_HOSTS.iter().any(|t| {
            host == *t
                || host.ends_with(&format!(".{t}"))
                || (t.ends_with('.') && host.starts_with(t))
        })
        || TRACKER_PATHS.iter().any(|p| lower.contains(p))
}

fn ammonia_builder() -> ammonia::Builder<'static> {
    let mut b = ammonia::Builder::default();
    b.add_tags([
        "style", "center", "font", "u", "s", "strike", "big", "small", "wbr",
    ])
    .rm_clean_content_tags(["style"])
    .add_generic_attributes([
        "style",
        "class",
        "align",
        "valign",
        "bgcolor",
        "width",
        "height",
        "border",
        "dir",
        "background",
    ])
    .add_tag_attributes("font", ["color", "face", "size"])
    .add_tag_attributes("table", ["cellpadding", "cellspacing"])
    .add_tag_attributes("img", ["alt", "src", "width", "height"])
    .url_schemes(
        ["http", "https", "mailto", "cid", "tel"]
            .into_iter()
            .collect(),
    )
    .link_rel(Some("noopener noreferrer"))
    .strip_comments(true);
    b
}

/// Sanitizes `html`. If `allow_images` is false, remote images are held back.
pub fn sanitize_html(html: &str, allow_images: bool) -> SafeMessage {
    let adaptive = can_adapt(html);
    let cleaned = ammonia_builder().clean(html).to_string();
    let blocked = Cell::new(0u32);
    let loaded = Cell::new(0u32);
    let trackers = Cell::new(0u32);
    let dark = RefCell::new(DarkRules::default());

    let rewritten = rewrite_str(
        &cleaned,
        RewriteStrSettings::new()
            .append_element_content_handler(element!("img", |el| {
                let src = el.get_attribute("src").unwrap_or_default();
                if is_remote(&src)
                    && looks_like_tracker(
                        &src,
                        el.get_attribute("width"),
                        el.get_attribute("height"),
                        el.get_attribute("style"),
                    )
                {
                    trackers.set(trackers.get() + 1);
                    el.remove();
                } else if is_remote(&src) && !allow_images {
                    blocked.set(blocked.get() + 1);
                    el.remove_attribute("src");
                    el.set_attribute("data-mailboat-blocked", "")?;
                } else if is_remote(&src) {
                    loaded.set(loaded.get() + 1);
                    // Images are only loaded over HTTPS (the CSP allows nothing else).
                    if let Some(rest) = src.trim().strip_prefix("http://") {
                        el.set_attribute("src", &format!("https://{rest}"))?;
                    }
                } else if src.trim().to_ascii_lowercase().starts_with("cid:") {
                    // Inline (cid:) images are not resolved yet.
                    el.remove_attribute("src");
                    el.set_attribute("data-mailboat-inline", "")?;
                }
                Ok(())
            }))
            .append_element_content_handler(element!("a[href]", |el| {
                // Route clicks through the app (see `mail::links`); links that
                // must not open (javascript:, file:, relative...) go inert.
                let href = el.get_attribute("href").unwrap_or_default();
                match super::links::wrap(&href) {
                    Some(wrapped) => {
                        el.set_attribute("href", &wrapped)?;
                        // Hovering shows where the link really goes.
                        el.set_attribute("title", href.trim())?;
                    }
                    None => el.remove_attribute("href"),
                }
                Ok(())
            }))
            .append_element_content_handler(element!("[style], [bgcolor], font[color]", |el| {
                if adaptive {
                    dark.borrow_mut().mark(el)?;
                }
                Ok(())
            }))
            .append_element_content_handler(element!("[background]", |el| {
                let remote = el
                    .get_attribute("background")
                    .is_some_and(|b| is_remote(&b));
                if !allow_images {
                    if remote {
                        blocked.set(blocked.get() + 1);
                    }
                    el.remove_attribute("background");
                } else if remote {
                    loaded.set(loaded.get() + 1);
                }
                Ok(())
            })),
    )
    // The input is ammonia's well-formed output, so this cannot fail in
    // practice; fall back to the ammonia output (still safe) if it does.
    .unwrap_or_else(|_| cleaned.clone());

    SafeMessage {
        document: wrap_document(&rewritten, allow_images, adaptive, &dark.into_inner().css()),
        blocked_images: blocked.get(),
        loaded_images: loaded.get(),
        trackers_removed: trackers.get(),
        adaptive,
    }
}

/// Whether an email can be adapted: not if it asks for light only, and not
/// if it styles colors in a `<style>` sheet (those rules aren't rewritten,
/// so dark text could land on the dark glass). Checked on the raw HTML,
/// since ammonia drops `<meta>`.
fn can_adapt(raw: &str) -> bool {
    let lower = raw.to_ascii_lowercase();
    if lower.contains("color-scheme") && !lower.contains("dark") {
        return false;
    }
    let mut rest = lower.as_str();
    while let Some(start) = rest.find("<style") {
        let after = &rest[start..];
        let end = after.find("</style").unwrap_or(after.len());
        let sheet = &after[..end];
        if sheet.contains("background") || sheet.contains("color:") || sheet.contains("color :") {
            return false;
        }
        rest = &after[end..];
    }
    true
}

/// Dark-mode overrides for an adaptive email: each distinct remapped color
/// gets a number, elements are tagged `data-mc` (text) / `data-mb`
/// (background), and one `prefers-color-scheme: dark` sheet applies them.
#[derive(Default)]
struct DarkRules {
    text: HashMap<String, usize>,
    background: HashMap<String, usize>,
}

impl DarkRules {
    fn mark(
        &mut self,
        el: &mut lol_html::html_content::Element<'_, '_>,
    ) -> Result<(), lol_html::errors::AttributeNameError> {
        let mut text = el
            .get_attribute("color")
            .and_then(|c| colors::parse_color(&c));
        let mut background = el
            .get_attribute("bgcolor")
            .and_then(|c| colors::parse_color(&c));
        if let Some(style) = el.get_attribute("style") {
            for decl in style.split(';') {
                let Some((prop, value)) = decl.split_once(':') else {
                    continue;
                };
                match prop.trim().to_ascii_lowercase().as_str() {
                    "color" => text = colors::parse_color(value).or(text),
                    "background-color" => background = colors::parse_color(value).or(background),
                    // The shorthand: use its color, unless it's an image.
                    "background" if !value.contains("url(") => {
                        background = value
                            .split_whitespace()
                            .find_map(colors::parse_color)
                            .or(background);
                    }
                    _ => {}
                }
            }
        }
        if let Some(css) = text.and_then(colors::dark_text) {
            let n = Self::number(&mut self.text, format!("color:{}!important", css.hex()));
            el.set_attribute("data-mc", &n.to_string())?;
        }
        let bg = background.map(colors::dark_background);
        let bg_css = match bg {
            Some(DarkBackground::Transparent) => {
                Some("background-color:transparent!important".to_string())
            }
            Some(DarkBackground::Color(c)) => {
                Some(format!("background-color:{}!important", c.hex()))
            }
            _ => None,
        };
        if let Some(css) = bg_css {
            let n = Self::number(&mut self.background, css);
            el.set_attribute("data-mb", &n.to_string())?;
        }
        Ok(())
    }

    fn number(map: &mut HashMap<String, usize>, css: String) -> usize {
        let next = map.len();
        *map.entry(css).or_insert(next)
    }

    fn css(self) -> String {
        let mut rules: Vec<(String, usize, String)> = self
            .text
            .into_iter()
            .map(|(css, n)| ("mc".to_string(), n, css))
            .chain(
                self.background
                    .into_iter()
                    .map(|(css, n)| ("mb".to_string(), n, css)),
            )
            .collect();
        rules.sort();
        rules
            .into_iter()
            .map(|(attr, n, css)| format!("[data-{attr}=\"{n}\"]{{{css}}}"))
            .collect()
    }
}

/// Plain-text messages are escaped and shown with preserved line breaks.
pub fn text_document(text: &str) -> SafeMessage {
    let escaped = ammonia::clean_text(text);
    let body = format!("<div class=\"mailboat-plain\">{escaped}</div>");
    SafeMessage {
        document: wrap_document(&body, false, true, ""),
        blocked_images: 0,
        loaded_images: 0,
        trackers_removed: 0,
        adaptive: true,
    }
}

pub fn csp(allow_images: bool) -> String {
    let img = if allow_images {
        "data: https:"
    } else {
        "data:"
    };
    format!("default-src 'none'; style-src 'unsafe-inline'; img-src {img}; font-src data:; form-action 'none'; base-uri 'none'")
}

/// The frame is sized to its content, so it never scrolls vertically:
/// `overflow-y:hidden` makes vertical swipes go to the reader instead of
/// rubber-banding inside the frame (which made long emails bounce).
/// Emails wider than the reader can still scroll sideways.
///
/// Adaptive documents have a transparent page (the glass shows through),
/// little padding so text lines up with the reader's header, and a dark
/// sheet: default text and links for dark mode plus `dark_rules`.
fn wrap_document(body: &str, allow_images: bool, adaptive: bool, dark_rules: &str) -> String {
    let page = if adaptive {
        "html,body{margin:0;padding:0;background:transparent;color:#1f1f1f}\nbody{padding:2px 8px 8px}\n@media (prefers-color-scheme:dark){body{color:#e4e4e7}a{color:#8ab4f8}img[data-mailboat-blocked],img[data-mailboat-inline]{background:rgba(255,255,255,.08)!important}"
            .to_string()
            + dark_rules
            + "}"
    } else {
        "html,body{margin:0;padding:0;background:#fff;color:#1f1f1f}\nbody{padding:20px 24px}"
            .to_string()
    };
    format!(
        r#"<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="{csp}"><meta name="referrer" content="no-referrer"><style>
html{{overflow-y:hidden;overflow-x:auto}}
body{{font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;overflow-wrap:anywhere}}
img{{max-width:100%;height:auto}}
img[data-mailboat-blocked],img[data-mailboat-inline]{{display:inline-block;min-width:24px;min-height:24px;background:#f1f1f3;border-radius:4px}}
.mailboat-plain{{white-space:pre-wrap;font-family:inherit}}
a{{color:#2f6fde}}
{page}
</style></head><body>{body}</body></html>"#,
        csp = csp(allow_images)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const EVIL: &str = r#"<html><head><base href="https://evil.com/"><meta http-equiv="refresh" content="0;url=https://evil.com"><link rel="stylesheet" href="https://evil.com/x.css"></head>
<body onload="steal()"><p style="color:red" onclick="x()">Hi <b>there</b></p>
<script>alert(1)</script><iframe src="https://evil.com"></iframe><form action="https://evil.com"><input name="pw"></form>
<a href="javascript:alert(1)">bad link</a><a href="https://ok.com/pay">good link</a>
<img src="https://cdn.vendor.com/logo.png" width="120" alt="Logo">
<img src="https://track.example.net/x.gif" width="1" height="1">
<img src="https://mailtrack.io/trace/abc.png">
<img src="cid:part1@x">
<table background="https://cdn.vendor.com/bg.png"><tr><td>cell</td></tr></table>
<style>p{color:#333}</style></body></html>"#;

    #[test]
    fn strips_active_content() {
        let out = sanitize_html(EVIL, false).document;
        for bad in [
            "<script",
            "onload",
            "onclick",
            "<iframe",
            "<form",
            "<input",
            "javascript:",
            "evil.com",
            "<base",
            "http-equiv=\"refresh\"",
        ] {
            assert!(!out.contains(bad), "output still contains {bad}: {out}");
        }
        assert!(out.contains("<b>there</b>"));
        assert!(
            out.contains("style=\"color:red\""),
            "inline styles are kept"
        );
        assert!(out.contains("p{color:#333}"), "<style> blocks are kept");
        assert!(out.contains("https://ok.com/pay"));
        // Clicks go through the app's link handler, not straight to the web.
        assert!(out.contains(&format!(
            "href=\"{}?u=https%3A%2F%2Fok.com%2Fpay\"",
            super::super::links::link_base()
        )));
        assert!(!out.contains("href=\"https://"));
    }

    #[test]
    fn blocks_remote_images_and_removes_trackers_by_default() {
        let out = sanitize_html(EVIL, false);
        assert_eq!(out.trackers_removed, 2);
        assert_eq!(out.blocked_images, 2, "logo + table background");
        assert_eq!(out.loaded_images, 0);
        assert!(!out.document.contains("cdn.vendor.com"));
        assert!(!out.document.contains("track.example.net"));
        assert!(out.document.contains("data-mailboat-blocked"));
        assert!(
            out.document.contains("img-src data:;"),
            "CSP forbids remote images"
        );
    }

    #[test]
    fn trusted_sender_loads_images_but_trackers_stay_removed() {
        let out = sanitize_html(EVIL, true);
        assert_eq!(out.blocked_images, 0);
        assert_eq!(out.loaded_images, 2, "logo + table background, now loading");
        assert_eq!(out.trackers_removed, 2);
        assert!(out.document.contains("https://cdn.vendor.com/logo.png"));
        assert!(!out.document.contains("mailtrack.io"));
        assert!(out.document.contains("img-src data: https:"));
    }

    #[test]
    fn inline_colored_email_adapts_for_dark_mode() {
        let out = sanitize_html(
            r##"<table bgcolor="#ffffff"><tr><td style="color:#24292f;background:#f6f8fa">Hi</td>
               <td style="background-color:#b8aef2;color:#fff">Brand</td></tr></table>"##,
            false,
        );
        assert!(out.adaptive);
        let doc = &out.document;
        assert!(
            doc.contains("background:transparent"),
            "the glass shows through"
        );
        assert!(doc.contains("prefers-color-scheme:dark"));
        // White table and light grey cell: see-through in dark mode.
        assert!(doc.contains(r##"bgcolor="#ffffff" data-mb="##));
        assert!(doc.contains("background-color:transparent!important"));
        // Near-black text: a light color in dark mode.
        assert!(doc.contains("data-mc="));
        // The purple banner and its white text are left alone.
        assert!(doc.contains(r##"style="background-color:#b8aef2;color:#fff">"##));
        // Light mode keeps the email's own colors inline.
        assert!(doc.contains("color:#24292f"));
    }

    #[test]
    fn emails_with_their_own_style_sheet_or_light_only_keep_the_white_card() {
        let styled = sanitize_html("<style>.x{background:#eee}</style><p class=x>Hi</p>", false);
        assert!(!styled.adaptive);
        assert!(styled.document.contains("background:#fff"));
        let light_only = sanitize_html(
            r#"<meta name="color-scheme" content="light only"><p>Hi</p>"#,
            false,
        );
        assert!(!light_only.adaptive);
        assert!(sanitize_html("<style>p{margin:0}</style><p>Hi</p>", false).adaptive);
        assert!(text_document("hi").adaptive);
    }

    #[test]
    fn the_frame_never_scrolls_vertically() {
        let out = sanitize_html("<p>hi</p>", false);
        assert!(out
            .document
            .contains("html{overflow-y:hidden;overflow-x:auto}"));
        assert!(text_document("hi").document.contains("overflow-y:hidden"));
    }

    #[test]
    fn upgrades_http_images_for_trusted_senders() {
        let out = sanitize_html(r#"<img src="http://cdn.x.com/a.png">"#, true);
        assert!(out.document.contains("https://cdn.x.com/a.png"));
    }

    #[test]
    fn plain_text_is_escaped() {
        let out = text_document("a <script>alert(1)</script> & b");
        assert!(!out.document.contains("<script>alert"));
        assert!(out.document.contains("&lt;script&gt;"));
    }
}
