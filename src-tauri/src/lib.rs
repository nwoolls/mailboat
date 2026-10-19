mod app_icon;
mod commands;
mod dock;
mod error;
mod events;
mod files;
mod links;
mod mail_handler;
mod menu;
mod state;
mod sync_log;
mod theme;
mod trackpad;
mod window_place;

use std::sync::Arc;

use mailboat_core::db::Db;
use mailboat_core::sync::{Supervisor, SyncConfig, WorkerTiming};
use tauri::Manager;
use tauri_specta::{collect_commands, collect_events, Builder, Event};

use crate::events::{
    AccountsChangedEvent, IdentitiesChangedEvent, MailChangedEvent, MailtoEvent, OpenSettingsEvent,
    SyncProgressEvent, SyncStatusEvent, TauriSyncEvents,
};
use crate::state::{AppDirs, AppState};

pub const BINDINGS_PATH: &str = "../src/platform/tauri/bindings.ts";

/// Every command and event exposed to the UI. TS bindings are generated
/// from this list.
pub fn specta_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new()
        .commands(collect_commands![
            commands::accounts_list,
            commands::oauth_setup,
            commands::account_add,
            commands::account_add_cancel,
            commands::account_remove,
            commands::threads_list,
            commands::threads_load_older,
            commands::thread_get,
            commands::labels_list,
            commands::unread_counts,
            commands::message_open,
            commands::threads_set_read,
            commands::threads_set_archived,
            commands::threads_set_starred,
            commands::threads_set_trashed,
            commands::threads_set_spam,
            commands::label_create,
            commands::label_rename,
            commands::label_delete,
            commands::threads_change_labels,
            commands::sender_allow_images,
            commands::attachment_open,
            commands::attachment_preview,
            commands::attachment_save,
            commands::attachment_reveal,
            commands::identities_list,
            commands::contacts_list,
            commands::reply_source,
            commands::message_send,
            commands::draft_save,
            commands::draft_delete,
            commands::draft_open,
            commands::draft_discard,
            commands::link_open,
            commands::html_preview,
            commands::sync_now,
            commands::sync_status_list,
            commands::app_info,
            commands::settings_get,
            commands::settings_set,
            commands::account_set_color,
            commands::notification_settings_open,
            commands::invite_card,
            commands::invite_answer,
            commands::invite_remove,
            commands::rules_list,
            commands::rule_create,
            commands::rule_update,
            commands::rule_delete,
            commands::rule_match_count,
            commands::signature_set,
            commands::vacation_list,
            commands::vacation_set,
            commands::mailto_take,
            commands::mail_app_default,
            commands::mail_app_make_default,
        ])
        .events(collect_events![
            SyncStatusEvent,
            SyncProgressEvent,
            MailChangedEvent,
            IdentitiesChangedEvent,
            OpenSettingsEvent,
            AccountsChangedEvent,
            MailtoEvent,
            trackpad::TrackpadEvent
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
        // Remembers the window's position, size and maximized/full-screen
        // state between launches (Rust only: no web permission).
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED
                        | tauri_plugin_window_state::StateFlags::FULLSCREEN,
                )
                .build(),
        )
        // New-mail notifications, shown from Rust (no web permission).
        .plugin(tauri_plugin_notification::init())
        .manage(mail_handler::MailtoQueue::default())
        .register_uri_scheme_protocol(mailboat_core::mail::links::SCHEME, |ctx, request| {
            links::handle(ctx.app_handle(), &request)
        })
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);
            menu::install(app.handle())?;
            trackpad::watch(app.handle());
            let data_dir = app.path().app_data_dir()?;
            let config_dir = app.path().app_config_dir()?;
            let db = Arc::new(Db::open(&data_dir.join("mailboat.sqlite3"))?);
            let http = mailboat_core::reqwest::Client::builder()
                .user_agent(concat!("Mailboat/", env!("CARGO_PKG_VERSION")))
                .timeout(std::time::Duration::from_secs(60))
                .build()?;
            let sync_log = Arc::new(sync_log::SyncLog::open(&app.path().app_log_dir()?));
            let supervisor = Supervisor::new(
                tauri::async_runtime::handle().inner().clone(),
                db.clone(),
                Arc::new(TauriSyncEvents {
                    app: app.handle().clone(),
                    log: sync_log.clone(),
                    db: db.clone(),
                }),
                SyncConfig::default(),
                WorkerTiming::default(),
            );
            let state = AppState::new(
                db.clone(),
                http,
                Arc::new(mailboat_core::auth::KeyringStore),
                supervisor,
                AppDirs {
                    config: config_dir,
                    cache: app.path().app_cache_dir()?,
                    downloads: app.path().download_dir().ok(),
                },
                sync_log,
                Arc::new({
                    let app = app.handle().clone();
                    move || {
                        let _ = AccountsChangedEvent.emit(&app);
                    }
                }),
            );
            // Before the window first paints, so it opens in the chosen theme.
            let saved = mailboat_core::settings::load(&db.conn()).unwrap_or_default();
            theme::apply(app.handle(), saved.theme);
            state.resume_all_accounts()?;
            app.manage(state);
            watch_other_copies(app.handle().clone(), db.clone());
            // After the plugin restored it: fully on a connected display.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window_place::keep_on_screen(&window);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Mailboat")
        .run(|app, event| {
            // macOS hands over links Mailboat is the default app for.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = &event {
                for url in urls {
                    mail_handler::open(app, url.as_str());
                }
            }
            if let tauri::RunEvent::Ready = event {
                let choice = app
                    .try_state::<AppState>()
                    .and_then(|state| mailboat_core::settings::load(&state.db.conn()).ok())
                    .and_then(|s| s.app_icon);
                dock::show_at_launch(app_icon::png(choice.as_deref()));
            }
        });
}

/// Another copy of Mailboat (say a dev build next to the installed app)
/// shares this database and syncs too. Every 2 seconds, if it wrote
/// something, the window refreshes as if this copy had: one cheap SQLite
/// pragma, no file watching.
fn watch_other_copies(app: tauri::AppHandle, db: Arc<Db>) {
    tauri::async_runtime::spawn(async move {
        let mut tick = tokio::time::interval(std::time::Duration::from_secs(2));
        loop {
            tick.tick().await;
            if !db.changed_elsewhere().unwrap_or(false) {
                continue;
            }
            let accounts = mailboat_core::db::accounts::list(&db.conn()).unwrap_or_default();
            for account in accounts {
                let _ = MailChangedEvent {
                    account_id: account.id,
                }
                .emit(&app);
            }
            let _ = AccountsChangedEvent.emit(&app);
        }
    });
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
