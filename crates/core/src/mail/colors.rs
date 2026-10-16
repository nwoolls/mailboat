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
    /// Near-white page and panel backgrounds: show the glass through.
    Transparent,
    Color(Rgb),
    /// Already fine on a dark backdrop (dark, or a strong color).
    Keep,
}

impl Rgb {
    pub fn hex(self) -> String {
        format!("#{:02x}{:02x}{:02x}", self.0, self.1, self.2)
    }
}

/// Parses the CSS color forms emails actually use: `#rgb`, `#rrggbb`,
/// `rgb()`/`rgba()` and the common color names. Anything else (`inherit`,
/// `transparent`, gradients) is left alone by returning `None`.
pub fn parse_color(value: &str) -> Option<Rgb> {
    let v = value
        .trim()
        .trim_end_matches("!important")
        .trim()
        .to_ascii_lowercase();
    if let Some(hex) = v.strip_prefix('#') {
        let digits: Vec<u8> = hex
            .chars()
            .map(|c| c.to_digit(16).map(|d| d as u8))
            .collect::<Option<_>>()?;
        return match digits.as_slice() {
            [r, g, b] => Some(Rgb(r * 17, g * 17, b * 17)),
            [r1, r2, g1, g2, b1, b2] => Some(Rgb(r1 * 16 + r2, g1 * 16 + g2, b1 * 16 + b2)),
            _ => None,
        };
    }
    if let Some(args) = v
        .strip_prefix("rgba(")
        .or_else(|| v.strip_prefix("rgb("))
        .and_then(|rest| rest.strip_suffix(')'))
    {
        let parts: Vec<&str> = args
            .split([',', ' ', '/'])
            .filter(|p| !p.is_empty())
            .collect();
        if parts.len() < 3 {
            return None;
        }
        // A see-through color isn't worth remapping.
        if let Some(alpha) = parts.get(3) {
            let a: f32 = alpha.trim_end_matches('%').parse().ok()?;
            let a = if alpha.ends_with('%') { a / 100.0 } else { a };
            if a < 0.5 {
                return None;
            }
        }
        let channel = |p: &str| -> Option<u8> {
            let n: f32 = p.trim_end_matches('%').parse().ok()?;
            let n = if p.ends_with('%') { n * 2.55 } else { n };
            Some(n.clamp(0.0, 255.0).round() as u8)
        };
        return Some(Rgb(
            channel(parts[0])?,
            channel(parts[1])?,
            channel(parts[2])?,
        ));
    }
    NAMED
        .iter()
        .find(|(name, _)| *name == v)
        .map(|(_, rgb)| *rgb)
}

const NAMED: &[(&str, Rgb)] = &[
    ("black", Rgb(0, 0, 0)),
    ("white", Rgb(255, 255, 255)),
    ("gray", Rgb(128, 128, 128)),
    ("grey", Rgb(128, 128, 128)),
    ("darkgray", Rgb(169, 169, 169)),
    ("darkgrey", Rgb(169, 169, 169)),
    ("dimgray", Rgb(105, 105, 105)),
    ("dimgrey", Rgb(105, 105, 105)),
    ("lightgray", Rgb(211, 211, 211)),
    ("lightgrey", Rgb(211, 211, 211)),
    ("silver", Rgb(192, 192, 192)),
    ("whitesmoke", Rgb(245, 245, 245)),
    ("gainsboro", Rgb(220, 220, 220)),
    ("red", Rgb(255, 0, 0)),
    ("maroon", Rgb(128, 0, 0)),
    ("green", Rgb(0, 128, 0)),
    ("blue", Rgb(0, 0, 255)),
    ("navy", Rgb(0, 0, 128)),
    ("purple", Rgb(128, 0, 128)),
    ("teal", Rgb(0, 128, 128)),
    ("orange", Rgb(255, 165, 0)),
];

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

/// Backgrounds in dark mode: near-white neutrals become see-through (the
/// glass), light greys and pale tints become dark ones, and strong or
/// already dark colors stay.
pub fn dark_background(color: Rgb) -> DarkBackground {
    let (h, s, l) = to_hsl(color);
    // "Neutral" by chroma (how far apart the channels are), not HSL
    // saturation, which exaggerates tiny tints near white (#f6f8fa).
    let neutral = chroma(color) < 0.1;
    if l > 0.88 && neutral {
        DarkBackground::Transparent
    } else if l > 0.88 {
        // A pale tint (callout boxes): keep the hue, make it a dark tint.
        DarkBackground::Color(from_hsl(h, s.min(0.4), 0.2))
    } else if l > 0.6 && neutral {
        DarkBackground::Color(from_hsl(h, s, (1.0 - l).max(0.14)))
    } else {
        DarkBackground::Keep
    }
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
    fn backgrounds_go_to_glass_dark_tint_or_stay() {
        assert_eq!(
            dark_background(Rgb(255, 255, 255)),
            DarkBackground::Transparent
        );
        assert_eq!(
            dark_background(Rgb(0xf6, 0xf8, 0xfa)),
            DarkBackground::Transparent
        );
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
