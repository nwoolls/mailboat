//! The macOS menu bar: Tauri's standard menu plus Mailboat → Settings… (⌘,),
//! as in MonoCode's `menu.rs` and every Mac app. Choosing it tells the
//! window to open the Settings page.

use tauri::AppHandle;

#[cfg(target_os = "macos")]
const OPEN_SETTINGS: &str = "open_settings";

/// Sets the menu bar. Other platforms keep no menu bar (Settings opens
/// from the sidebar's gear there).
#[cfg(target_os = "macos")]
pub fn install(app: &AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItemBuilder, MenuItemKind, PredefinedMenuItem};
    use tauri_specta::Event;

    let menu = Menu::default(app)?;
    // The app menu comes first: About Mailboat, a separator, then Services…
    // Settings goes after the separator, with its own below it.
    if let Some(MenuItemKind::Submenu(app_menu)) = menu.items()?.into_iter().next() {
        let settings = MenuItemBuilder::with_id(OPEN_SETTINGS, "Settings…")
            .accelerator("CmdOrCtrl+,")
            .build(app)?;
        app_menu.insert_items(&[&settings, &PredefinedMenuItem::separator(app)?], 2)?;
    }
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        if event.id() == OPEN_SETTINGS {
            let _ = crate::events::OpenSettingsEvent.emit(app);
        }
    });
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn install(_app: &AppHandle) -> tauri::Result<()> {
    Ok(())
}
