//! How the app was started: normally, as a clean start (`--clean-start`,
//! a first launch) or in demo mode (`--demo`, full of made-up mail from a
//! made-up Google, `mail_core::demo`). The other modes keep away from the
//! owner's own accounts, mail and settings: each gets a folder of its own
//! next to the normal one, its own keychain name (the demo uses none),
//! and a web view whose storage is thrown away when it quits. All of it
//! is emptied at every launch, so each run starts the same.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use mail_core::auth::{tokens, KeyringStore, MemoryStore, SecretStore};
use mail_core::db::{accounts, Db};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Normal,
    CleanStart,
    Demo,
}

impl Mode {
    /// From the program's arguments (`--clean-start`, `--demo`). Anything
    /// else is left to the code that reads them (Windows passes mailto:
    /// links).
    pub fn from_args<S: AsRef<str>>(args: impl IntoIterator<Item = S>) -> Self {
        for arg in args {
            match arg.as_ref() {
                "--clean-start" => return Mode::CleanStart,
                "--demo" => return Mode::Demo,
                _ => {}
            }
        }
        Mode::Normal
    }

    pub fn is_normal(self) -> bool {
        self == Mode::Normal
    }

    /// Added to the bundle ID for this mode's folder and keychain name.
    fn suffix(self) -> Option<&'static str> {
        match self {
            Mode::Normal => None,
            Mode::CleanStart => Some("clean-start"),
            Mode::Demo => Some("demo"),
        }
    }

    /// Where the window remembers its size and place, so this mode's
    /// window doesn't move the normal one.
    pub fn window_state_file(self) -> String {
        match self.suffix() {
            None => tauri_plugin_window_state::DEFAULT_FILENAME.to_string(),
            Some(suffix) => format!(".window-state-{suffix}.json"),
        }
    }

    /// The keychain, under this mode's own name. The demo signs nobody
    /// in, so it keeps nothing there.
    pub fn secrets(self) -> Arc<dyn SecretStore> {
        match (self, self.suffix()) {
            (Mode::Demo, _) => Arc::new(MemoryStore::default()),
            (_, None) => Arc::new(KeyringStore::default()),
            (_, Some(suffix)) => Arc::new(KeyringStore::with_service(&keychain_service(suffix))),
        }
    }
}

fn keychain_service(suffix: &str) -> String {
    format!("{}.{suffix}", tokens::KEYCHAIN_SERVICE)
}

/// The folders the app keeps things in.
pub struct Dirs {
    pub data: PathBuf,
    pub config: PathBuf,
    pub cache: PathBuf,
    pub logs: PathBuf,
}

impl Dirs {
    /// One folder for everything, next to the normal data folder
    /// (`<bundle ID>.clean-start`).
    fn all_in(root: PathBuf) -> Self {
        Self {
            data: root.clone(),
            config: root.clone(),
            cache: root.join("cache"),
            logs: root.join("logs"),
        }
    }
}

/// This mode's folders. Outside the normal mode the folder is emptied
/// first, with the keychain entries its accounts left.
pub fn prepare(mode: Mode, normal: Dirs) -> std::io::Result<Dirs> {
    let Some(suffix) = mode.suffix() else {
        return Ok(normal);
    };
    let name = format!("{}.{suffix}", mail_core::brand::ID);
    let root = normal.data.with_file_name(name);
    forget_keychain(&root, mode.secrets().as_ref());
    match std::fs::remove_dir_all(&root) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e),
        _ => {}
    }
    Ok(Dirs::all_in(root))
}

/// Deletes the refresh tokens of the accounts a previous run signed in
/// (the keychain can't list them, so they're read from its database).
fn forget_keychain(root: &Path, secrets: &dyn SecretStore) {
    let path = mail_core::db::path_in(root);
    if !path.exists() {
        return;
    }
    let Ok(db) = Db::open(&path) else { return };
    let all = accounts::list(&db.conn()).unwrap_or_default();
    for account in all {
        let sub = accounts::google_sub(&db.conn(), account.id);
        if let Ok(sub) = sub {
            let _ = secrets.delete(&tokens::refresh_token_key(&sub));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mail_core::auth::MemoryStore;

    #[test]
    fn modes_come_from_the_arguments() {
        assert_eq!(Mode::from_args(Vec::<String>::new()), Mode::Normal);
        assert_eq!(Mode::from_args(["mailto:sam@example.com"]), Mode::Normal);
        assert_eq!(Mode::from_args(["--clean-start"]), Mode::CleanStart);
        assert_eq!(Mode::from_args(["--demo"]), Mode::Demo);
    }

    #[test]
    fn a_mode_keeps_away_from_the_normal_folders_and_keychain() {
        let normal = Dirs::all_in(PathBuf::from("/data/com.example.app"));
        let dirs = prepare(Mode::CleanStart, normal).unwrap();
        assert_eq!(
            dirs.data,
            PathBuf::from(format!("/data/{}.clean-start", mail_core::brand::ID))
        );
        assert_eq!(dirs.config, dirs.data);
        assert!(dirs.cache.starts_with(&dirs.data));
        assert!(dirs.logs.starts_with(&dirs.data));
        assert_eq!(
            keychain_service("clean-start"),
            format!("{}.clean-start", mail_core::brand::ID)
        );
        assert_eq!(Mode::Normal.window_state_file(), ".window-state.json");
        assert_ne!(Mode::CleanStart.window_state_file(), ".window-state.json");
        let demo = prepare(Mode::Demo, Dirs::all_in(PathBuf::from("/data/x"))).unwrap();
        assert_eq!(
            demo.data,
            PathBuf::from(format!("/data/{}.demo", mail_core::brand::ID))
        );
    }

    #[test]
    fn the_previous_runs_accounts_are_signed_out_of_the_keychain() {
        let root = std::env::temp_dir().join(format!("clean-start-test-{}", fastrand_id()));
        {
            let db = Db::open(&mail_core::db::path_in(&root)).unwrap();
            accounts::upsert(
                &db.conn(),
                &accounts::NewAccount {
                    google_sub: "sub-1",
                    email: "a@example.com",
                    display_name: None,
                    avatar_url: None,
                    oauth_client: "default",
                },
            )
            .unwrap();
        }
        let secrets = MemoryStore::default();
        secrets
            .set(&tokens::refresh_token_key("sub-1"), "token")
            .unwrap();
        forget_keychain(&root, &secrets);
        assert_eq!(
            secrets.get(&tokens::refresh_token_key("sub-1")).unwrap(),
            None
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    fn fastrand_id() -> u128 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    }
}
