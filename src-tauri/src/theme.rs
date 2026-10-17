//! Settings → Appearance → Theme. Setting it on the app (not in CSS) means
//! macOS draws the window's glass in that look, and the web view's
//! `prefers-color-scheme` follows, so the page's styles and the dark
//! styles emails bring all agree.

use mailboat_core::settings::Theme;
use tauri::AppHandle;

pub fn apply(app: &AppHandle, theme: Theme) {
    app.set_theme(match theme {
        Theme::System => None,
        Theme::Light => Some(tauri::Theme::Light),
        Theme::Dark => Some(tauri::Theme::Dark),
    });
}
