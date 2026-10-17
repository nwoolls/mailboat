//! Settings → Appearance → App icon. The choices are the icons in
//! `design/icon/choices/`, rendered to PNG by `scripts/build-icon-choices.sh`
//! and built into the app. A choice shows in the Dock while Mailboat runs
//! (`dock::set_icon`); Finder and a quit app keep the built-in icon, since
//! changing the app's own files would break its code signature.

/// Each choice's name (its file name) and picture, in the order Settings
/// shows them: by hue from red round to pink, then white and silver.
pub const CHOICES: &[(&str, &[u8])] = &[
    ("C16-red", include_bytes!("../icons/choices/C16-red.png")),
    (
        "C09-coral",
        include_bytes!("../icons/choices/C09-coral.png"),
    ),
    (
        "C10-orange",
        include_bytes!("../icons/choices/C10-orange.png"),
    ),
    (
        "C11-amber",
        include_bytes!("../icons/choices/C11-amber.png"),
    ),
    ("C12-lime", include_bytes!("../icons/choices/C12-lime.png")),
    (
        "C13-green",
        include_bytes!("../icons/choices/C13-green.png"),
    ),
    ("C01-mint", include_bytes!("../icons/choices/C01-mint.png")),
    ("C02-teal", include_bytes!("../icons/choices/C02-teal.png")),
    ("C03-sky", include_bytes!("../icons/choices/C03-sky.png")),
    (
        "C17-system-blue",
        include_bytes!("../icons/choices/C17-system-blue.png"),
    ),
    (
        "C04-cobalt",
        include_bytes!("../icons/choices/C04-cobalt.png"),
    ),
    (
        "C05-indigo",
        include_bytes!("../icons/choices/C05-indigo.png"),
    ),
    (
        "C06-violet",
        include_bytes!("../icons/choices/C06-violet.png"),
    ),
    (
        "C07-magenta",
        include_bytes!("../icons/choices/C07-magenta.png"),
    ),
    ("C08-pink", include_bytes!("../icons/choices/C08-pink.png")),
    (
        "C14-white",
        include_bytes!("../icons/choices/C14-white.png"),
    ),
    (
        "C15-silver",
        include_bytes!("../icons/choices/C15-silver.png"),
    ),
];

/// The picture for a saved choice; `None` for the built-in icon, or a name
/// that's no longer offered.
pub fn png(choice: Option<&str>) -> Option<&'static [u8]> {
    let choice = choice?;
    CHOICES
        .iter()
        .find(|(name, _)| *name == choice)
        .map(|(_, png)| *png)
}

pub fn names() -> Vec<String> {
    CHOICES
        .iter()
        .map(|(name, _)| (*name).to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_choice_is_a_png_and_unknown_names_mean_the_built_in_icon() {
        for (name, png) in CHOICES {
            assert!(png.starts_with(b"\x89PNG"), "{name} isn't a PNG");
        }
        assert!(png(Some("C10-orange")).is_some());
        assert!(png(Some("nope")).is_none());
        assert!(png(None).is_none());
    }
}
