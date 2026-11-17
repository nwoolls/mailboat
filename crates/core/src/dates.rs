//! Turning times into the app's milliseconds as `chrono` did before the move
//! to `jiff` (docs/ROADMAP.md → 0.3.0): rounding down, so a time a fraction
//! before 1970 is -1, not 0, and a leap second (`23:59:60`) counted as the
//! next second, not clamped back to `:59` as `jiff` reads it.

use jiff::civil::DateTime;
use jiff::{SignedDuration, Timestamp};

/// Milliseconds since 1970, rounded down.
pub fn millis(at: Timestamp) -> i64 {
    // In range: a Timestamp's nanoseconds over a million always fit.
    at.as_nanosecond().div_euclid(1_000_000) as i64
}

/// An RFC 3339 time (`2026-10-27T10:00:00-04:00`) in milliseconds, or None.
pub fn rfc3339_millis(text: &str) -> Option<i64> {
    let (text, leap) = without_leap_second(text);
    let at = text.parse::<Timestamp>().ok()?;
    Some(millis(at) + if leap { 1_000 } else { 0 })
}

/// A time without a zone (`2026-10-27T10:00:00`), and whether it was a leap
/// second, read as `:59` plus that second once it is placed in a zone.
pub fn civil(text: &str) -> Option<(DateTime, SignedDuration)> {
    let (text, leap) = without_leap_second(text);
    let time = text.parse::<DateTime>().ok()?;
    Some((time, SignedDuration::from_secs(if leap { 1 } else { 0 })))
}

/// The text with a `:60` seconds field made `:59`, and whether it was one.
fn without_leap_second(text: &str) -> (std::borrow::Cow<'_, str>, bool) {
    // `YYYY-MM-DDTHH:MM:60…`: the seconds sit at 17..19.
    if text.len() >= 19
        && text.is_char_boundary(17)
        && text.is_char_boundary(19)
        && &text[17..19] == "60"
    {
        (format!("{}59{}", &text[..17], &text[19..]).into(), true)
    } else {
        (text.into(), false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The values `chrono` gave for these (checked before it was removed).
    #[test]
    fn reads_as_chrono_did() {
        assert_eq!(
            rfc3339_millis("2026-10-20T14:00:00-04:00"),
            Some(1_792_519_200_000)
        );
        assert_eq!(
            rfc3339_millis("2026-10-20T18:00:00.123Z"),
            Some(1_792_519_200_123)
        );
        // Review: a leap second is the next second, not `:59`.
        assert_eq!(
            rfc3339_millis("2016-12-31T23:59:60Z"),
            Some(1_483_228_800_000)
        );
        // Review: rounded down before 1970, not toward zero.
        assert_eq!(rfc3339_millis("1969-12-31T23:59:59.999999Z"), Some(-1));
        assert_eq!(rfc3339_millis("not a time"), None);
    }

    #[test]
    fn a_civil_leap_second_is_read_as_59_plus_a_second() {
        let (time, extra) = civil("2016-12-31T23:59:60").unwrap();
        assert_eq!(time.to_string(), "2016-12-31T23:59:59");
        assert_eq!(extra, SignedDuration::from_secs(1));
        let (_, none) = civil("2016-12-31T23:59:59").unwrap();
        assert_eq!(none, SignedDuration::ZERO);
    }
}
