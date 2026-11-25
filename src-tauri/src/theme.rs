//! Settings → Appearance → Theme. Setting it on the app (not in CSS) means
//! macOS draws the window's glass in that look, and the web view's
//! `prefers-color-scheme` follows, so the page's styles and the dark
//! styles emails bring all agree.
//!
//! On Linux the web view follows GTK's "prefer dark" setting, and tao 0.37
//! (Tauri's window layer, which Tauri 2 pins) gets it wrong both ways: it
//! takes "follow the system" (`None`) as light, and when the desktop's
//! theme changes it applies that even over a theme chosen in Settings. So
//! on Linux the app asks the desktop itself (the freedesktop settings
//! portal, as tao 0.38 does) and sets that, and puts a chosen theme back
//! whenever something changes GTK's setting under it (`linux::watch`).
//! The question goes to the desktop on a thread of its own, and only when
//! the choice becomes "follow the system" (and at startup): commands that
//! save settings run on the main thread, which a slow bus must not hold.

use mail_core::settings::Theme;
use tauri::AppHandle;

pub fn apply(app: &AppHandle, theme: Theme) {
    // Recorded first, so the desktop's answer (on another thread) and
    // `linux::watch` see this choice, never the one before it.
    #[cfg(target_os = "linux")]
    let previous = linux::chose(theme);
    match theme {
        #[cfg(target_os = "linux")]
        Theme::System => linux::follow_desktop(app, previous),
        #[cfg(not(target_os = "linux"))]
        Theme::System => app.set_theme(None),
        Theme::Light => app.set_theme(Some(tauri::Theme::Light)),
        Theme::Dark => app.set_theme(Some(tauri::Theme::Dark)),
    }
}

#[cfg(target_os = "linux")]
pub mod linux {
    use std::sync::atomic::{AtomicU64, AtomicU8, Ordering};
    use std::time::Duration;

    use mail_core::settings::Theme;
    use zbus::blocking::Connection;
    use zbus::zvariant::{OwnedValue, Value};

    const PORTAL: &str = "org.freedesktop.portal.Desktop";
    const PATH: &str = "/org/freedesktop/portal/desktop";

    /// The theme chosen in Settings: 0 system, 1 light, 2 dark; `UNSET`
    /// before the first is applied.
    static CHOICE: AtomicU8 = AtomicU8::new(UNSET);
    const UNSET: u8 = u8::MAX;

    /// Records the choice, and returns the one before it.
    pub(super) fn chose(theme: Theme) -> u8 {
        CHOICE.swap(code(theme), Ordering::AcqRel)
    }

    /// Whether choosing `next` needs the desktop asked: only when the
    /// choice becomes "follow the system" (at startup, `previous` is
    /// `UNSET`). While it stays that, tao follows the desktop's changes.
    pub fn asks_desktop(previous: u8, next: Theme) -> bool {
        next == Theme::System && previous != code(Theme::System)
    }

    /// How many times the desktop has been asked (each switch to "follow
    /// the system"), and how many times GTK's "prefer dark" has changed
    /// since `watch` began counting.
    static ASKED: AtomicU64 = AtomicU64::new(0);
    static CHANGED: AtomicU64 = AtomicU64::new(0);

    /// Whether an answer from the desktop still says something new: no
    /// later question was asked (a quick System, Light, System), and GTK's
    /// setting hasn't changed since (tao applied a newer theme from the
    /// desktop, or a theme was chosen). Either makes the answer stale.
    pub fn answer_holds(asked: (u64, u64), changed: (u64, u64)) -> bool {
        asked.0 == asked.1 && changed.0 == changed.1
    }

    /// "Follow the system": asks the desktop on a thread of its own, and
    /// sets its answer on the main thread (where settings are applied too,
    /// so nothing comes between the check and the set) if it still holds
    /// and the choice is still that. Leaves the window as it is until then
    /// (tao set it from the desktop when it made the window), never `None`,
    /// which tao 0.37 takes as light.
    pub(super) fn follow_desktop(app: &tauri::AppHandle, previous: u8) {
        if !asks_desktop(previous, Theme::System) {
            return;
        }
        let asked = ASKED.fetch_add(1, Ordering::AcqRel) + 1;
        let changed = CHANGED.load(Ordering::Acquire);
        let app = app.clone();
        std::thread::spawn(move || {
            let theme = desktop();
            let setter = app.clone();
            let _ = app.run_on_main_thread(move || {
                let now = (
                    ASKED.load(Ordering::Acquire),
                    CHANGED.load(Ordering::Acquire),
                );
                if answer_holds((asked, now.0), (changed, now.1))
                    && CHOICE.load(Ordering::Acquire) == code(Theme::System)
                {
                    setter.set_theme(Some(theme));
                }
            });
        });
    }

    fn code(theme: Theme) -> u8 {
        match theme {
            Theme::System => 0,
            Theme::Light => 1,
            Theme::Dark => 2,
        }
    }

    /// Whether GTK should prefer dark for a chosen theme: None for "follow
    /// the system", which tao keeps up with the desktop by itself.
    pub fn held(code: u8) -> Option<bool> {
        match code {
            1 => Some(false),
            2 => Some(true),
            _ => None,
        }
    }

    /// The portal's `color-scheme`: 1 prefers dark, 2 prefers light, 0 no
    /// preference, which GTK and tao take as light.
    pub fn from_color_scheme(scheme: u32) -> tauri::Theme {
        if scheme == 1 {
            tauri::Theme::Dark
        } else {
            tauri::Theme::Light
        }
    }

    /// The desktop's light or dark preference; light when it states none or
    /// can't be asked (no session bus, no portal, no answer within a second).
    fn desktop() -> tauri::Theme {
        zbus::blocking::connection::Builder::session()
            .ok()
            .and_then(|b| b.method_timeout(Duration::from_secs(1)).build().ok())
            .and_then(|c| color_scheme(&c))
            .map_or(tauri::Theme::Light, from_color_scheme)
    }

    /// Asks the settings portal on `connection` for the color scheme.
    /// `Read` (in every version of the portal, unlike `ReadOne`) wraps the
    /// value in a second variant.
    pub fn color_scheme(connection: &Connection) -> Option<u32> {
        let reply = connection
            .call_method(
                Some(PORTAL),
                PATH,
                Some("org.freedesktop.portal.Settings"),
                "Read",
                &("org.freedesktop.appearance", "color-scheme"),
            )
            .ok()?;
        let owned: OwnedValue = reply.body().deserialize().ok()?;
        let mut value: &Value = &owned;
        while let Value::Value(inner) = value {
            value = inner;
        }
        match value {
            Value::U32(scheme) => Some(*scheme),
            _ => None,
        }
    }

    /// Puts a chosen theme back whenever GTK's "prefer dark" changes under
    /// it. GTK tells after the change, on the main thread, whoever made it
    /// (tao, when the desktop's theme changes), so this always comes last.
    /// Setting the value it already has tells again, and then stops. Call
    /// once, on the main thread, after GTK has started (in `setup`).
    pub fn watch() {
        use gtk::prelude::GtkSettingsExt;
        let Some(settings) = gtk::Settings::default() else {
            return;
        };
        settings.connect_gtk_application_prefer_dark_theme_notify(|settings| {
            CHANGED.fetch_add(1, Ordering::AcqRel);
            if let Some(dark) = held(CHOICE.load(Ordering::Relaxed)) {
                if settings.is_gtk_application_prefer_dark_theme() != dark {
                    settings.set_gtk_application_prefer_dark_theme(dark);
                }
            }
        });
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use std::io::BufRead;
        use zbus::blocking::connection;

        #[test]
        fn a_chosen_theme_is_held_and_the_system_one_is_left_to_the_desktop() {
            assert_eq!(held(code(Theme::System)), None);
            assert_eq!(held(code(Theme::Light)), Some(false));
            assert_eq!(held(code(Theme::Dark)), Some(true));
        }

        /// Review (round 9): saving settings with the theme left on System
        /// doesn't ask the desktop again; switching to it, or starting with
        /// it, does.
        #[test]
        fn the_desktop_is_asked_only_when_the_choice_becomes_system() {
            assert!(asks_desktop(UNSET, Theme::System));
            assert!(asks_desktop(code(Theme::Dark), Theme::System));
            assert!(asks_desktop(code(Theme::Light), Theme::System));
            assert!(!asks_desktop(code(Theme::System), Theme::System));
            assert!(!asks_desktop(UNSET, Theme::Dark));
        }

        /// Review (round 10): an answer from an earlier switch to System,
        /// or one overtaken by a change of the desktop's theme, isn't set.
        #[test]
        fn a_stale_answer_from_the_desktop_is_dropped() {
            assert!(answer_holds((3, 3), (7, 7)));
            assert!(!answer_holds((3, 4), (7, 7)), "asked again since");
            assert!(!answer_holds((3, 3), (7, 8)), "changed since");
        }

        #[test]
        fn only_a_dark_preference_is_dark() {
            assert_eq!(from_color_scheme(1), tauri::Theme::Dark);
            assert_eq!(from_color_scheme(2), tauri::Theme::Light);
            assert_eq!(from_color_scheme(0), tauri::Theme::Light);
        }

        struct Portal(u32);

        #[zbus::interface(name = "org.freedesktop.portal.Settings")]
        impl Portal {
            fn read(&self, namespace: &str, key: &str) -> zbus::fdo::Result<OwnedValue> {
                if (namespace, key) != ("org.freedesktop.appearance", "color-scheme") {
                    return Err(zbus::fdo::Error::Failed("no such setting".into()));
                }
                // As the portal answers `Read`: a variant in a variant.
                Ok(OwnedValue::try_from(Value::new(Value::U32(self.0))).unwrap())
            }
        }

        /// Reads the color scheme from a stand-in portal on a private bus,
        /// unwrapping the second variant. Needs `dbus-daemon`; skipped with a
        /// note without it (CI has it).
        #[test]
        fn reads_the_color_scheme_from_the_settings_portal() {
            let Ok(mut daemon) = std::process::Command::new("dbus-daemon")
                .args(["--session", "--print-address", "--nofork"])
                .stdout(std::process::Stdio::piped())
                .spawn()
            else {
                assert!(std::env::var_os("CI").is_none(), "CI has dbus-daemon");
                eprintln!("skipped: no dbus-daemon here");
                return;
            };
            let mut address = String::new();
            std::io::BufReader::new(daemon.stdout.take().unwrap())
                .read_line(&mut address)
                .unwrap();
            let address = address.trim();
            for (scheme, theme) in [(1, tauri::Theme::Dark), (2, tauri::Theme::Light)] {
                let _portal = connection::Builder::address(address)
                    .unwrap()
                    .name(PORTAL)
                    .unwrap()
                    .serve_at(PATH, Portal(scheme))
                    .unwrap()
                    .build()
                    .unwrap();
                let client = connection::Builder::address(address)
                    .unwrap()
                    .build()
                    .unwrap();
                assert_eq!(color_scheme(&client), Some(scheme));
                assert_eq!(color_scheme(&client).map(from_color_scheme), Some(theme));
            }
            // No portal on the bus: no answer, so the caller takes light.
            let client = connection::Builder::address(address)
                .unwrap()
                .build()
                .unwrap();
            assert_eq!(color_scheme(&client), None);
            let _ = daemon.kill();
            let _ = daemon.wait();
        }
    }
}
