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

use mail_core::settings::Theme;
use tauri::AppHandle;

pub fn apply(app: &AppHandle, theme: Theme) {
    #[cfg(target_os = "linux")]
    linux::chose(theme);
    app.set_theme(match theme {
        #[cfg(target_os = "linux")]
        Theme::System => Some(linux::desktop()),
        #[cfg(not(target_os = "linux"))]
        Theme::System => None,
        Theme::Light => Some(tauri::Theme::Light),
        Theme::Dark => Some(tauri::Theme::Dark),
    });
}

#[cfg(target_os = "linux")]
pub mod linux {
    use std::sync::atomic::{AtomicU8, Ordering};
    use std::time::Duration;

    use mail_core::settings::Theme;
    use zbus::blocking::Connection;
    use zbus::zvariant::{OwnedValue, Value};

    const PORTAL: &str = "org.freedesktop.portal.Desktop";
    const PATH: &str = "/org/freedesktop/portal/desktop";

    /// The theme chosen in Settings: 0 system, 1 light, 2 dark.
    static CHOICE: AtomicU8 = AtomicU8::new(0);

    pub(super) fn chose(theme: Theme) {
        CHOICE.store(code(theme), Ordering::Relaxed);
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
    pub(super) fn desktop() -> tauri::Theme {
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
