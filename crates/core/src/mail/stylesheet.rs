//! Dark-mode colors for an email's own style sheets (`<style>` blocks), so
//! newsletters styled with classes can sit on the glass like emails with
//! inline colors (`mail::colors` has the remapping itself).
//!
//! Each rule that sets a color is repeated, with the same selector, inside
//! a `prefers-color-scheme: dark` sheet placed after the email's own, so it
//! wins over the light color without touching what light mode shows. The
//! email's own dark-mode rules are kept, and win where they set the same
//! property for the same selector. Sheets this can't safely remap (colors
//! in forms it doesn't read, gradients) leave the email on the white card.
//!
//! Parsing uses `cssparser` (Servo's tokenizer, already in the build through
//! `ammonia`); only selectors and colors come out, and selectors that could
//! break out of the sheet are dropped.

use std::collections::HashSet;

use cssparser::{Delimiter, ParseError, Parser, Token};

use super::colors::{self, ColorRead, DarkBackground};

/// One rule of a style sheet, as far as remapping needs.
#[derive(Debug, Clone, PartialEq)]
enum Rule {
    Style {
        selector: String,
        decls: Vec<Decl>,
    },
    /// `@media`, with the rules inside (other at-rules are skipped).
    Media {
        condition: String,
        rules: Vec<Rule>,
    },
}

#[derive(Debug, Clone, PartialEq)]
struct Decl {
    /// Lowercased.
    prop: String,
    /// Without `!important`.
    value: String,
}

/// The dark-mode sheet for an email's style sheets.
#[derive(Debug, Default, PartialEq)]
pub struct SheetRemap {
    /// Rules to place inside the dark-mode block, after the email's own
    /// sheets. Empty if no rule sets a color.
    pub css: String,
    /// The sheets give something a light grey (`Veil`) page background, so
    /// white boxes become a slightly darker card rather than see-through
    /// (see `DarkBackground::Veil`).
    pub veil: bool,
}

/// The background a white box gets inside a light grey page in dark mode.
pub const CARD_IN_VEIL: &str = "rgba(0,0,0,0.22)";
/// The faint lift a light grey page gets in dark mode.
pub const VEIL: &str = "rgba(255,255,255,0.05)";

/// Remaps `sheets` (the text of each `<style>` block). `None` if one sets a
/// color this can't remap, so the email should keep the white card.
pub fn remap(sheets: &[String]) -> Option<SheetRemap> {
    let rules: Vec<Rule> = sheets.iter().flat_map(|s| parse(s)).collect();
    // What the email's own dark rules already set, by selector.
    let mut own_dark = HashSet::new();
    collect_own_dark(&rules, false, &mut own_dark);
    let veil = rules_have_veil(&rules);
    let mut css = String::new();
    write_rules(&rules, &own_dark, veil, &mut css)?;
    Some(SheetRemap { css, veil })
}

/// Which property a remapped declaration sets, to match against the
/// email's own dark rules.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum Group {
    Text,
    Background,
    Border,
}

fn group(prop: &str) -> Option<Group> {
    match prop {
        "color" => Some(Group::Text),
        "background" | "background-color" | "background-image" => Some(Group::Background),
        p if is_border_color(p) => Some(Group::Border),
        _ => None,
    }
}

/// `border`, `border-left`, `border-color`, … : properties that can carry
/// a border's color (as for inline styles in the sanitizer).
fn is_border_color(p: &str) -> bool {
    p.starts_with("border")
        && !p.contains("radius")
        && !p.contains("width")
        && !p.contains("style")
        && !p.contains("collapse")
        && !p.contains("spacing")
        && !p.contains("image")
}

fn is_color_scheme_media(condition: &str) -> bool {
    condition
        .to_ascii_lowercase()
        .contains("prefers-color-scheme")
}

fn is_dark_media(condition: &str) -> bool {
    let c: String = condition
        .to_ascii_lowercase()
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect();
    c.contains("prefers-color-scheme:dark")
}

fn collect_own_dark(rules: &[Rule], in_dark: bool, out: &mut HashSet<(String, Group)>) {
    for rule in rules {
        match rule {
            Rule::Style { selector, decls } if in_dark => {
                for d in decls {
                    if let Some(g) = group(&d.prop) {
                        out.insert((normalize(selector), g));
                    }
                }
            }
            Rule::Style { .. } => {}
            Rule::Media { condition, rules } => {
                collect_own_dark(rules, in_dark || is_dark_media(condition), out)
            }
        }
    }
}

fn rules_have_veil(rules: &[Rule]) -> bool {
    rules.iter().any(|rule| match rule {
        Rule::Style { decls, .. } => decls.iter().any(|d| {
            background_color(d)
                .flatten()
                .is_some_and(|c| colors::dark_background(c) == DarkBackground::Veil)
        }),
        Rule::Media { condition, rules } => {
            !is_color_scheme_media(condition) && rules_have_veil(rules)
        }
    })
}

/// Selector text with runs of whitespace made single, for comparing.
fn normalize(selector: &str) -> String {
    selector.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Whether a selector or media condition can be copied into the dark sheet
/// as it is: nothing that could end the rule, the sheet or the `<style>`.
fn safe_to_copy(text: &str) -> bool {
    !text.is_empty() && !text.contains(['{', '}', '<', ';', '@', '\\'])
}

/// Values that set no color of their own.
fn is_keyword(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "inherit" | "initial" | "unset" | "revert" | "currentcolor" | "none" | ""
    )
}

/// A color value: `Some(Some(c))` a color to remap, `Some(None)` nothing to
/// remap (a keyword, mostly see-through, or not valid CSS, which browsers
/// ignore), `None` a color this can't read (`var()`, `color-mix()`...).
fn color_value(value: &str) -> Option<Option<colors::Rgb>> {
    if is_keyword(value) {
        return Some(None);
    }
    match colors::read_color(value) {
        ColorRead::Color(c) => Some(Some(c)),
        ColorRead::SeeThrough => Some(None),
        ColorRead::Unknown if value.contains('(') => None,
        ColorRead::Unknown => Some(None),
    }
}

/// A gradient is fine as it is if every color in it already suits a dark
/// backdrop (or is see-through); a light one can't be remapped stop by
/// stop here, so it keeps the white card.
fn gradient_is_dark(value: &str) -> bool {
    let Some(open) = value.find('(') else {
        return false;
    };
    let Some(args) = value[open + 1..].strip_suffix(')') else {
        return false;
    };
    colors::parts(args, ',').into_iter().all(|stop| {
        colors::parts(stop, ' ').into_iter().all(|part| {
            match colors::read_color(part) {
                ColorRead::Color(c) => colors::dark_background(c) == DarkBackground::Keep,
                ColorRead::SeeThrough => true,
                // Directions, angles and positions; anything nested
                // (`var()`, old `-webkit-gradient`'s `from()`) can't be read.
                ColorRead::Unknown => !part.contains('('),
            }
        })
    })
}

/// The background color a declaration sets, as `color_value`. Background
/// images are left alone; gradients only pass if they're already dark.
fn background_color(d: &Decl) -> Option<Option<colors::Rgb>> {
    let value = d.value.to_ascii_lowercase();
    match d.prop.as_str() {
        "background-color" => color_value(&value),
        "background" | "background-image" => {
            let mut found = None;
            for layer in colors::parts(&value, ',') {
                for part in colors::parts(layer, ' ') {
                    if part.contains("gradient(") {
                        if !gradient_is_dark(part) {
                            return None;
                        }
                    } else if part.starts_with("url(") {
                    } else if d.prop == "background" {
                        if let Some(c) = color_value(part)? {
                            found = Some(c);
                        }
                    }
                }
            }
            Some(found)
        }
        _ => Some(None),
    }
}

/// The dark-mode declarations for one rule, or `None` if a color can't be
/// remapped.
fn dark_decls(
    selector: &str,
    decls: &[Decl],
    own_dark: &HashSet<(String, Group)>,
    veil: bool,
) -> Option<String> {
    let key = normalize(selector);
    let is_page = key.split(',').all(|s| {
        matches!(
            s.trim().to_ascii_lowercase().as_str(),
            "body" | "html" | ":root"
        )
    });
    let mut out = String::new();
    for d in decls {
        let Some(g) = group(&d.prop) else { continue };
        if own_dark.contains(&(key.clone(), g)) {
            continue;
        }
        match g {
            Group::Text => {
                let Some(color) = color_value(&d.value)? else {
                    continue;
                };
                if let Some(c) = colors::dark_text(color) {
                    out.push_str(&format!("color:{}!important;", c.hex()));
                }
            }
            Group::Background => {
                let Some(color) = background_color(d)? else {
                    continue;
                };
                let css = match colors::dark_background(color) {
                    DarkBackground::Transparent if veil && !is_page => CARD_IN_VEIL.to_string(),
                    DarkBackground::Transparent => "transparent".to_string(),
                    DarkBackground::Veil => VEIL.to_string(),
                    DarkBackground::Color(c) => c.hex(),
                    DarkBackground::Keep => continue,
                };
                out.push_str(&format!("background-color:{css}!important;"));
            }
            Group::Border => {
                let color = colors::parts(&d.value, ' ')
                    .into_iter()
                    .find_map(colors::parse_color);
                if let Some(faint) = color.and_then(colors::dark_border) {
                    out.push_str(&format!("border-color:{faint}!important;"));
                }
            }
        }
    }
    Some(out)
}

fn write_rules(
    rules: &[Rule],
    own_dark: &HashSet<(String, Group)>,
    veil: bool,
    out: &mut String,
) -> Option<()> {
    for rule in rules {
        match rule {
            Rule::Style { selector, decls } => {
                let css = dark_decls(selector, decls, own_dark, veil)?;
                if !css.is_empty() && safe_to_copy(selector) {
                    out.push_str(&format!("{selector}{{{css}}}"));
                }
            }
            // Rules for light or dark mode only are the email's own
            // business: light ones don't apply in dark mode, dark ones are
            // already dark.
            Rule::Media { condition, .. } if is_color_scheme_media(condition) => {}
            Rule::Media { condition, rules } => {
                let mut inner = String::new();
                write_rules(rules, own_dark, veil, &mut inner)?;
                if !inner.is_empty() && safe_to_copy(condition) {
                    out.push_str(&format!("@media {condition}{{{inner}}}"));
                }
            }
        }
    }
    Some(())
}

type Ignored = ParseError<()>;

/// The rules of a style sheet. Malformed parts are skipped, as a browser
/// would.
fn parse(css: &str) -> Vec<Rule> {
    let mut parser = Parser::new(css);
    parse_rules(&mut parser)
}

fn parse_rules(p: &mut Parser<'_>) -> Vec<Rule> {
    let mut rules = Vec::new();
    loop {
        p.skip_whitespace();
        if p.is_exhausted() {
            break;
        }
        let start = p.position();
        let Ok(token) = p.next().cloned() else { break };
        match token.clone() {
            // `<!--` and `-->` around old-style sheets.
            Token::CDO | Token::CDC => {}
            Token::AtKeyword(name) => {
                let media = name.eq_ignore_ascii_case("media");
                let prelude_start = p.position();
                // The prelude, up to the block (or `;` for `@import`).
                let mut end = prelude_start;
                loop {
                    match p.next().cloned() {
                        Ok(Token::CurlyBracketBlock) => {
                            if media {
                                let condition = p.slice(prelude_start..end).trim().to_string();
                                let inner = p
                                    .parse_nested_block(|p| Ok::<_, Ignored>(parse_rules(p)))
                                    .unwrap_or_default();
                                rules.push(Rule::Media {
                                    condition,
                                    rules: inner,
                                });
                            }
                            break;
                        }
                        Ok(Token::Semicolon) | Err(_) => break,
                        Ok(t) => end = past(p, &t),
                    }
                }
            }
            _ => {
                // A style rule: the selector runs to its block.
                let mut end = past(p, &token);
                let mut found = false;
                loop {
                    match p.next().cloned() {
                        Ok(Token::CurlyBracketBlock) => {
                            found = true;
                            break;
                        }
                        Ok(t) => end = past(p, &t),
                        Err(_) => break,
                    }
                }
                if !found {
                    break;
                }
                let selector = p.slice(start..end).trim().to_string();
                let decls = p
                    .parse_nested_block(|p| Ok::<_, Ignored>(parse_decls(p)))
                    .unwrap_or_default();
                rules.push(Rule::Style { selector, decls });
            }
        }
    }
    rules
}

/// The position just past `token`, the one `p` last returned: for a
/// function or bracket, past its closing bracket (its contents are read
/// and dropped).
fn past(p: &mut Parser<'_>, token: &Token<'_>) -> cssparser::SourcePosition {
    if matches!(
        token,
        Token::Function(_) | Token::ParenthesisBlock | Token::SquareBracketBlock
    ) {
        let _ = p.parse_nested_block(|p| {
            while p.next().is_ok() {}
            Ok::<_, Ignored>(())
        });
    }
    p.position()
}

fn parse_decls(p: &mut Parser<'_>) -> Vec<Decl> {
    let mut decls = Vec::new();
    while !p.is_exhausted() {
        let decl = p.parse_until_after(Delimiter::Semicolon, |p| {
            let prop = p.expect_ident()?.to_ascii_lowercase();
            p.expect_colon()?;
            let start = p.position();
            let mut end = start;
            // The value, up to `!important` if it's there.
            loop {
                match p.next().cloned() {
                    Ok(Token::Delim('!')) | Err(_) => break,
                    Ok(t) => end = past(p, &t),
                }
            }
            // Skip the rest (`important`), so the block is fully read.
            while p.next().is_ok() {}
            Ok::<_, Ignored>(Decl {
                prop,
                value: p.slice(start..end).trim().to_string(),
            })
        });
        if let Ok(d) = decl {
            decls.push(d);
        }
    }
    decls
}

/// What happens to one image address found in CSS (`rewrite_urls`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CssUrl {
    Keep,
    Replace(String),
    /// Becomes `none` (or an empty string inside `image-set()`), which
    /// loads nothing.
    Remove,
}

/// Rewrites the image addresses in `css` (a `<style>` sheet or a `style`
/// attribute's declarations): `url(…)` in either form, and the strings of
/// `image-set()`. `@import`, `@font-face` and `@namespace` are left alone:
/// they aren't images, and the CSP refuses what they'd load. A broken
/// unquoted `url(` (a bad-url token, such as a space after the scheme's
/// colon) becomes `none` without asking `decide`: a browser loads nothing
/// from one, and its text shouldn't stay to be read any other way. Returns
/// `css` unchanged when there is nothing to change.
pub fn rewrite_urls(css: &str, mut decide: impl FnMut(&str) -> CssUrl) -> String {
    let mut edits = Vec::new();
    let mut parser = Parser::new(css);
    collect_urls(&mut parser, false, &mut decide, &mut edits);
    if edits.is_empty() {
        return css.to_string();
    }
    let mut out = String::with_capacity(css.len());
    let mut copied = 0;
    for (start, end, text) in edits {
        out.push_str(&css[copied..start]);
        out.push_str(&text);
        copied = end;
    }
    out.push_str(&css[copied..]);
    out
}

/// Finds `rewrite_urls`'s addresses, recording `(start, end, replacement)`
/// byte ranges in order. `in_image_set`: plain strings here are addresses.
fn collect_urls(
    p: &mut Parser<'_>,
    in_image_set: bool,
    decide: &mut dyn FnMut(&str) -> CssUrl,
    edits: &mut Vec<(usize, usize, String)>,
) {
    loop {
        let start = p.position().byte_index();
        let Ok(token) = p.next_including_whitespace_and_comments().cloned() else {
            break;
        };
        match token {
            Token::UnquotedUrl(url) => {
                push_edit(decide, edits, start, p.position().byte_index(), &url, false)
            }
            Token::BadUrl(_) => edits.push((start, p.position().byte_index(), "none".into())),
            Token::Function(name) if name.eq_ignore_ascii_case("url") => {
                let mut url = None;
                let _ = p.parse_nested_block(|p| {
                    while let Ok(t) = p.next() {
                        if let Token::QuotedString(s) = t {
                            url.get_or_insert_with(|| s.to_string());
                        }
                    }
                    Ok::<_, Ignored>(())
                });
                if let Some(url) = url {
                    push_edit(decide, edits, start, p.position().byte_index(), &url, false);
                }
            }
            Token::QuotedString(s) if in_image_set => {
                push_edit(decide, edits, start, p.position().byte_index(), &s, true);
            }
            Token::AtKeyword(name)
                if ["import", "font-face", "namespace"]
                    .iter()
                    .any(|n| name.eq_ignore_ascii_case(n)) =>
            {
                // To the end of the rule; a block left unread is skipped.
                while let Ok(t) = p.next() {
                    if matches!(t, Token::Semicolon | Token::CurlyBracketBlock) {
                        break;
                    }
                }
            }
            Token::Function(name) => {
                let image_set = name.to_ascii_lowercase().ends_with("image-set");
                let _ = p.parse_nested_block(|p| {
                    collect_urls(p, image_set, decide, edits);
                    Ok::<_, Ignored>(())
                });
            }
            Token::ParenthesisBlock | Token::SquareBracketBlock | Token::CurlyBracketBlock => {
                let _ = p.parse_nested_block(|p| {
                    collect_urls(p, false, decide, edits);
                    Ok::<_, Ignored>(())
                });
            }
            _ => {}
        }
    }
}

/// Records what `decide` makes of one address at `start..end`. `quoted`:
/// a bare string (in `image-set()`) rather than `url(…)`.
fn push_edit(
    decide: &mut dyn FnMut(&str) -> CssUrl,
    edits: &mut Vec<(usize, usize, String)>,
    start: usize,
    end: usize,
    url: &str,
    quoted: bool,
) {
    let text = match decide(url) {
        CssUrl::Keep => return,
        CssUrl::Replace(new) if quoted => css_string(&new),
        CssUrl::Replace(new) => format!("url({})", css_string(&new)),
        CssUrl::Remove if quoted => "\"\"".into(),
        CssUrl::Remove => "none".into(),
    };
    edits.push((start, end, text));
}

/// `s` as a CSS string. Quotes, backslashes, control characters and `<` `>`
/// are escaped, so an address can't end the string, the rule or the
/// `<style>` element it's in.
fn css_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' | '\\' => {
                out.push('\\');
                out.push(c);
            }
            c if c < ' ' || c == '<' || c == '>' || c == '\u{7f}' => {
                out.push_str(&format!("\\{:x} ", c as u32));
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sheet(css: &str) -> Option<SheetRemap> {
        remap(&[css.to_string()])
    }

    #[test]
    fn parses_rules_media_and_important() {
        let rules = parse(
            "/* hi */ .a, td.b > p { color : #333 !important; margin:0 }
             @import url(x.css);
             @media only screen and (max-width:600px) { .c{background:#fff url(a.png) no-repeat} }
             @font-face { font-family: X; src: url(x) }",
        );
        assert_eq!(rules.len(), 2);
        assert_eq!(
            rules[0],
            Rule::Style {
                selector: ".a, td.b > p".into(),
                decls: vec![
                    Decl {
                        prop: "color".into(),
                        value: "#333".into()
                    },
                    Decl {
                        prop: "margin".into(),
                        value: "0".into()
                    },
                ],
            }
        );
        let Rule::Media { condition, rules } = &rules[1] else {
            panic!("media")
        };
        assert_eq!(condition, "only screen and (max-width:600px)");
        assert_eq!(rules.len(), 1);
    }

    #[test]
    fn colors_in_rules_are_remapped_for_dark_mode() {
        let out = sheet(
            ".text{color:#222} a{color:#1a73e8} .box{background-color:#ffffff;border:1px solid #ddd}
             .brand{background:#7b3fe4;color:#fff} p{margin:0}",
        )
        .unwrap();
        assert!(out.css.contains(".text{color:#"), "{}", out.css);
        assert!(out.css.contains("a{color:#"));
        assert!(out
            .css
            .contains(".box{background-color:transparent!important;border-color:rgba(255,255,255,0.12)!important;}"));
        // The brand banner and its white text stay, and rules without
        // colors aren't repeated.
        assert!(!out.css.contains(".brand"));
        assert!(!out.css.contains("p{"));
        assert!(!out.veil);
    }

    #[test]
    fn a_grey_page_makes_white_boxes_a_darker_card() {
        let out =
            sheet("body{background:#f4f4f4} .card{background:#fff} html{background:#fff}").unwrap();
        assert!(out.veil);
        assert!(out
            .css
            .contains(&format!("body{{background-color:{VEIL}!important;}}")));
        assert!(out.css.contains(&format!(
            ".card{{background-color:{CARD_IN_VEIL}!important;}}"
        )));
        assert!(out
            .css
            .contains("html{background-color:transparent!important;}"));
    }

    #[test]
    fn media_rules_keep_their_condition_and_color_scheme_ones_are_left_alone() {
        let out = sheet(
            "@media (max-width:600px){.m{color:#000}}
             @media (prefers-color-scheme: light){.l{color:#000}}
             @media (prefers-color-scheme: dark){.d{color:#000}}",
        )
        .unwrap();
        assert!(out.css.starts_with("@media (max-width:600px){.m{color:#"));
        assert!(!out.css.contains(".l") && !out.css.contains(".d"));
    }

    #[test]
    fn the_emails_own_dark_rules_win_for_the_same_selector() {
        // a vendor's: dark rules turn `.white-color` text white.
        let out = sheet(
            ".white-color{color:#172b4d;background:#ffffff}
             @media (prefers-color-scheme: dark){ .white-color { color: #FFFFFF !important } }",
        )
        .unwrap();
        // Its text color is theirs; its white background is still ours.
        assert_eq!(
            out.css,
            ".white-color{background-color:transparent!important;}"
        );
    }

    #[test]
    fn colors_it_cant_read_keep_the_white_card() {
        assert!(sheet(".a{color:var(--text)}").is_none());
        assert!(sheet(".a{color:color-mix(in srgb, red, blue)}").is_none());
        assert!(sheet(".a{background:linear-gradient(#fff,#eee)}").is_none());
        assert!(
            sheet(".a{background-image:linear-gradient(to bottom, #fff 0%, #eee 100%)}").is_none()
        );
        assert!(sheet(
            ".a{background-image:-webkit-gradient(linear, top, bottom, from(#000), to(#111))}"
        )
        .is_none());
        // Keywords, see-through colors, invalid values (browsers ignore
        // them), image-only backgrounds and dark gradients are fine.
        assert!(sheet(".a{color:inherit;background:url(x.png) no-repeat}").is_some());
        assert!(sheet(".a{background:rgba(0, 0, 0, 0.1)}")
            .unwrap()
            .css
            .is_empty());
        assert!(sheet(".a{color:#3333331}").unwrap().css.is_empty());
        assert!(
            sheet(".a{background-image:linear-gradient(90deg, #111 0%, rgba(0,0,0,0) 100%)}")
                .is_some()
        );
        // Outlook's system text color is black, so it's remapped.
        assert!(sheet(".a{color:windowtext}")
            .unwrap()
            .css
            .starts_with(".a{color:#"));
    }

    #[test]
    fn selectors_that_could_escape_the_sheet_are_dropped() {
        let out = sheet(".a</style><script>x{color:#000} .ok{color:#000}").unwrap();
        assert!(!out.css.contains('<'));
        assert!(out.css.contains(".ok{"));
    }
}
