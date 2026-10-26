//! Loads the Google OAuth client. Credentials are never compiled in or
//! committed: they come from env vars or from the JSON file Google Cloud
//! Console downloads, saved in the app's config directory.

use std::path::{Path, PathBuf};

use serde::Deserialize;

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
    auth_uri: Option<String>,
    token_uri: Option<String>,
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
        let mut config = Self::google(client.client_id, client.client_secret);
        if let Some(uri) = client.auth_uri {
            // Google's file lists the v1 endpoint; v2 is the current one.
            if !uri.contains("accounts.google.com") {
                config.auth_uri = uri;
            }
        }
        if let Some(uri) = client.token_uri {
            config.token_uri = uri;
        }
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
        assert_eq!(c.auth_uri, GOOGLE_AUTH_URI);
        assert!(
            !format!("{c:?}").contains("shh"),
            "Debug must not leak the secret"
        );
    }

    #[test]
    fn missing_file_explains_where_to_put_it() {
        let err =
            OAuthClientConfig::from_file(Path::new("/nope/google-oauth-client.json")).unwrap_err();
        assert!(err.to_string().contains("/nope/google-oauth-client.json"));
    }
}
