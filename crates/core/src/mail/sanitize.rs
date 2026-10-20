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
use std::rc::Rc;

use lol_html::{element, rewrite_str, RewriteStrSettings};

use super::colors::{self, DarkBackground};
use super::stylesheet;
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
    /// An HTML email that can sit on the glass with adapted colors (whether
    /// or not it does now), so the reader can offer its original colors on
    /// the white card, and back. False for plain text, which has none.
    pub recolorable: bool,
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

/// The address a remote image is loaded from: always HTTPS (the CSP
/// allows nothing else), so `http://` and `//` addresses are upgraded.
/// Also the key cached images are stored under (`mail::prefetch`).
pub fn remote_image_url(src: &str) -> String {
    let src = src.trim();
    if let Some(rest) = src.strip_prefix("http://") {
        format!("https://{rest}")
    } else if let Some(rest) = src.strip_prefix("//") {
        format!("https://{rest}")
    } else {
        src.to_string()
    }
}

/// The remote images an email would load (trackers left out), as
/// `remote_image_url` gives them, for downloading ahead of time.
pub fn remote_image_urls(html: &str) -> Vec<String> {
    let cleaned = ammonia_builder().clean(html).to_string();
    let urls = RefCell::new(Vec::<String>::new());
    let _ = rewrite_str(
        &cleaned,
        RewriteStrSettings::new().append_element_content_handler(element!("img", |el| {
            let src = attr(el, "src").unwrap_or_default();
            if is_remote(&src)
                && !looks_like_tracker(
                    &src,
                    el.get_attribute("width"),
                    el.get_attribute("height"),
                    el.get_attribute("style"),
                )
            {
                let url = remote_image_url(&src);
                if !urls.borrow().contains(&url) {
                    urls.borrow_mut().push(url);
                }
            }
            Ok(())
        })),
    );
    urls.into_inner()
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
    // A page title is never shown in an email; without this its text was
    // left at the top of the body.
    .add_clean_content_tags(["title"])
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
    sanitize_html_with(html, allow_images, &HashMap::new())
}

/// An attribute's value as the browser would read it. `lol_html` hands
/// back attributes exactly as written in the HTML, so `&` arrives as
/// `&amp;`; ammonia's output only uses these few entities. Without this,
/// every link with more than one query parameter (`?a=1&amp;b=2`) was
/// opened with `amp;b=2` instead of `b=2`, so Google Calendar's RSVP
/// buttons failed with "400 Bad Request".
fn attr(el: &lol_html::html_content::Element, name: &str) -> Option<String> {
    el.get_attribute(name).map(|v| {
        v.replace("&quot;", "\"")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&nbsp;", "\u{a0}")
            .replace("&amp;", "&")
    })
}

/// Sets an attribute to a plain value. `lol_html` escapes `"` but not
/// `&`, so `&` is escaped here (else `?a=1&copy=2` would read as `©`).
fn set_attr(
    el: &mut lol_html::html_content::Element,
    name: &str,
    value: &str,
) -> lol_html::HandlerResult {
    el.set_attribute(name, &value.replace('&', "&amp;"))?;
    Ok(())
}

/// Decodes `%XX` escapes (a `cid:` URL may escape its Content-ID).
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let hex = |b: u8| (b as char).to_digit(16);
        match (bytes[i], bytes.get(i + 1), bytes.get(i + 2)) {
            (b'%', Some(&h), Some(&l)) if hex(h).is_some() && hex(l).is_some() => {
                out.push((hex(h).unwrap_or(0) * 16 + hex(l).unwrap_or(0)) as u8);
                i += 3;
            }
            (b, _, _) => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// A transparent 1×1 GIF: the source for images that aren't shown, so the
/// web view draws a quiet placeholder box instead of its broken-image icon.
const PLACEHOLDER_SRC: &str =
    "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/// Turns an image that won't load into a placeholder box the size the
/// email asked for (its width and height, when it gave both).
fn make_placeholder(el: &mut lol_html::html_content::Element) -> lol_html::HandlerResult {
    el.set_attribute("src", PLACEHOLDER_SRC)?;
    let size = |name: &str| {
        el.get_attribute(name)
            .and_then(|v| v.trim().trim_end_matches("px").parse::<u32>().ok())
            .filter(|n| *n > 0)
    };
    // The 1×1 image would otherwise make the box square; a plain ratio (no
    // `auto`) overrides an image's own.
    let shape = match (size("width"), size("height")) {
        (Some(w), Some(h)) => format!("aspect-ratio:{w}/{h}"),
        _ => "height:24px".to_string(),
    };
    let style = el.get_attribute("style").unwrap_or_default();
    let sep = if style.trim().is_empty() || style.trim_end().ends_with(';') {
        ""
    } else {
        ";"
    };
    el.set_attribute("style", &format!("{style}{sep}{shape}"))?;
    Ok(())
}

/// Like `sanitize_html`, with the message's inline images (`cid:` links)
/// as `data:` URLs keyed by lowercased Content-ID. Inline images are part
/// of the email itself, so they show even when remote images are held back.
pub fn sanitize_html_with(
    html: &str,
    allow_images: bool,
    inline_images: &HashMap<String, String>,
) -> SafeMessage {
    sanitize_html_colors(html, allow_images, inline_images, &HashMap::new(), false)
}

/// Like `sanitize_html_with`, with remote images downloaded ahead of time
/// (`mail::prefetch`) as `data:` URLs keyed by `remote_image_url`: when
/// images are allowed, those show from the copy and aren't requested
/// again. `original_colors` keeps an email that could
/// be adapted on the white card with its own colors (the reader's
/// "Original colors", for emails the remap gets wrong).
pub fn sanitize_html_colors(
    html: &str,
    allow_images: bool,
    inline_images: &HashMap<String, String>,
    cached_images: &HashMap<String, String>,
    original_colors: bool,
) -> SafeMessage {
    let cleaned = ammonia_builder().clean(html).to_string();
    let plan = adapt_plan(html, &cleaned);
    let recolorable = plan.is_some();
    let adaptive = recolorable && !original_colors;
    let sheet = plan.unwrap_or_default();
    let blocked = Cell::new(0u32);
    let loaded = Cell::new(0u32);
    let trackers = Cell::new(0u32);
    let dark = RefCell::new(DarkRules::default());
    // A grey page set in the style sheet holds everything, as far as the
    // white boxes inside it are concerned.
    if sheet.veil {
        dark.borrow().veils.set(1);
    }

    let rewritten = rewrite_str(
        &cleaned,
        RewriteStrSettings::new()
            .append_element_content_handler(element!("img", |el| {
                let src = attr(el, "src").unwrap_or_default();
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
                    el.set_attribute("data-mailboat-blocked", "")?;
                    make_placeholder(el)?;
                } else if is_remote(&src) {
                    loaded.set(loaded.get() + 1);
                    // Small fixed-size images (status icons) keep their size:
                    // the page's `max-width:100%` let a narrow table cell
                    // shrink them to nothing.
                    if el
                        .get_attribute("width")
                        .and_then(|w| w.trim().trim_end_matches("px").parse::<u32>().ok())
                        .is_some_and(|w| w <= 64)
                    {
                        el.set_attribute("data-mailboat-fixed", "")?;
                    }
                    let url = remote_image_url(&src);
                    if let Some(data_url) = cached_images.get(&url) {
                        // Downloaded when the mail arrived: opening it now
                        // makes no request.
                        el.set_attribute("src", data_url)?;
                    } else if let Some(rest) = src.trim().strip_prefix("http://") {
                        // Images are only loaded over HTTPS (the CSP allows
                        // nothing else).
                        set_attr(el, "src", &format!("https://{rest}"))?;
                    }
                } else if let Some(cid) = src.trim().get(4..).filter(|_| {
                    src.trim()
                        .get(..4)
                        .is_some_and(|p| p.eq_ignore_ascii_case("cid:"))
                }) {
                    // Inline images were fetched by the caller; ones that
                    // weren't (too big, unsafe type, failed) stay placeholders.
                    match inline_images.get(&percent_decode(cid).trim().to_ascii_lowercase()) {
                        Some(data_url) => el.set_attribute("src", data_url)?,
                        None => {
                            el.set_attribute("data-mailboat-inline", "")?;
                            make_placeholder(el)?;
                        }
                    }
                } else if !src.trim().to_ascii_lowercase().starts_with("data:") {
                    // Anything else (relative paths, file:) can't load.
                    el.set_attribute("data-mailboat-inline", "")?;
                    make_placeholder(el)?;
                }
                Ok(())
            }))
            .append_element_content_handler(element!("a[href]", |el| {
                // Route clicks through the app (see `mail::links`); links that
                // must not open (javascript:, file:, relative...) go inert.
                let href = attr(el, "href").unwrap_or_default();
                match super::links::wrap(&href) {
                    Some(wrapped) => {
                        set_attr(el, "href", &wrapped)?;
                        // Hovering shows where the link really goes.
                        set_attr(el, "title", href.trim())?;
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
    // On the white card, the email is shown in light mode, so its own
    // dark-mode rules must not fire either (they turned a vendor's text
    // white on the white card).
    let rewritten = if adaptive {
        rewritten
    } else {
        light_only_style_sheets(&rewritten)
    };

    SafeMessage {
        document: wrap_document(
            &rewritten,
            allow_images,
            adaptive,
            &dark.into_inner().css(),
            if adaptive { &sheet.css } else { "" },
        ),
        blocked_images: blocked.get(),
        loaded_images: loaded.get(),
        trackers_removed: trackers.get(),
        adaptive,
        recolorable,
    }
}

/// Turns off an email's own dark-mode rules: inside its `<style>` blocks,
/// `prefers-color-scheme: dark` becomes a value no browser matches, so
/// those `@media` blocks never apply. Used for emails shown on the white
/// card, which are always shown in light mode. Text outside style blocks
/// is left alone.
fn light_only_style_sheets(html: &str) -> String {
    const FEATURE: &str = "prefers-color-scheme";
    // ASCII lowercasing keeps byte offsets identical to `html`.
    let lower = html.to_ascii_lowercase();
    let mut out = String::with_capacity(html.len());
    let mut copied = 0;
    let mut pos = 0;
    while let Some(start) = lower[pos..].find("<style").map(|i| pos + i) {
        let end = lower[start..]
            .find("</style")
            .map_or(lower.len(), |i| start + i);
        let mut at = start;
        while let Some(found) = lower[at..end].find(FEATURE).map(|i| at + i) {
            let mut i = found + FEATURE.len();
            let skip_space = |mut i: usize| {
                while lower.as_bytes().get(i).is_some_and(u8::is_ascii_whitespace) {
                    i += 1;
                }
                i
            };
            i = skip_space(i);
            if lower.as_bytes().get(i) == Some(&b':') {
                let value = skip_space(i + 1);
                if lower[value..end].starts_with("dark") {
                    out.push_str(&html[copied..value]);
                    out.push_str("mailboat-light-only");
                    copied = value + "dark".len();
                }
            }
            at = found + FEATURE.len();
        }
        pos = end;
    }
    out.push_str(&html[copied..]);
    out
}

/// How an email can be adapted, or `None` if it can't: it asks for light
/// only (checked on the raw HTML, since ammonia drops `<meta>`), or its
/// style sheets set colors `mail::stylesheet` can't remap.
fn adapt_plan(raw: &str, cleaned: &str) -> Option<stylesheet::SheetRemap> {
    let lower = raw.to_ascii_lowercase();
    if lower.contains("color-scheme") && !lower.contains("dark") {
        return None;
    }
    stylesheet::remap(&style_sheets(cleaned))
}

/// The text of each `<style>` block in sanitized HTML.
fn style_sheets(html: &str) -> Vec<String> {
    // ASCII lowercasing keeps byte offsets identical to `html`.
    let lower = html.to_ascii_lowercase();
    let mut sheets = Vec::new();
    let mut pos = 0;
    while let Some(start) = lower[pos..].find("<style").map(|i| pos + i) {
        let Some(open_end) = lower[start..].find('>').map(|i| start + i + 1) else {
            break;
        };
        let end = lower[open_end..]
            .find("</style")
            .map_or(lower.len(), |i| open_end + i);
        sheets.push(html[open_end..end].to_string());
        pos = end;
    }
    sheets
}

/// Dark-mode overrides for an adaptive email: each distinct remapped color
/// gets a number, elements are tagged `data-mc` (text) / `data-mb`
/// (background) / `data-mr` (border), and one `prefers-color-scheme: dark`
/// sheet applies them.
#[derive(Default)]
struct DarkRules {
    text: HashMap<String, usize>,
    background: HashMap<String, usize>,
    border: HashMap<String, usize>,
    /// How many open elements around the current one have a light grey
    /// (`Veil`) background. A white box inside one becomes a slightly
    /// darker card instead of see-through, so its edges still show (Gmail's
    /// notices draw no top border and rely on white against grey).
    veils: Rc<Cell<u32>>,
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
        let mut border = None;
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
                        background = colors::parts(value, ' ')
                            .into_iter()
                            .find_map(colors::parse_color)
                            .or(background);
                    }
                    // `border`, `border-left`, `border-color`, … : the color
                    // inside the shorthand or on its own.
                    p if p.starts_with("border")
                        && !p.contains("radius")
                        && !p.contains("width")
                        && !p.contains("style")
                        && !p.contains("collapse")
                        && !p.contains("spacing") =>
                    {
                        border = colors::parts(value, ' ')
                            .into_iter()
                            .find_map(colors::parse_color)
                            .or(border);
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
        if bg == Some(DarkBackground::Veil) {
            // Count it until its end tag (void elements have none to wait for).
            if let Some(handlers) = el.end_tag_handlers() {
                let veils = self.veils.clone();
                veils.set(veils.get() + 1);
                handlers.push(Box::new(move |_| {
                    veils.set(veils.get().saturating_sub(1));
                    Ok(())
                }));
            }
        }
        let bg_css = match bg {
            Some(DarkBackground::Transparent) if self.veils.get() > 0 => Some(format!(
                "background-color:{}!important",
                stylesheet::CARD_IN_VEIL
            )),
            Some(DarkBackground::Transparent) => {
                Some("background-color:transparent!important".to_string())
            }
            Some(DarkBackground::Veil) => {
                Some(format!("background-color:{}!important", stylesheet::VEIL))
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
        if let Some(color) = border.and_then(colors::dark_border) {
            let n = Self::number(&mut self.border, format!("border-color:{color}!important"));
            el.set_attribute("data-mr", &n.to_string())?;
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
            .chain(
                self.border
                    .into_iter()
                    .map(|(css, n)| ("mr".to_string(), n, css)),
            )
            .collect();
        rules.sort();
        rules
            .into_iter()
            // Two `:not(#…)` raise the rule above any email selector
            // (ammonia drops `id`s, so the email's own `#id` rules never
            // match): an inline color beat the email's sheet in light mode,
            // so its remap must beat the sheet's remap in dark mode.
            .map(|(attr, n, css)| format!("[data-{attr}=\"{n}\"]{BOOST}{{{css}}}"))
            .collect()
    }
}

/// See `DarkRules::css`.
const BOOST: &str = ":not(#mailboat-none):not(#mailboat-none)";

/// Plain-text messages are escaped and shown with preserved line breaks.
pub fn text_document(text: &str) -> SafeMessage {
    let escaped = ammonia::clean_text(text);
    let body = format!("<div class=\"mailboat-plain\">{escaped}</div>");
    SafeMessage {
        document: wrap_document(&body, false, true, "", ""),
        blocked_images: 0,
        loaded_images: 0,
        trackers_removed: 0,
        adaptive: true,
        recolorable: false,
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
/// Adaptive documents have a transparent page (the message card shows
/// through), no side padding so text lines up with the card's edge, and a dark
/// sheet: default text and links for dark mode plus `dark_rules`.
///
/// `sheet_rules` (the email's style sheets remapped, `mail::stylesheet`) go
/// in a dark-mode sheet at the end of the body, after the email's own
/// sheets, so they win over the light colors they repeat.
fn wrap_document(
    body: &str,
    allow_images: bool,
    adaptive: bool,
    dark_rules: &str,
    sheet_rules: &str,
) -> String {
    let page = if adaptive {
        "html,body{margin:0;padding:0;background:transparent;color:#1f1f1f}\nbody{padding:0 0 4px}\n@media (prefers-color-scheme:dark){body{color:#e4e4e7}a{color:#8ab4f8}img[data-mailboat-blocked],img[data-mailboat-inline]{background:rgba(255,255,255,.08)!important}"
            .to_string()
            + dark_rules
            + "}"
    } else {
        // `color-scheme:light` keeps the browser's own defaults (plain text,
        // links, controls) light too, even if the email asks for dark.
        "html{color-scheme:light!important}\nhtml,body{margin:0;padding:0;background:#fff;color:#1f1f1f}\nbody{padding:20px 24px}"
            .to_string()
    };
    format!(
        r#"<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="{csp}"><meta name="referrer" content="no-referrer"><style>
html{{overflow-y:hidden;overflow-x:auto}}
body{{font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;overflow-wrap:break-word}}
img{{max-width:100%;height:auto}}
img[data-mailboat-fixed]{{max-width:none}}
img[data-mailboat-blocked],img[data-mailboat-inline]{{display:inline-block;min-width:24px;min-height:24px;background:#f1f1f3;border-radius:4px}}
.mailboat-plain{{white-space:pre-wrap;font-family:inherit}}
a{{color:#2f6fde}}
{page}
</style></head><body>{body}{sheet}</body></html>"#,
        csp = csp(allow_images),
        sheet = if sheet_rules.is_empty() {
            String::new()
        } else {
            format!("<style>@media (prefers-color-scheme:dark){{{sheet_rules}}}</style>")
        }
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

    /// Regression: a CI service email's 1%-wide status cell showed "Failed"
    /// one letter per line (`overflow-wrap:anywhere` lets words break
    /// anywhere, so cells shrink to one letter) and its 16px icons vanished
    /// (`max-width:100%` in a shrinking cell).
    #[test]
    fn narrow_cells_keep_words_and_small_icons() {
        let out = sanitize_html(
            r#"<table><tr><td width="1%"><img src="https://x.com/fail.png" width="16" height="16"></td><td width="1%">Failed</td></tr></table>"#,
            true,
        );
        assert!(
            !out.document.contains("overflow-wrap:anywhere"),
            "{}",
            out.document
        );
        assert!(
            out.document.contains("data-mailboat-fixed"),
            "{}",
            out.document
        );
        assert!(out
            .document
            .contains("img[data-mailboat-fixed]{max-width:none}"));
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
    fn inline_images_show_even_with_remote_images_blocked() {
        let images = HashMap::from([(
            "logo@x".to_string(),
            "data:image/png;base64,AAAA".to_string(),
        )]);
        let out = sanitize_html_with(
            r#"<img src="cid:Logo@X"><img src="cid:logo%40x" width="10" height="5"><img src="cid:missing@x" width="300" height="100"><img src="images/rel.png">"#,
            false,
            &images,
        );
        assert_eq!(
            out.document.matches("data:image/png;base64,AAAA").count(),
            2,
            "matched case-insensitively and percent-decoded"
        );
        assert!(!out.document.contains("cid:"));
        assert!(!out.document.contains("images/rel.png"));
        // Unresolved images become a quiet box the size the email asked for.
        assert!(out.document.contains("aspect-ratio:300/100"));
        assert_eq!(out.document.matches(PLACEHOLDER_SRC).count(), 2);
        assert_eq!(out.blocked_images, 0, "inline images aren't remote");
    }

    #[test]
    fn links_with_several_query_parameters_open_intact() {
        // Google Calendar's RSVP buttons: these failed with 400 Bad Request.
        let rsvp = "https://calendar.google.com/calendar/event?action=RESPOND&eid=E1&rst=1&tok=T1&ctz=America%2FNew_York";
        let html = format!(r#"<a href="{}">Yes</a>"#, rsvp.replace('&', "&amp;"));
        let out = sanitize_html(&html, false).document;
        let wrapped = out
            .split("href=\"")
            .nth(1)
            .and_then(|rest| rest.split('"').next())
            .unwrap()
            .replace("&amp;", "&");
        assert_eq!(super::super::links::unwrap(&wrapped).unwrap(), rsvp);
        // The hover title keeps `&` escaped, so `&copy=` can't turn into ©.
        let out = sanitize_html(r#"<a href="https://x.com/?a=1&amp;copy=2">x</a>"#, false);
        assert!(out
            .document
            .contains(r#"title="https://x.com/?a=1&amp;copy=2""#));
    }

    #[test]
    fn remote_images_with_several_query_parameters_load_intact() {
        let out = sanitize_html(
            r#"<img src="http://cdn.x.com/a.png?w=600&amp;h=200">"#,
            true,
        );
        assert!(
            out.document
                .contains(r#"src="https://cdn.x.com/a.png?w=600&amp;h=200""#),
            "{}",
            out.document
        );
    }

    #[test]
    fn blocked_images_get_a_placeholder_instead_of_a_broken_icon() {
        let out = sanitize_html(
            r#"<img src="https://cdn.x.com/a.png" width="600" height="200" style="border:0"><img src="https://cdn.x.com/b.png">"#,
            false,
        );
        assert_eq!(out.document.matches(PLACEHOLDER_SRC).count(), 2);
        assert!(out.document.contains("border:0;aspect-ratio:600/200"));
        assert!(out.document.contains("height:24px"));
        assert!(!out.document.contains("cdn.x.com"));
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
    fn original_colors_puts_an_adaptable_email_on_the_white_card() {
        let html = r##"<td style="color:#24292f;background:#ffffff">Hi</td>"##;
        let adapted = sanitize_html_colors(html, false, &HashMap::new(), &HashMap::new(), false);
        assert!(adapted.adaptive && adapted.recolorable);
        let original = sanitize_html_colors(html, false, &HashMap::new(), &HashMap::new(), true);
        assert!(!original.adaptive, "white card");
        assert!(original.recolorable, "so the reader can switch back");
        assert!(!original.document.contains("data-mc="));
        assert!(original.document.contains("background:#fff"));
        // Emails that can't adapt, and plain text, offer no switch.
        assert!(!sanitize_html("<style>p{color:var(--x)}</style><p>Hi</p>", false).recolorable);
        assert!(!text_document("hi").recolorable);
    }

    #[test]
    fn emails_on_the_white_card_ignore_their_own_dark_mode_rules() {
        // a vendor's billing email (a gradient added, which keeps it on the
        // white card): dark-mode rules that turned its text white there.
        let out = sanitize_html(
            r#"<style>:root{color-scheme:light dark} .hero{background:linear-gradient(#fff,#eee)}
               @media (prefers-color-scheme: dark) { .white-color { color: #FFFFFF !important; } }
               @media (PREFERS-COLOR-SCHEME:dark){a{color:#4C9AFF}}
               @media (prefers-color-scheme: light){p{margin:0}}</style>
               <p class="white-color" style="background:#fff">Talk about prefers-color-scheme: dark here</p>"#,
            false,
        );
        assert!(!out.adaptive);
        let doc = &out.document;
        assert!(!doc.contains("prefers-color-scheme: dark)"));
        assert!(!doc.contains("PREFERS-COLOR-SCHEME:dark)"));
        assert_eq!(doc.matches("mailboat-light-only").count(), 2);
        // Light rules and the email's text are untouched.
        assert!(doc.contains("(prefers-color-scheme: light)"));
        assert!(doc.contains("Talk about prefers-color-scheme: dark here"));
        assert!(doc.contains("html{color-scheme:light!important}"));
    }

    #[test]
    fn emails_with_their_own_style_sheet_adapt_too() {
        let out = sanitize_html(
            r##"<style>body{background:#f4f4f4} .card{background:#ffffff;color:#333}</style>
               <div class="card"><p style="color:#555">Hi</p><table bgcolor="#ffffff"><tr><td>x</td></tr></table></div>"##,
            false,
        );
        assert!(out.adaptive && out.recolorable);
        let doc = &out.document;
        // The sheet's remap comes after the email's own sheet, in a dark block.
        let own = doc.find(".card{background:#ffffff").unwrap();
        let ours = doc
            .find("<style>@media (prefers-color-scheme:dark){")
            .unwrap();
        assert!(ours > own);
        assert!(doc.contains(".card{background-color:rgba(0,0,0,0.22)!important;color:#"));
        // A grey page from the sheet makes inline white boxes the darker card.
        assert!(doc.contains(r##"bgcolor="#ffffff" data-mb="##));
        assert!(doc.contains("background-color:rgba(0,0,0,0.22)!important}"));
        // Inline remaps outrank the sheet's.
        assert!(doc.contains(r#"[data-mc="0"]:not(#mailboat-none):not(#mailboat-none){"#));
    }

    #[test]
    fn emails_that_declare_dark_mode_keep_their_rules_and_get_ours() {
        // a vendor's: its dark rules turn text white but leave the inline
        // white background, which ours makes see-through.
        let out = sanitize_html(
            r#"<style>:root{color-scheme:light dark}
               .white-color{color:#172B4D}
               @media (prefers-color-scheme: dark) { .white-color { color: #FFFFFF !important; } }</style>
               <p class="white-color" style="background:#fff">Hi</p>"#,
            false,
        );
        assert!(out.adaptive);
        let doc = &out.document;
        assert!(doc.contains("(prefers-color-scheme: dark) { .white-color"));
        assert!(!doc.contains("mailboat-light-only"));
        assert!(doc.contains("background-color:transparent!important"));
        // Its own dark text color wins: `.white-color`'s text isn't
        // remapped, which leaves nothing for the sheet's dark block.
        assert!(!doc.contains("<style>@media (prefers-color-scheme:dark){"));
    }

    #[test]
    fn prefetched_images_show_from_their_copy() {
        let html = r#"<img src="http://cdn.shop.com/a.png" width="200">
            <img src="//cdn.shop.com/b.png" width="200">
            <img src="https://cdn.shop.com/a.png" width="200">
            <img src="https://mailtrack.io/open.gif" width="1" height="1">"#;
        assert_eq!(
            remote_image_urls(html),
            vec!["https://cdn.shop.com/a.png", "https://cdn.shop.com/b.png"],
            "upgraded, once each, trackers left out"
        );
        let cached = HashMap::from([(
            "https://cdn.shop.com/a.png".to_string(),
            "data:image/png;base64,AAAA".to_string(),
        )]);
        let shown = sanitize_html_colors(html, true, &HashMap::new(), &cached, false);
        assert_eq!(
            shown.document.matches("data:image/png;base64,AAAA").count(),
            2
        );
        assert!(
            shown.document.contains("//cdn.shop.com/b.png"),
            "not cached: loads live"
        );
        assert_eq!(shown.loaded_images, 3);
        // Held back means held back, copy or not.
        let blocked = sanitize_html_colors(html, false, &HashMap::new(), &cached, false);
        assert!(!blocked.document.contains("base64,AAAA"));
    }

    #[test]
    fn the_page_title_is_not_shown() {
        let out = sanitize_html(
            "<html><head><title>a software vendor</title></head><body><p>Hi</p></body></html>",
            false,
        );
        assert!(!out.document.contains("a software vendor"));
        assert!(out.document.contains("<p>Hi</p>"));
    }

    #[test]
    fn adaptive_emails_keep_their_dark_mode_rules() {
        let out = sanitize_html(
            r#"<style>@media (prefers-color-scheme: dark){p{font-weight:bold}}</style><p>Hi</p>"#,
            false,
        );
        assert!(out.adaptive);
        assert!(out.document.contains("(prefers-color-scheme: dark)"));
    }

    #[test]
    fn a_white_card_on_a_grey_page_stays_distinct_in_dark_mode() {
        // Gmail's confidential-mode notice: a grey page, a 2px white strip
        // as the card's top edge, then the white card with no top border.
        let out = sanitize_html(
            r##"<div style="background-color:#f5f5f5"><div style="background:#fff;height:2px"></div>
               <div style="background:#fff">Card</div></div>
               <div style="background:#fff">Plain white email</div>"##,
            false,
        );
        let doc = &out.document;
        // The page gets a faint lift; the strip and card inside it a darker
        // tint, so every edge shows.
        assert!(doc.contains("background-color:rgba(255,255,255,0.05)!important"));
        assert!(doc.contains("background-color:rgba(0,0,0,0.22)!important"));
        let card_rule = doc.matches(r#"data-mb="#).count();
        assert!(
            card_rule >= 4,
            "page, strip, card and plain white are all tagged"
        );
        // White outside any grey page stays see-through, as before.
        assert!(doc.contains("background-color:transparent!important"));
    }

    #[test]
    fn grey_borders_go_faint_in_dark_mode_and_colored_ones_stay() {
        // Gmail's confidential-mode notice: a white card whose hairline
        // sides showed as stark white lines on the dark glass.
        let out = sanitize_html(
            r##"<div style="background:#fff;border-left:1px solid #eaeaea;border-bottom:1px solid #eaeaea">Hi</div>
               <a href="https://x.test" style="background-color:#4d90fe;border:1px solid #3079ed">View</a>"##,
            false,
        );
        let doc = &out.document;
        assert!(doc.contains("data-mr="));
        assert!(doc.contains("border-color:rgba(255,255,255,0.12)!important"));
        // The blue button keeps its blue outline.
        assert_eq!(doc.matches(" data-mr=").count(), 1);
    }

    #[test]
    fn emails_with_sheets_it_cant_remap_or_light_only_keep_the_white_card() {
        let styled = sanitize_html(
            "<style>.x{background:linear-gradient(#fff,#eee)}</style><p class=x>Hi</p>",
            false,
        );
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
