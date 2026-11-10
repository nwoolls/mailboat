mod ai;
mod app_icon;
mod badge;
mod codes;
mod commands;
mod dock;
mod email_menu;
mod error;
mod events;
mod files;
mod links;
mod mail_handler;
mod mcp;
mod menu;
mod mode;
mod notifications;
mod state;
mod sync_log;
mod theme;
mod trackpad;
mod updates;
mod window_place;

use std::sync::Arc;

use mail_core::db::Db;
use mail_core::demo::FakeGoogle;
use mail_core::sync::{Supervisor, SyncConfig, WorkerTiming};
use tauri::Manager;
use tauri_specta::{collect_commands, collect_events, Builder, Event};

use crate::events::{
    AccountsChangedEvent, IdentitiesChangedEvent, MailChangedEvent, MailtoEvent, MenuCommandEvent,
    OpenSettingsEvent, SyncProgressEvent, SyncStatusEvent, TauriSyncEvents,
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
            commands::oauth_client_save,
            commands::oauth_client_from_downloads,
            commands::account_add,
            commands::account_add_cancel,
            commands::account_remove,
            commands::data_delete_all,
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
            commands::sender_original_colors,
            commands::text_copy,
            commands::attachment_open,
            commands::attachment_preview,
            commands::attachment_save,
            commands::attachment_reveal,
            commands::email_image_save,
            commands::email_image_copy,
            commands::email_link_open,
            commands::email_link_copy,
            commands::download_reveal,
            commands::message_original,
            commands::message_original_save,
            commands::cache_size,
            commands::settings_defaults,
            commands::cache_clear,
            commands::spam_empty,
            commands::sync_log_reveal,
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
            commands::image_cache_size,
            commands::image_cache_clear,
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
            commands::menu_bar_set,
            commands::menu_bar_update,
            ai::ai_status,
            ai::ai_codex_check,
            ai::ai_codex_accept,
            ai::ai_connect,
            ai::ai_connect_cancel,
            ai::ai_disconnect,
            ai::ai_thread_summary,
            ai::ai_list_summaries,
            ai::ai_write,
            ai::ai_rewrite,
            ai::ai_translate,
            ai::ai_conversation_language,
            ai::ai_translation_languages,
            mcp::mcp_setup,
            mcp::mcp_connect_claude_code,
            mcp::mcp_connect_claude_desktop,
            mcp::mcp_log,
            ai::ai_reply_ideas,
            ai::ai_chatgpt_models,
            ai::ai_cancel,
            ai::ai_usage,
            ai::ai_summaries_clear,
            ai::ai_apple_settings_open,
            updates::update_check,
            updates::update_install,
        ])
        .events(collect_events![
            SyncStatusEvent,
            SyncProgressEvent,
            MailChangedEvent,
            IdentitiesChangedEvent,
            OpenSettingsEvent,
            AccountsChangedEvent,
            MailtoEvent,
            MenuCommandEvent,
            notifications::NotificationOpenedEvent,
            trackpad::TrackpadEvent,
            email_menu::EmailMenuEvent,
            codes::SignInCodeEvent,
            ai::AiTextEvent,
            ai::AiLineSummaryEvent,
            updates::UpdateAvailableEvent,
            updates::UpdateProgressEvent
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

/// `<app> --mcp` (see `mcp::run_proxy`); returns the exit code.
pub fn run_mcp_proxy() -> i32 {
    mcp::run_proxy()
}

pub fn run() {
    let builder = specta_builder();
    #[cfg(debug_assertions)]
    export_bindings(&std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(BINDINGS_PATH));

    let mode = mode::Mode::from_args(std::env::args().skip(1));
    let app = tauri::Builder::default();
    // Windows starts a second copy for a mailto: link clicked while the app
    // is open: it hands the link over and quits (must be the first
    // plugin). Not on the Mac, where macOS hands links to the running
    // copy itself and a dev build may run next to the installed one. A
    // clean start runs next to the normal copy, so it doesn't hand over.
    #[cfg(windows)]
    let app = if mode.is_normal() {
        app.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            mail_handler::open_args(app, argv.into_iter().skip(1));
        }))
    } else {
        app
    };
    app
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
                .with_filename(mode.window_state_file())
                .build(),
        )
        // New-mail notifications, shown from Rust (no web permission).
        .plugin(tauri_plugin_notification::init())
        // The app updating itself (src/updates.rs): Rust only, no web permission.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(mail_handler::MailtoQueue::default())
        .manage(menu::MenuItems::default())
        .manage(ai::AiState::new())
        .register_uri_scheme_protocol(mail_core::mail::links::SCHEME, |ctx, request| {
            links::handle(ctx.app_handle(), &request)
        })
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);
            // Windows passes a mailto: link that launched the app as an argument.
            #[cfg(windows)]
            mail_handler::open_args(app.handle(), std::env::args().skip(1));
            menu::install(app.handle())?;
            trackpad::watch(app.handle());
            email_menu::install(app.handle());
            notifications::install(app.handle());
            let dirs = mode::prepare(
                mode,
                mode::Dirs {
                    data: app.path().app_data_dir()?,
                    config: app.path().app_config_dir()?,
                    cache: app.path().app_cache_dir()?,
                    logs: app.path().app_log_dir()?,
                },
            )?;
            let db = Arc::new(Db::open(&mail_core::db::path_in(&dirs.data))?);
            let http = mail_core::reqwest::Client::builder()
                .user_agent(format!(
                    "{}/{}",
                    mail_core::brand::NAME,
                    mail_core::brand::VERSION
                ))
                .timeout(std::time::Duration::from_secs(60));
            // The demo's made-up Google is on this computer: no proxy.
            // Everything it talks to is Google over HTTPS, so a redirect
            // can't turn a request, its token or its body into plain HTTP.
            // The demo's made-up Google is `http://127.0.0.1`: no proxy,
            // and not HTTPS-only.
            let http = if mode == mode::Mode::Demo {
                http.no_proxy()
            } else {
                http.https_only(true)
            }
            .build()?;
            // Downloaded files of accounts that are gone: what a removal
            // couldn't delete, or something still running then wrote.
            let existing: Vec<mail_core::model::AccountId> =
                mail_core::db::accounts::list(&db.conn())?
                    .iter()
                    .map(|a| a.id)
                    .collect();
            for folder in ["attachments", "images"] {
                mail_core::attachments::remove_unlisted_account_folders(
                    &dirs.cache.join(folder),
                    &existing,
                );
            }
            let sync_log = Arc::new(sync_log::SyncLog::open(&dirs.logs));
            let supervisor = Supervisor::new(
                tauri::async_runtime::handle().inner().clone(),
                db.clone(),
                Arc::new(TauriSyncEvents {
                    app: app.handle().clone(),
                    log: sync_log.clone(),
                    db: db.clone(),
                    sign_outs: Default::default(),
                }),
                SyncConfig {
                    images: Some({
                        // Copies kept before the cache was per account.
                        mail_core::mail::prefetch::sweep_shared_copies(&dirs.cache.join("images"));
                        mail_core::mail::prefetch::Prefetch::new(dirs.cache.join("images"))?
                    }),
                    ..SyncConfig::default()
                },
                WorkerTiming::default(),
            );
            let state = AppState::new(
                db.clone(),
                http,
                mode.secrets(),
                supervisor,
                AppDirs {
                    config: dirs.config,
                    cache: dirs.cache,
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
            let state = if mode == mode::Mode::Demo {
                let google = start_demo(&db, &state.http)?;
                let mut state = state.with_demo(google);
                // `<prefix>_DEMO_SIGN_OUT_AFTER=<seconds>`: the second
                // account's sign-in ends then, to see the sign-out notice.
                state.demo_sign_out = std::env::var(format!(
                    "{}_DEMO_SIGN_OUT_AFTER",
                    mail_core::brand::ENV_PREFIX
                ))
                .ok()
                .and_then(|v| v.parse().ok())
                .map(std::time::Duration::from_secs);
                state
            } else {
                state
            };
            // Before the window first paints, so it opens in the chosen theme.
            let saved = mail_core::settings::load(&db.conn()).unwrap_or_default();
            theme::apply(app.handle(), saved.theme);
            // Summaries the person chose not to keep: forget what an exit that
            // never ran (a crash, a power cut) left behind, before sync, the
            // window or the AI queue can read or write one.
            let _ = mail_core::ai::summaries::forget_unless_kept(&db.conn());
            state.resume_all_accounts()?;
            app.manage(state);
            app.manage(updates::UpdatesEnabled(
                mode.is_normal() && !cfg!(debug_assertions),
            ));
            updates::watch(app.handle().clone());
            sync_demo_changes(app.handle());
            open_window(app, mode)?;
            // AI apps reach the app through a socket in the normal data
            // folder; another mode's copy leaves it to the normal one.
            if mode.is_normal() {
                mcp::start(app.handle().clone(), db.clone());
            }
            ai::run_line_queue(app.handle().clone());
            watch_other_copies(app.handle().clone(), db.clone());
            badge::watch(app.handle().clone(), db.clone());
            // After the plugin restored it: fully on a connected display.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window_place::keep_on_screen(&window);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the app")
        .run(|app, event| {
            // macOS hands over links the app is the default app for.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = &event {
                for url in urls {
                    mail_handler::open(app, url.as_str());
                }
            }
            if let tauri::RunEvent::Exit = event {
                ai::forget_unkept_summaries(app);
            }
            if let tauri::RunEvent::Ready = event {
                let choice = app
                    .try_state::<AppState>()
                    .and_then(|state| mail_core::settings::load(&state.db.conn()).ok())
                    .and_then(|s| s.app_icon);
                dock::show_at_launch(app_icon::png(choice.as_deref()));
            }
        });
}

/// Starts demo mode's made-up Google and fills the (fresh) database from
/// it before the window opens, so it opens full of mail.
fn start_demo(db: &Db, http: &mail_core::reqwest::Client) -> mail_core::Result<FakeGoogle> {
    let data = mail_core::demo::DemoData::builtin();
    tauri::async_runtime::block_on(async {
        let google = FakeGoogle::start(data.clone(), mail_core::demo::Timing::default()).await?;
        mail_core::demo::prepare(db, http, &google, &data).await?;
        Ok(google)
    })
}

/// Mail the demo's made-up Google sends (answers, scheduled mail) syncs
/// at once rather than at the next scheduled pass.
fn sync_demo_changes(app: &tauri::AppHandle) {
    let Some(google) = app.state::<AppState>().demo.clone() else {
        return;
    };
    let app = app.clone();
    google.on_change(Arc::new(move |email: &str| {
        let state = app.state::<AppState>();
        let all = mail_core::db::accounts::list(&state.db.conn()).unwrap_or_default();
        let changed: Vec<_> = all
            .iter()
            .filter(|a| a.email == email)
            .map(|a| a.id)
            .collect();
        state.supervisor.sync_now(Some(&changed));
    }));
}

/// The main window, from the config file (where it isn't created by
/// itself, so it opens after the state its first requests need). Outside
/// the normal mode its web storage (saved settings, recent searches) is
/// its own and gone when it quits.
fn open_window(app: &tauri::App, mode: mode::Mode) -> tauri::Result<()> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == "main")
        .cloned()
        .ok_or_else(|| tauri::Error::WindowNotFound)?;
    tauri::WebviewWindowBuilder::from_config(app.handle(), &config)?
        .incognito(!mode.is_normal())
        // The demo's scheduled mail counts from when the window is up.
        .on_page_load(|webview, payload| {
            if payload.event() == tauri::webview::PageLoadEvent::Finished {
                if let Some(google) = webview.state::<AppState>().demo.as_ref() {
                    google.start_clock();
                }
            }
        })
        .build()?;
    Ok(())
}

/// Another copy of the app (say a dev build next to the installed app)
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
            let accounts = mail_core::db::accounts::list(&db.conn()).unwrap_or_default();
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

    /// The updater's settings that keep it safe, pinned: its key is a public
    /// key (a minisign secret key file would say "secret key" where this says
    /// "public key"), it only talks over https, and an update must carry a
    /// signature made for the version it announces (the manifest isn't signed,
    /// so without this a crafted one could pair a newer number with an older,
    /// genuinely signed release).
    #[test]
    fn the_updater_is_configured_safely() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
        let conf: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        let updater = &conf["plugins"]["updater"];
        // Base64 of "untrusted comment: minisign public key".
        assert!(updater["pubkey"]
            .as_str()
            .unwrap()
            .starts_with("dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk"));
        let endpoints = updater["endpoints"].as_array().unwrap();
        assert!(!endpoints.is_empty());
        for endpoint in endpoints {
            assert!(endpoint.as_str().unwrap().starts_with("https://"));
        }
        assert_eq!(updater["requireSignedVersion"], true);
        assert!(updater.get("dangerousInsecureTransportProtocol").is_none());
        // Off here: it needs the private key at build time, so the release
        // workflow turns it on and pull-request builds don't need the key.
        assert!(conf["bundle"].get("createUpdaterArtifacts").is_none());
    }

    /// The `ring` crypto library isn't in the build. The updater plugin's own
    /// TLS feature adds it, and its assembly doesn't cross-compile for Windows
    /// ARM64 with cargo-xwin, which is how the release builds Windows on a Mac
    /// runner; native Windows CI doesn't notice. The app's TLS is rustls with
    /// aws-lc-rs already, so the updater's defaults are off (src-tauri/Cargo.toml).
    /// Asks `cargo tree` what is really built: `ring` stays in `Cargo.lock` (and in
    /// `cargo metadata`) as an unused optional dependency of other crates.
    #[test]
    fn the_ring_crypto_library_is_not_in_the_build() {
        let out = std::process::Command::new(env!("CARGO"))
            .args([
                "tree",
                "--locked",
                "--target",
                "all",
                "-e",
                "normal,build",
                "--prefix",
                "none",
            ])
            .current_dir(env!("CARGO_MANIFEST_DIR"))
            .output()
            .unwrap();
        assert!(out.status.success(), "cargo tree failed");
        let tree = String::from_utf8(out.stdout).unwrap();
        assert!(
            !tree.lines().any(|l| l.starts_with("ring v")),
            "`ring` is in the build again: see the comment on this test before accepting it"
        );
    }

    /// Tauri reads the app's name and ID from its own config files, not
    /// `brand.json`, so they're checked to match it.
    #[test]
    fn tauri_config_matches_the_brand() {
        use mail_core::brand;
        let read = |file: &str| -> serde_json::Value {
            let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(file);
            serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
        };
        let conf = read("tauri.conf.json");
        assert_eq!(
            conf["productName"],
            brand::NAME,
            "tauri.conf.json productName"
        );
        assert_eq!(conf["identifier"], brand::ID, "tauri.conf.json identifier");
        // The version is written once, in package.json; Tauri follows it.
        assert_eq!(
            conf["version"], "../package.json",
            "tauri.conf.json version must point at package.json"
        );
        assert_eq!(
            conf["mainBinaryName"],
            brand::SHORT_NAME,
            "tauri.conf.json mainBinaryName"
        );
        for file in ["tauri.conf.json", "tauri.windows.conf.json"] {
            for window in read(file)["app"]["windows"].as_array().unwrap() {
                assert_eq!(window["title"], brand::NAME, "{file} window title");
            }
        }
    }
}
