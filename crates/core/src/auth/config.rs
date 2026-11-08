//! Loads the Google OAuth client. Credentials are never compiled in or
//! committed: they come from env vars or from the JSON file Google Cloud
//! Console downloads, saved in the app's config directory.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::error::{CoreError, Result};

pub const CLIENT_FILE_NAME: &str = "google-oauth-client.json";
pub const DEFAULT_CLIENT: &str = "default";

#[derive(Clone)]
pub struct OAuthClientConfig {
    /// Local name of this client config (stored per account).
    pub name: String,
    pub client_id: String,
    pub client_secret: String,
    pub auth_uri: String,
    pub token_uri: String,
    pub userinfo_uri: String,
    /// The Google Cloud project it belongs to, when the file names it:
    /// lets the app open Google Cloud pages on the right project.
    pub project_id: Option<String>,
}

// Never print the secret.
impl std::fmt::Debug for OAuthClientConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("OAuthClientConfig")
            .field("name", &self.name)
            .field("client_id", &self.client_id)
            .finish_non_exhaustive()
    }
}

/// The shape of the file Google Cloud Console downloads for a Desktop client.
#[derive(Deserialize)]
struct DownloadedFile {
    installed: Option<DownloadedClient>,
    web: Option<DownloadedClient>,
}

#[derive(Deserialize)]
struct DownloadedClient {
    client_id: String,
    client_secret: String,
    project_id: Option<String>,
}

/// A client file that passed `check`: what the setup screen shows of it.
/// Never the secret.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CheckedClient {
    pub client_id: String,
    /// The Google Cloud project it belongs to, when the file names it.
    pub project_id: Option<String>,
}

/// Google's downloaded files are a few hundred bytes; anything far bigger
/// is something else.
const MAX_CLIENT_FILE: usize = 64 * 1024;

/// Checks a client file given during setup (dropped, chosen, found in
/// Downloads, or built from a pasted ID and secret) and says plainly
/// what's wrong if it isn't a Desktop client. Stricter than `from_json`,
/// which still reads files saved before this check existed.
pub fn check(text: &str) -> std::result::Result<CheckedClient, String> {
    const NOT_A_CLIENT: &str = "This isn't a Google credentials file. Use the one you downloaded \
        after creating a Desktop app OAuth client (its name starts with \"client_secret_\").";
    if text.len() > MAX_CLIENT_FILE {
        return Err(NOT_A_CLIENT.into());
    }
    let value: serde_json::Value = serde_json::from_str(text).map_err(|_| NOT_A_CLIENT)?;
    if value.get("web").is_some() {
        return Err(
            "This is a \"Web application\" client. Create another OAuth client in Google \
            Cloud with Application type \"Desktop app\", and download its credentials."
                .into(),
        );
    }
    if value.get("type").and_then(|t| t.as_str()) == Some("service_account") {
        return Err(
            "This is a service account key, not an OAuth client. Create an OAuth \
            client with Application type \"Desktop app\", and download its credentials."
                .into(),
        );
    }
    let Some(installed) = value.get("installed") else {
        return Err(NOT_A_CLIENT.into());
    };
    let field = |k: &str| {
        installed
            .get(k)
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|v| !v.is_empty())
    };
    let client_id = field("client_id").ok_or(
        "This file has no client ID. Download the \
        Desktop app credentials again from Google Cloud.",
    )?;
    if !client_id.ends_with(".apps.googleusercontent.com") {
        return Err(format!(
            "\"{client_id}\" doesn't look like a Google client ID (they end in \
             .apps.googleusercontent.com)."
        ));
    }
    if field("client_secret").is_none() {
        return Err(
            "This file has no client secret. Google shows the secret only once, \
            when the client is created: create a new Desktop app OAuth client and download its \
            credentials straight away."
                .into(),
        );
    }
    Ok(CheckedClient {
        client_id: client_id.into(),
        project_id: field("project_id").map(Into::into),
    })
}

/// Checks `text` and saves it as the app's client file, readable only by
/// this user. Sign-in picks it up at once (`load` reads it every time).
pub fn save(config_dir: &Path, text: &str) -> Result<CheckedClient> {
    let checked = check(text).map_err(CoreError::Invalid)?;
    std::fs::create_dir_all(config_dir)
        .map_err(|e| CoreError::Other(format!("could not create the settings folder: {e}")))?;
    let path = client_file_path(config_dir);
    let tmp = path.with_extension("json.tmp");
    write_private(&tmp, text.trim().as_bytes())
        .and_then(|()| std::fs::rename(&tmp, &path))
        .map_err(|e| CoreError::Other(format!("could not save the client file: {e}")))?;
    Ok(checked)
}

#[cfg(unix)]
fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)?;
    file.write_all(bytes)
}

#[cfg(not(unix))]
fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    std::fs::write(path, bytes)
}

/// The newest client file Google's console downloaded into `dir` in the
/// last `within`, by its name (`client_secret_<id>.json`, with a ` (1)` and
/// so on when downloaded again).
pub fn find_download(dir: &Path, within: std::time::Duration) -> Option<PathBuf> {
    let now = std::time::SystemTime::now();
    std::fs::read_dir(dir)
        .ok()?
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            name.starts_with("client_secret_") && name.ends_with(".json")
        })
        .filter_map(|entry| {
            let modified = entry.metadata().ok()?.modified().ok()?;
            let age = now.duration_since(modified).unwrap_or_default();
            (age <= within).then(|| (modified, entry.path()))
        })
        .max_by_key(|(modified, _)| *modified)
        .map(|(_, path)| path)
}

/// Reads a client file found by `find_download`, refusing anything too
/// big to be one.
pub fn read_download(path: &Path) -> Result<String> {
    let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    if size > MAX_CLIENT_FILE as u64 {
        return Err(CoreError::Invalid(
            "That file is too big to be a client file.".into(),
        ));
    }
    std::fs::read_to_string(path)
        .map_err(|e| CoreError::Other(format!("could not read {}: {e}", path.display())))
}

const GOOGLE_AUTH_URI: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URI: &str = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URI: &str = "https://openidconnect.googleapis.com/v1/userinfo";

impl OAuthClientConfig {
    pub fn google(client_id: String, client_secret: String) -> Self {
        Self {
            name: DEFAULT_CLIENT.into(),
            client_id,
            client_secret,
            auth_uri: GOOGLE_AUTH_URI.into(),
            token_uri: GOOGLE_TOKEN_URI.into(),
            userinfo_uri: GOOGLE_USERINFO_URI.into(),
            project_id: None,
        }
    }

    /// Env vars win over the file, which makes local overrides easy.
    pub fn load(config_dir: &Path) -> Result<Self> {
        let env = |k: &str| std::env::var(k).ok().filter(|v| !v.trim().is_empty());
        if let (Some(id), Some(secret)) = (
            env(concat!(env!("BRAND_ENV_PREFIX"), "_GOOGLE_CLIENT_ID")),
            env(concat!(env!("BRAND_ENV_PREFIX"), "_GOOGLE_CLIENT_SECRET")),
        ) {
            return Ok(Self::google(id, secret));
        }
        Self::from_file(&config_dir.join(CLIENT_FILE_NAME))
    }

    pub fn from_file(path: &Path) -> Result<Self> {
        let text = std::fs::read_to_string(path).map_err(|_| missing(path))?;
        Self::from_json(&text).map_err(|e| {
            CoreError::Config(format!(
                "{} is not a valid Google OAuth client file: {e}",
                path.display()
            ))
        })
    }

    pub fn from_json(text: &str) -> std::result::Result<Self, String> {
        let file: DownloadedFile = serde_json::from_str(text).map_err(|e| e.to_string())?;
        let client = file
            .installed
            .or(file.web)
            .ok_or("expected an \"installed\" (Desktop app) client")?;
        // The file's `auth_uri` and `token_uri` are ignored: the endpoints
        // are always Google's. A file pointing `token_uri` elsewhere would
        // have every account's refresh token sent there.
        let mut config = Self::google(client.client_id, client.client_secret);
        config.project_id = client.project_id.filter(|p| !p.trim().is_empty());
        Ok(config)
    }
}

fn missing(path: &Path) -> CoreError {
    CoreError::Config(format!(
        "Google OAuth client not found. Download your Desktop OAuth client JSON from Google Cloud Console and save it as {}",
        path.display()
    ))
}

pub fn client_file_path(config_dir: &Path) -> PathBuf {
    config_dir.join(CLIENT_FILE_NAME)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_googles_downloaded_desktop_client_file() {
        let json = r#"{"installed":{"client_id":"123.apps.googleusercontent.com","project_id":"p",
            "auth_uri":"https://accounts.google.com/o/oauth2/auth","token_uri":"https://oauth2.googleapis.com/token",
            "client_secret":"shh","redirect_uris":["http://localhost"]}}"#;
        let c = OAuthClientConfig::from_json(json).unwrap();
        assert_eq!(c.client_id, "123.apps.googleusercontent.com");
        assert_eq!(c.client_secret, "shh");
        assert_eq!(c.project_id.as_deref(), Some("p"));
        assert_eq!(c.auth_uri, GOOGLE_AUTH_URI);
        assert!(
            !format!("{c:?}").contains("shh"),
            "Debug must not leak the secret"
        );
    }

    /// Regression: the file's `token_uri` was used as given, so a client
    /// file from anyone could have saved refresh tokens sent to them.
    #[test]
    fn a_client_file_cannot_move_googles_endpoints() {
        let json = r#"{"installed":{"client_id":"123.apps.googleusercontent.com",
            "client_secret":"shh","auth_uri":"https://attacker.example/auth",
            "token_uri":"https://attacker.example/token"}}"#;
        assert!(check(json).is_ok(), "the file is otherwise a valid client");
        let c = OAuthClientConfig::from_json(json).unwrap();
        assert_eq!(c.auth_uri, GOOGLE_AUTH_URI);
        assert_eq!(c.token_uri, GOOGLE_TOKEN_URI);
        assert_eq!(c.userinfo_uri, GOOGLE_USERINFO_URI);
    }

    const DESKTOP: &str = r#"{"installed":{"client_id":"123-abc.apps.googleusercontent.com",
        "project_id":"mail-123","client_secret":"shh","redirect_uris":["http://localhost"]}}"#;

    #[test]
    fn check_accepts_a_desktop_client_and_names_its_project() {
        let c = check(DESKTOP).unwrap();
        assert_eq!(c.client_id, "123-abc.apps.googleusercontent.com");
        assert_eq!(c.project_id.as_deref(), Some("mail-123"));
    }

    #[test]
    fn check_explains_each_wrong_file() {
        let web = r#"{"web":{"client_id":"1.apps.googleusercontent.com","client_secret":"s"}}"#;
        assert!(check(web).unwrap_err().contains("Desktop app"));
        let key = r#"{"type":"service_account","project_id":"p"}"#;
        assert!(check(key).unwrap_err().contains("service account"));
        assert!(check("not json")
            .unwrap_err()
            .contains("isn't a Google credentials file"));
        assert!(check(r#"{"other":1}"#)
            .unwrap_err()
            .contains("isn't a Google credentials file"));
        let no_secret = r#"{"installed":{"client_id":"1.apps.googleusercontent.com"}}"#;
        assert!(check(no_secret).unwrap_err().contains("only once"));
        let bad_id = r#"{"installed":{"client_id":"hello","client_secret":"s"}}"#;
        assert!(check(bad_id).unwrap_err().contains("doesn't look like"));
        assert!(check(&" ".repeat(MAX_CLIENT_FILE + 1)).is_err());
    }

    #[test]
    fn save_writes_a_private_file_that_load_reads() {
        let dir = std::env::temp_dir().join(format!("client-save-{}", fastrand::u64(..)));
        assert!(save(&dir, r#"{"web":{}}"#).is_err());
        assert!(
            !client_file_path(&dir).exists(),
            "a refused file isn't saved"
        );
        save(&dir, DESKTOP).unwrap();
        let loaded = OAuthClientConfig::from_file(&client_file_path(&dir)).unwrap();
        assert_eq!(loaded.client_secret, "shh");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(client_file_path(&dir))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn find_download_picks_the_newest_client_file() {
        let dir = std::env::temp_dir().join(format!("client-find-{}", fastrand::u64(..)));
        std::fs::create_dir_all(&dir).unwrap();
        let hour = std::time::Duration::from_secs(3600);
        assert_eq!(find_download(&dir, hour), None);
        std::fs::write(dir.join("notes.json"), "{}").unwrap();
        std::fs::write(
            dir.join("client_secret_1.apps.googleusercontent.com.json"),
            "{}",
        )
        .unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        let newer = dir.join("client_secret_1.apps.googleusercontent.com (1).json");
        std::fs::write(&newer, "{}").unwrap();
        assert_eq!(find_download(&dir, hour), Some(newer));
        assert_eq!(find_download(&dir, std::time::Duration::ZERO), None);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn missing_file_explains_where_to_put_it() {
        let err =
            OAuthClientConfig::from_file(Path::new("/nope/google-oauth-client.json")).unwrap_err();
        assert!(err.to_string().contains("/nope/google-oauth-client.json"));
    }
}
