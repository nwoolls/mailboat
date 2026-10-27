//! The first launch under a new bundle ID copies the previous ID's
//! folders, database and sign-ins over (`mail_core::carry_over`). Runs
//! before the database opens and before the window (and so the web view,
//! whose saved settings are among the folders) is made.

use std::path::PathBuf;

use mail_core::auth::{KeyringStore, SecretStore};
use mail_core::carry_over;
use tauri::{AppHandle, Manager};

/// Copies everything over if this is the first launch under the new ID,
/// and says what it did, for the log.
pub fn run(app: &AppHandle, secrets: &dyn SecretStore) -> mail_core::Result<Option<String>> {
    let path = app.path();
    let dir = |d: tauri::Result<PathBuf>| d.map_err(|e| mail_core::CoreError::Other(e.to_string()));
    let data = dir(path.app_data_dir())?;
    let Some(previous_data) = carry_over::former(&data) else {
        return Ok(None);
    };
    if !carry_over::needed(&previous_data, &data) {
        return Ok(None);
    }
    let mut folders: Vec<PathBuf> = [
        path.app_data_dir(),
        path.app_config_dir(),
        path.app_local_data_dir(),
        path.app_cache_dir(),
        path.app_log_dir(),
    ]
    .into_iter()
    .flatten()
    .collect();
    folders.extend(web_view_data());
    folders.sort();
    folders.dedup();
    // A folder inside another (Windows keeps the logs inside the local
    // data folder) is copied with it.
    let outer: Vec<PathBuf> = folders.clone();
    folders.retain(|f| !outer.iter().any(|o| o != f && f.starts_with(o)));
    let pairs: Vec<(PathBuf, PathBuf)> = folders
        .into_iter()
        .filter_map(|to| Some((carry_over::former(&to)?, to)))
        .collect();
    let previous_keys = KeyringStore::with_service(mail_core::brand::PREVIOUS_ID);
    let outcome = carry_over::run(&previous_data, &data, &pairs, &previous_keys, secrets)?;
    Ok(Some(format!(
        "carried over from {}: {} files ({} missed), {} sign-ins ({} missed)",
        mail_core::brand::PREVIOUS_ID,
        outcome.files,
        outcome.files_missed,
        outcome.sign_ins,
        outcome.sign_ins_missed
    )))
}

/// Where macOS's web view keeps the window's saved settings, named after
/// the bundle ID. (Windows' WebView2 keeps them in the local data folder,
/// already copied.)
fn web_view_data() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var_os("HOME")?;
        Some(
            PathBuf::from(home)
                .join("Library/WebKit")
                .join(mail_core::brand::ID),
        )
    }
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}
