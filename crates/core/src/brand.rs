//! The app's brand, from `brand.json` at the top of the repository (read by
//! `build.rs`). Anything a person or the system sees by name comes from
//! here; every other name in the code is neutral, so a new name is one file.

/// The app's name, as people see it: windows, menus, messages.
pub const NAME: &str = env!("BRAND_NAME");
/// Lowercase, for file names, the installed program and the MCP server.
pub const SHORT_NAME: &str = env!("BRAND_SHORT_NAME");
/// The bundle ID. It names the data and log folders and the keychain
/// entries, so changing it needs the one-time migration.
pub const ID: &str = env!("BRAND_ID");
/// Starts the environment variables people can set (`<PREFIX>_GOOGLE_…`).
pub const ENV_PREFIX: &str = env!("BRAND_ENV_PREFIX");

/// The app's version, from `package.json` (the one place it is written;
/// `tauri.conf.json` points at it too). Releases bump it with Changesets.
pub const VERSION: &str = env!("APP_VERSION");

/// The app's data folder, as Tauri names it (`app_data_dir`), for code
/// that runs without Tauri: the MCP proxy and the dev examples.
pub fn data_dir() -> Option<std::path::PathBuf> {
    #[cfg(target_os = "macos")]
    let base = std::env::var_os("HOME")
        .map(|home| std::path::PathBuf::from(home).join("Library/Application Support"));
    #[cfg(windows)]
    let base = std::env::var_os("APPDATA").map(std::path::PathBuf::from);
    #[cfg(not(any(target_os = "macos", windows)))]
    let base: Option<std::path::PathBuf> = None;
    base.map(|b| b.join(ID))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_version_is_the_one_in_package_json() {
        // Not the crate's own version (`0.0.0`): releases bump package.json.
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../package.json");
        let package: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        assert_eq!(package["version"], VERSION);
    }

    #[test]
    fn the_version_is_a_semantic_version() {
        let core = VERSION.split(['-', '+']).next().unwrap();
        let parts: Vec<_> = core.split('.').collect();
        assert_eq!(parts.len(), 3, "major.minor.patch, got {VERSION}");
        assert!(parts.iter().all(|p| p.parse::<u32>().is_ok()));
    }

    #[test]
    fn the_brand_is_well_formed() {
        assert!(!NAME.trim().is_empty());
        assert!(SHORT_NAME
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'));
        assert!(ENV_PREFIX
            .chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_'));
        let parts: Vec<_> = ID.split('.').collect();
        assert!(
            parts.len() >= 3,
            "a reverse-DNS bundle ID like com.example.app"
        );
        assert!(parts
            .iter()
            .all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')));
    }
}
