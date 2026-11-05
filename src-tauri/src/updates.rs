//! The app updating itself, through Tauri's updater plugin.
//!
//! Rust only: the web side gets no permission for the plugin, so the two
//! commands below are all it can do. The plugin reads the update address and
//! the public key from `tauri.conf.json` (`plugins.updater`). The address is
//! one the project controls, which redirects to the newest release's
//! manifest, and the plugin installs only an update signed by the private key
//! that matches the public one built in (kept off the repository, in the
//! release environment's secrets).
//!
//! Looking is automatic unless the person turns it off (Settings → About),
//! installing never is: it takes their click. A look fetches one static file
//! from the update server, which passes it on to GitHub, so both see the
//! person's IP address and the updater's own user agent. The app's version and
//! the kind of computer are not sent: the address has no placeholders for them.
//! Downloading an update tells GitHub which kind of computer it was for. The
//! README's privacy section says so.
//!
//! The manifest the plugin fetches is not signed, only the downloaded update
//! is, so nothing from the manifest but the version is ever shown (no release
//! notes), and `requireSignedVersion` in `tauri.conf.json` has the plugin
//! refuse an update whose signature wasn't made for the version announced.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use mail_core::CoreError;
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};
use tauri_specta::Event;

use crate::error::CmdResult;
use crate::state::AppState;

/// An update that can be installed.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
}

/// A look that nobody asked for found an update. Told once per version.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct UpdateAvailableEvent(pub UpdateInfo);

/// How far the download has got.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgressEvent {
    pub downloaded: u64,
    pub total: Option<u64>,
}

/// Whether this copy of the app looks for updates at all. Only a release
/// build run normally does: nothing is published for a development build,
/// and the demo and a clean start leave the real update server alone.
pub struct UpdatesEnabled(pub bool);

const FIRST_LOOK_AFTER: Duration = Duration::from_secs(30);
const LOOK_EVERY: Duration = Duration::from_secs(24 * 60 * 60);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

fn enabled(app: &AppHandle) -> bool {
    app.try_state::<UpdatesEnabled>().is_some_and(|e| e.0)
}

fn ensure_enabled(app: &AppHandle) -> Result<(), CoreError> {
    if enabled(app) {
        Ok(())
    } else {
        Err(CoreError::Other(
            "This copy of the app doesn't check for updates (a development build, the demo \
             or a clean start)."
                .into(),
        ))
    }
}

/// What to tell a person about a failed look or install. Fixed words, so
/// nothing the network said is shown as an explanation. The one exception is
/// the folder the previous version was left in when it couldn't be put back:
/// it is this computer's own path, shown only here on its screen, and the
/// person needs it to recover the app.
fn friendly(e: tauri_plugin_updater::Error) -> CoreError {
    use tauri_plugin_updater::Error as E;
    let words = match e {
        E::Reqwest(_) | E::Network(_) | E::ReleaseNotFound => {
            "Couldn't reach the update server. Check your connection and try again.".to_string()
        }
        E::Minisign(_) | E::Base64(_) | E::SignatureUtf8(_) => {
            "The update's signature didn't check out, so it wasn't installed.".to_string()
        }
        E::TargetNotFound(_) | E::TargetsNotFound(_) | E::UnsupportedArch | E::UnsupportedOs => {
            "There is no update for this kind of computer yet.".to_string()
        }
        E::PreviousAppNotRestored(path) => format!(
            "The update failed, and the previous version couldn't be put back: it is at {}.",
            path.display()
        ),
        _ => "The update failed.".to_string(),
    };
    CoreError::Other(words)
}

async fn look(app: &AppHandle) -> Result<Option<Update>, CoreError> {
    ensure_enabled(app)?;
    let updater = app
        .updater_builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(friendly)?;
    updater.check().await.map_err(friendly)
}

fn info(update: &Update) -> UpdateInfo {
    UpdateInfo {
        version: update.version.clone(),
    }
}

/// Set while an update is being installed, so a second request (the window
/// can't make one, but nothing else stops it) fails instead of running a second
/// download and swap of the app.
static INSTALLING: AtomicBool = AtomicBool::new(false);

struct InstallGuard;

impl InstallGuard {
    fn take() -> Option<Self> {
        INSTALLING
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .ok()
            .map(|_| Self)
    }
}

impl Drop for InstallGuard {
    fn drop(&mut self) {
        INSTALLING.store(false, Ordering::SeqCst);
    }
}

/// Looks for a newer version now ("Check for updates").
#[tauri::command]
#[specta::specta]
pub async fn update_check(app: AppHandle) -> CmdResult<Option<UpdateInfo>> {
    Ok(look(&app).await?.as_ref().map(info))
}

/// Downloads the newer version, checks its signature, installs it and
/// starts it. Progress goes to the window as events.
#[tauri::command]
#[specta::specta]
pub async fn update_install(app: AppHandle) -> CmdResult<()> {
    let Some(_installing) = InstallGuard::take() else {
        return Err(CoreError::Other("An update is already being installed.".into()).into());
    };
    let Some(update) = look(&app).await? else {
        return Err(CoreError::Other("The app is already up to date.".into()).into());
    };
    let mut downloaded: u64 = 0;
    update
        .download_and_install(
            |chunk, total| {
                downloaded += chunk as u64;
                let _ = UpdateProgressEvent { downloaded, total }.emit(&app);
            },
            || {},
        )
        .await
        .map_err(friendly)?;
    // The new version is in place. On Windows the installer has already
    // ended this process; on the Mac it is started here.
    app.restart()
}

/// Whether a look nobody asked for should happen: the setting is on.
fn wanted(app: &AppHandle) -> bool {
    if !enabled(app) {
        return false;
    }
    let Some(state) = app.try_state::<AppState>() else {
        return false;
    };
    let settings = mail_core::settings::load(&state.db.conn());
    settings.map(|s| s.auto_check_updates).unwrap_or(true)
}

/// Looks soon after launch, then about once a day while the app stays open,
/// and tells the window when a version it hasn't mentioned yet is there.
pub fn watch(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // Not at once: the app has work of its own to do at launch.
        tokio::time::sleep(FIRST_LOOK_AFTER).await;
        let mut told: Option<String> = None;
        loop {
            if wanted(&app) {
                if let Ok(Some(update)) = look(&app).await {
                    if told.as_deref() != Some(update.version.as_str()) {
                        told = Some(update.version.clone());
                        let _ = UpdateAvailableEvent(info(&update)).emit(&app);
                    }
                }
            }
            tokio::time::sleep(LOOK_EVERY).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri_plugin_updater::Error as E;

    fn said(e: E) -> String {
        friendly(e).to_string()
    }

    #[test]
    fn a_server_that_cannot_be_reached_is_told_in_fixed_words() {
        let words = said(E::ReleaseNotFound);
        assert_eq!(
            words,
            "Couldn't reach the update server. Check your connection and try again."
        );
        assert_eq!(
            said(E::Network("secret detail from the network".into())),
            words
        );
    }

    #[test]
    fn a_computer_with_no_update_says_so() {
        for e in [
            E::UnsupportedOs,
            E::UnsupportedArch,
            E::TargetNotFound("x".into()),
        ] {
            assert_eq!(said(e), "There is no update for this kind of computer yet.");
        }
    }

    #[test]
    fn a_failed_rollback_says_where_the_previous_version_is() {
        let words = said(E::PreviousAppNotRestored("/Applications/Old.app".into()));
        assert!(words.contains("couldn't be put back"));
        assert!(words.contains("/Applications/Old.app"));
    }

    #[test]
    fn anything_else_is_just_that_the_update_failed_with_nothing_from_the_error() {
        let words = said(E::Io(std::io::Error::other("a path and details")));
        assert_eq!(words, "The update failed.");
        assert_eq!(said(E::EmptyEndpoints), "The update failed.");
    }

    #[test]
    fn only_one_install_runs_at_a_time() {
        let first = InstallGuard::take();
        assert!(first.is_some());
        assert!(
            InstallGuard::take().is_none(),
            "a second install must be refused"
        );
        drop(first);
        // Finished (or failed): the next one may go ahead.
        assert!(InstallGuard::take().is_some());
    }
}
