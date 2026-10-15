mod commands;
mod error;
mod events;
mod state;

use std::sync::Arc;

use mailboat_core::db::Db;
use mailboat_core::sync::{Supervisor, SyncConfig, WorkerTiming};
use tauri::Manager;
use tauri_specta::{collect_commands, collect_events, Builder};

use crate::events::{MailChangedEvent, SyncProgressEvent, SyncStatusEvent, TauriSyncEvents};
use crate::state::AppState;

pub const BINDINGS_PATH: &str = "../src/platform/tauri/bindings.ts";

/// Every command and event exposed to the UI. TS bindings are generated
/// from this list.
pub fn specta_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new()
        .commands(collect_commands![
            commands::accounts_list,
            commands::oauth_setup,
            commands::account_add,
            commands::account_remove,
            commands::threads_list,
            commands::thread_get,
            commands::labels_list,
            commands::message_open,
            commands::sender_allow_images,
            commands::sync_now,
            commands::sync_status_list,
            commands::open_external,
        ])
        .events(collect_events![
            SyncStatusEvent,
            SyncProgressEvent,
            MailChangedEvent
        ])
        // IDs and millisecond timestamps stay far below 2^53, so plain JS
        // numbers are exact.
        .dangerously_cast_bigints_to_number()
}

pub fn export_bindings(path: &std::path::Path) {
    specta_builder()
        .export(
            specta_typescript::Typescript::default().header("// @ts-nocheck"),
            path,
        )
        .expect("failed to export TypeScript bindings");
}

pub fn run() {
    let builder = specta_builder();
    #[cfg(debug_assertions)]
    export_bindings(&std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(BINDINGS_PATH));

    tauri::Builder::default()
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);
            let data_dir = app.path().app_data_dir()?;
            let config_dir = app.path().app_config_dir()?;
            let db = Arc::new(Db::open(&data_dir.join("mailboat.sqlite3"))?);
            let http = mailboat_core::reqwest::Client::builder()
                .user_agent(concat!("Mailboat/", env!("CARGO_PKG_VERSION")))
                .timeout(std::time::Duration::from_secs(60))
                .build()?;
            let supervisor = Supervisor::new(
                tauri::async_runtime::handle().inner().clone(),
                db.clone(),
                Arc::new(TauriSyncEvents(app.handle().clone())),
                SyncConfig::default(),
                WorkerTiming::default(),
            );
            let state = AppState::new(
                db.clone(),
                http,
                Arc::new(mailboat_core::auth::KeyringStore),
                supervisor,
                config_dir,
            );
            state.resume_all_accounts()?;
            app.manage(state);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Mailboat");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Fails if `bindings.ts` is out of date with the Rust types. Running
    /// this test (or `bun tauri dev`) regenerates the file.
    #[test]
    fn bindings_are_up_to_date() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(BINDINGS_PATH);
        let before = std::fs::read_to_string(&path).unwrap_or_default();
        export_bindings(&path);
        let after = std::fs::read_to_string(&path).unwrap();
        assert!(
            before == after,
            "src/platform/tauri/bindings.ts was out of date and has been regenerated; commit the new file"
        );
    }
}
