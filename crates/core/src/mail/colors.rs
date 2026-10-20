//! Remapping an email's own colors for dark mode, so emails can sit on the
//! reader's glass instead of a white card (the way Gmail's mobile app
//! adapts mail). Only near-whites and near-blacks really change; strong
//! brand colors keep their hue, and images are never touched.
//!
//! The sanitizer leaves the original colors in place (they're what light
//! mode shows) and adds a `prefers-color-scheme: dark` style sheet built
//! from these mappings, so switching macOS's appearance updates open mail.

/// An sRGB color, 0–255 per channel.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rgb(pub u8, pub u8, pub u8);

/// What a background becomes in dark mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DarkBackground {
    /// White and near-white page and panel backgrounds: show the glass
    /// through (or, inside a `Veil`, a slightly darker card; see the
    /// sanitizer).
    Transparent,
    /// Light greys (a page behind a white card): a faint light lift, so the
    /// card inside still stands apart from it, as Mimestream shows them.
    Veil,
    Color(Rgb),
    /// Already fine on a dark backdrop (dark, or a strong color).
    Keep,
}

impl Rgb {
    pub fn hex(self) -> String {
        format!("#{:02x}{:02x}{:02x}", self.0, self.1, self.2)
    }
}

/// Parses the CSS color forms emails actually use: hex (`#rgb`, `#rgba`,
/// `#rrggbb`, `#rrggbbaa`), `rgb()`/`rgba()`, `hsl()`/`hsla()`, the CSS
/// color names and Outlook's `windowtext`. Mostly see-through colors and
/// anything else (`inherit`, `transparent`, gradients) give `None`.
pub fn parse_color(value: &str) -> Option<Rgb> {
    match read_color(value) {
        ColorRead::Color(c) => Some(c),
        _ => None,
    }
}

/// What a CSS color value is, as far as remapping goes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ColorRead {
    Color(Rgb),
    /// Mostly see-through (alpha under 0.5), or `transparent`: nothing to
    /// remap.
    SeeThrough,
    /// Not a color this can read.
    Unknown,
}

pub fn read_color(value: &str) -> ColorRead {
    let v = value
        .trim()
        .trim_end_matches("!important")
        .trim()
        .to_ascii_lowercase();
    let color = |r, g, b, alpha: f32| {
        if alpha < 0.5 {
            ColorRead::SeeThrough
        } else {
            ColorRead::Color(Rgb(r, g, b))
        }
    };
    if v == "transparent" {
        return ColorRead::SeeThrough;
    }
    if let Some(hex) = v.strip_prefix('#') {
        return match cssparser::color::parse_hash_color(hex.as_bytes()) {
            Ok((r, g, b, a)) => color(r, g, b, a),
            Err(()) => ColorRead::Unknown,
        };
    }
    for (prefix, hsl) in [
        ("rgba(", false),
        ("rgb(", false),
        ("hsla(", true),
        ("hsl(", true),
    ] {
        let Some(args) = v.strip_prefix(prefix).and_then(|r| r.strip_suffix(')')) else {
            continue;
        };
        let parts: Vec<&str> = args
            .split([',', ' ', '/'])
            .filter(|p| !p.is_empty())
            .collect();
        if parts.len() < 3 {
            return ColorRead::Unknown;
        }
        let number = |p: &str| -> Option<(f32, bool)> {
            let percent = p.ends_with('%');
            let n: f32 = p
                .trim_end_matches('%')
                .trim_end_matches("deg")
                .parse()
                .ok()?;
            Some((n, percent))
        };
        let alpha = match parts.get(3).map(|a| number(a)) {
            None => 1.0,
            Some(Some((a, true))) => a / 100.0,
            Some(Some((a, false))) => a,
            Some(None) => return ColorRead::Unknown,
        };
        let (Some(a), Some(b), Some(c)) = (number(parts[0]), number(parts[1]), number(parts[2]))
        else {
            return ColorRead::Unknown;
        };
        if hsl {
            let unit = |(n, _): (f32, bool)| (n / 100.0).clamp(0.0, 1.0);
            let Rgb(r, g, b) = from_hsl(a.0.rem_euclid(360.0), unit(b), unit(c));
            return color(r, g, b, alpha);
        }
        let channel = |(n, percent): (f32, bool)| {
            let n = if percent { n * 2.55 } else { n };
            n.clamp(0.0, 255.0).round() as u8
        };
        return color(channel(a), channel(b), channel(c), alpha);
    }
    // Outlook (Word) writes text colors as the system's window text.
    if v == "windowtext" {
        return color(0, 0, 0, 1.0);
    }
    match cssparser::color::parse_named_color(&v) {
        Ok((r, g, b)) => color(r, g, b, 1.0),
        Err(()) => ColorRead::Unknown,
    }
}

/// A CSS value split at spaces (or `sep`), keeping brackets whole:
/// `1px solid rgb(0, 0, 0)` is three parts.
pub fn parts(value: &str, sep: char) -> Vec<&str> {
    let mut out = Vec::new();
    let mut depth = 0u32;
    let mut start = 0;
    for (i, ch) in value.char_indices() {
        match ch {
            '(' => depth += 1,
            ')' => depth = depth.saturating_sub(1),
            c if depth == 0 && (c == sep || (sep == ' ' && c.is_whitespace())) => {
                if !value[start..i].trim().is_empty() {
                    out.push(value[start..i].trim());
                }
                start = i + c.len_utf8();
            }
            _ => {}
        }
    }
    if !value[start..].trim().is_empty() {
        out.push(value[start..].trim());
    }
    out
}

/// Hue in degrees, saturation and lightness 0–1.
fn to_hsl(Rgb(r, g, b): Rgb) -> (f32, f32, f32) {
    let (r, g, b) = (r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0);
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let l = (max + min) / 2.0;
    if max == min {
        return (0.0, 0.0, l);
    }
    let d = max - min;
    let s = if l > 0.5 {
        d / (2.0 - max - min)
    } else {
        d / (max + min)
    };
    let h = if max == r {
        ((g - b) / d).rem_euclid(6.0)
    } else if max == g {
        (b - r) / d + 2.0
    } else {
        (r - g) / d + 4.0
    };
    (h * 60.0, s, l)
}

fn from_hsl(h: f32, s: f32, l: f32) -> Rgb {
    let c = (1.0 - (2.0 * l - 1.0).abs()) * s;
    let x = c * (1.0 - ((h / 60.0).rem_euclid(2.0) - 1.0).abs());
    let m = l - c / 2.0;
    let (r, g, b) = match (h / 60.0) as u32 {
        0 => (c, x, 0.0),
        1 => (x, c, 0.0),
        2 => (0.0, c, x),
        3 => (0.0, x, c),
        4 => (x, 0.0, c),
        _ => (c, 0.0, x),
    };
    let to = |v: f32| ((v + m) * 255.0).round().clamp(0.0, 255.0) as u8;
    Rgb(to(r), to(g), to(b))
}

/// Text in dark mode: dark text turns light (greys mirror their lightness,
/// colors keep their hue and get lighter); text that's already light, like
/// white on a brand-colored banner, is left as it is.
pub fn dark_text(color: Rgb) -> Option<Rgb> {
    let (h, s, l) = to_hsl(color);
    if l >= 0.55 {
        return None;
    }
    let light = (1.0 - l).clamp(0.62, 0.9);
    Some(from_hsl(h, s.min(0.85), light))
}

/// Backgrounds in dark mode: white becomes see-through (the glass), the
/// lightest greys a faint lift, light greys and pale tints dark ones, and
/// strong or already dark colors stay.
pub fn dark_background(color: Rgb) -> DarkBackground {
    let (h, s, l) = to_hsl(color);
    // "Neutral" by chroma (how far apart the channels are), not HSL
    // saturation, which exaggerates tiny tints near white (#f6f8fa).
    let neutral = chroma(color) < 0.1;
    if l >= 0.97 && neutral {
        DarkBackground::Transparent
    } else if l > 0.88 && neutral {
        DarkBackground::Veil
    } else if l > 0.88 {
        // A pale tint (callout boxes): keep the hue, make it a dark tint.
        DarkBackground::Color(from_hsl(h, s.min(0.4), 0.2))
    } else if l > 0.6 && neutral {
        DarkBackground::Color(from_hsl(h, s, (1.0 - l).max(0.14)))
    } else {
        DarkBackground::Keep
    }
}

/// Borders in dark mode: grey ones, from near-white hairlines meant to be
/// barely visible on white to near-black rules, become one faint light
/// line like the app's own dividers; colored borders (a brand button's
/// outline) stay.
pub fn dark_border(color: Rgb) -> Option<&'static str> {
    (chroma(color) < 0.1).then_some("rgba(255,255,255,0.12)")
}

/// Max minus min channel, 0–1: near zero for greys, whatever their tint.
fn chroma(Rgb(r, g, b): Rgb) -> f32 {
    (r.max(g).max(b) - r.min(g).min(b)) as f32 / 255.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_forms_emails_use() {
        assert_eq!(parse_color("#fff"), Some(Rgb(255, 255, 255)));
        assert_eq!(parse_color(" #1F2328 "), Some(Rgb(31, 35, 40)));
        assert_eq!(parse_color("rgb(10, 20, 30)"), Some(Rgb(10, 20, 30)));
        assert_eq!(parse_color("rgba(10,20,30,1)"), Some(Rgb(10, 20, 30)));
        assert_eq!(parse_color("Black !important"), Some(Rgb(0, 0, 0)));
        assert_eq!(parse_color("inherit"), None);
        assert_eq!(parse_color("rgba(0,0,0,0.1)"), None, "mostly see-through");
        assert_eq!(parse_color("#12345"), None);
        assert_eq!(parse_color("DodgerBlue"), Some(Rgb(30, 144, 255)));
        assert_eq!(parse_color("windowtext"), Some(Rgb(0, 0, 0)));
        assert_eq!(parse_color("#ffffff80"), Some(Rgb(255, 255, 255)));
        assert_eq!(parse_color("hsl(0, 0%, 100%)"), Some(Rgb(255, 255, 255)));
        assert_eq!(parse_color("hsl(120deg 100% 25%)"), Some(Rgb(0, 128, 0)));
        assert_eq!(read_color("rgba(0, 0, 0, 0.05)"), ColorRead::SeeThrough);
        assert_eq!(read_color("#0000"), ColorRead::SeeThrough);
        assert_eq!(read_color("transparent"), ColorRead::SeeThrough);
        assert_eq!(read_color("var(--x)"), ColorRead::Unknown);
    }

    #[test]
    fn values_split_at_spaces_but_not_inside_brackets() {
        assert_eq!(
            parts("1px solid rgb(0, 0, 0)", ' '),
            vec!["1px", "solid", "rgb(0, 0, 0)"]
        );
        assert_eq!(
            parts("linear-gradient(#fff, #eee), url(a.png)", ','),
            vec!["linear-gradient(#fff, #eee)", "url(a.png)"]
        );
    }

    #[test]
    fn dark_text_turns_light_and_light_text_stays() {
        let black = dark_text(Rgb(0, 0, 0)).unwrap();
        assert!(to_hsl(black).2 > 0.85);
        let grey = dark_text(Rgb(0x66, 0x66, 0x66)).unwrap();
        assert!((0.6..0.66).contains(&to_hsl(grey).2));
        assert_eq!(dark_text(Rgb(255, 255, 255)), None);
        assert_eq!(dark_text(Rgb(0xdd, 0xdd, 0xdd)), None);
    }

    #[test]
    fn dark_links_keep_their_hue() {
        let (h0, _, _) = to_hsl(Rgb(0x0b, 0x57, 0xd0));
        let lighter = dark_text(Rgb(0x0b, 0x57, 0xd0)).unwrap();
        let (h1, _, l1) = to_hsl(lighter);
        assert!((h0 - h1).abs() < 2.0);
        assert!(l1 >= 0.6);
    }

    #[test]
    fn grey_borders_go_faint_and_colored_ones_stay() {
        assert!(dark_border(Rgb(0xea, 0xea, 0xea)).is_some());
        assert!(dark_border(Rgb(0x33, 0x33, 0x33)).is_some());
        assert_eq!(dark_border(Rgb(0x30, 0x79, 0xed)), None);
    }

    #[test]
    fn backgrounds_go_to_glass_dark_tint_or_stay() {
        assert_eq!(
            dark_background(Rgb(255, 255, 255)),
            DarkBackground::Transparent
        );
        assert_eq!(
            dark_background(Rgb(0xf6, 0xf8, 0xfa)),
            DarkBackground::Transparent
        );
        // Gmail's light grey page behind a white card: a faint lift.
        assert_eq!(dark_background(Rgb(0xf5, 0xf5, 0xf5)), DarkBackground::Veil);
        // Pale yellow callout: a dark yellow tint, not glass.
        assert!(matches!(
            dark_background(Rgb(0xff, 0xf8, 0xc5)),
            DarkBackground::Color(_)
        ));
        // Light grey panel: a dark grey.
        assert!(matches!(
            dark_background(Rgb(0xdd, 0xdd, 0xdd)),
            DarkBackground::Color(_)
        ));
        // an identity vendor's purple banner and dark backgrounds stay.
        assert_eq!(dark_background(Rgb(0xb8, 0xae, 0xf2)), DarkBackground::Keep);
        assert_eq!(dark_background(Rgb(0x22, 0x22, 0x22)), DarkBackground::Keep);
    }
}
