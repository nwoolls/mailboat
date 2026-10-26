//! The macOS menu bar: Tauri's standard menu plus the app → Settings… (⌘,),
//! as in MonoCode's `menu.rs` and every Mac app, and the app's own
//! commands. The window decides those (`features/commands`: one list for
//! the menu bar, the right-click menu and ⌘K) and sends them here with
//! `menu_bar_set`; their names and whether they're on follow with
//! `menu_bar_update`. Choosing one sends `MenuCommandEvent` back.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::menu::MenuItem;
use tauri::AppHandle;

#[cfg(target_os = "macos")]
const OPEN_SETTINGS: &str = "open_settings";
/// The window's commands' menu IDs start with this.
#[cfg(target_os = "macos")]
const COMMAND_PREFIX: &str = "cmd:";

/// One of the window's menus: joins macOS's own of that name (File,
/// View), or is added before Window.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MenuSpec {
    pub title: String,
    pub items: Vec<MenuEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum MenuEntry {
    Item {
        id: String,
        title: String,
        /// Tauri's accelerator form, e.g. "Shift+Cmd+R".
        accel: Option<String>,
        enabled: bool,
    },
    Separator,
}

/// A command's current name and whether it can be chosen.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MenuItemState {
    pub id: String,
    pub title: String,
    pub enabled: bool,
}

/// The window's menu items, by command ID, for updates (macOS only:
/// elsewhere there's no menu bar).
#[derive(Default)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub struct MenuItems(Mutex<HashMap<String, MenuItem<tauri::Wry>>>);

/// Sets the standard menu bar (with Settings…) until the window sends its
/// commands. Other platforms keep no menu bar (Settings opens from the
/// sidebar's gear there).
#[cfg(target_os = "macos")]
pub fn install(app: &AppHandle) -> tauri::Result<()> {
    use tauri_specta::Event;

    app.set_menu(standard_menu(app)?)?;
    app.on_menu_event(|app, event| {
        let id = event.id().as_ref();
        if id == OPEN_SETTINGS {
            let _ = crate::events::OpenSettingsEvent.emit(app);
        } else if let Some(command) = id.strip_prefix(COMMAND_PREFIX) {
            let _ = crate::events::MenuCommandEvent(command.to_string()).emit(app);
        }
    });
    Ok(())
}

#[cfg(target_os = "macos")]
fn standard_menu(app: &AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{Menu, MenuItemBuilder, MenuItemKind, PredefinedMenuItem};

    let menu = Menu::default(app)?;
    // The app menu comes first: About the app, a separator, then Services…
    // Settings goes after the separator, with its own below it.
    if let Some(MenuItemKind::Submenu(app_menu)) = menu.items()?.into_iter().next() {
        let settings = MenuItemBuilder::with_id(OPEN_SETTINGS, "Settings…")
            .accelerator("CmdOrCtrl+,")
            .build(app)?;
        app_menu.insert_items(&[&settings, &PredefinedMenuItem::separator(app)?], 2)?;
    }
    Ok(menu)
}

/// Rebuilds the menu bar with the window's menus (safe to call again).
#[cfg(target_os = "macos")]
pub fn set(app: &AppHandle, specs: &[MenuSpec]) -> tauri::Result<()> {
    use tauri::menu::{
        IsMenuItem, MenuItemBuilder, MenuItemKind, PredefinedMenuItem, Submenu, SubmenuBuilder,
    };
    use tauri::Manager;

    let menu = standard_menu(app)?;
    let mut made = HashMap::new();
    for spec in specs {
        let mut items: Vec<MenuItemKind<tauri::Wry>> = Vec::new();
        for entry in &spec.items {
            match entry {
                MenuEntry::Separator => items.push(MenuItemKind::Predefined(
                    PredefinedMenuItem::separator(app)?,
                )),
                MenuEntry::Item {
                    id,
                    title,
                    accel,
                    enabled,
                } => {
                    let mut builder =
                        MenuItemBuilder::with_id(format!("{COMMAND_PREFIX}{id}"), title)
                            .enabled(*enabled);
                    if let Some(accel) = accel {
                        builder = builder.accelerator(accel);
                    }
                    let item = builder.build(app)?;
                    made.insert(id.clone(), item.clone());
                    items.push(MenuItemKind::MenuItem(item));
                }
            }
        }
        let refs: Vec<&dyn IsMenuItem<tauri::Wry>> = items
            .iter()
            .map(|i| i as &dyn IsMenuItem<tauri::Wry>)
            .collect();
        // Bind before matching: the list is read once, not held.
        let existing: Vec<MenuItemKind<tauri::Wry>> = menu.items()?;
        let same_name = existing.iter().find_map(|kind| match kind {
            MenuItemKind::Submenu(s) if s.text().ok().as_deref() == Some(spec.title.as_str()) => {
                Some(s.clone())
            }
            _ => None,
        });
        match same_name {
            // macOS's own File and View: ours first, then a separator.
            Some(submenu) => {
                let has_own = !submenu.items()?.is_empty();
                submenu.insert_items(&refs, 0)?;
                if has_own {
                    submenu.insert(&PredefinedMenuItem::separator(app)?, refs.len())?;
                }
            }
            // A new menu, before Window (second to last, before Help).
            None => {
                let submenu: Submenu<tauri::Wry> =
                    SubmenuBuilder::new(app, &spec.title).items(&refs).build()?;
                let at = existing.len().saturating_sub(2);
                menu.insert(&submenu, at)?;
            }
        }
    }
    app.set_menu(menu)?;
    *app.state::<MenuItems>().0.lock().unwrap() = made;
    Ok(())
}

/// New names and on/off states for the window's commands.
#[cfg(target_os = "macos")]
pub fn update(app: &AppHandle, states: &[MenuItemState]) -> tauri::Result<()> {
    use tauri::Manager;

    let items = app.state::<MenuItems>().0.lock().unwrap().clone();
    for state in states {
        if let Some(item) = items.get(&state.id) {
            item.set_text(&state.title)?;
            item.set_enabled(state.enabled)?;
        }
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn install(_app: &AppHandle) -> tauri::Result<()> {
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn set(_app: &AppHandle, _specs: &[MenuSpec]) -> tauri::Result<()> {
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn update(_app: &AppHandle, _states: &[MenuItemState]) -> tauri::Result<()> {
    Ok(())
}
