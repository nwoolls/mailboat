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

#[cfg(test)]
mod tests {
    use super::*;

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
