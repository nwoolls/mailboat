//! Connecting AI apps to Mailboat (Settings → AI → AI apps): Claude Code
//! through its own `claude mcp add`, Claude Desktop by adding Mailboat to its
//! config file. Both start `<this program> --mcp`.

use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use crate::error::{CoreError, Result};

/// The name AI apps list Mailboat's tools under.
pub const SERVER_NAME: &str = "mailboat";

/// `claude mcp add` for every project (user scope), starting `program --mcp`.
pub fn claude_code_args(program: &str) -> Vec<String> {
    [
        "mcp",
        "add",
        "--scope",
        "user",
        SERVER_NAME,
        "--",
        program,
        "--mcp",
    ]
    .into_iter()
    .map(String::from)
    .collect()
}

/// Claude Desktop's config file.
pub fn claude_desktop_config() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(PathBuf::from(home).join("Library/Application Support/Claude/claude_desktop_config.json"))
}

/// The config with Mailboat added (or brought up to date), everything else
/// in it kept. A file that isn't a JSON object is refused rather than
/// overwritten.
pub fn with_mailboat(config: Option<&str>, program: &str) -> Result<String> {
    let mut root: Value = match config.map(str::trim).filter(|c| !c.is_empty()) {
        Some(text) => serde_json::from_str(text).map_err(|_| {
            CoreError::Invalid(
                "Claude Desktop's settings file couldn't be read, so it was left alone.".into(),
            )
        })?,
        None => json!({}),
    };
    let Some(object) = root.as_object_mut() else {
        return Err(CoreError::Invalid(
            "Claude Desktop's settings file isn't what Mailboat expected, so it was left alone."
                .into(),
        ));
    };
    let servers = object.entry("mcpServers").or_insert_with(|| json!({}));
    let Some(servers) = servers.as_object_mut() else {
        return Err(CoreError::Invalid(
            "Claude Desktop's MCP servers setting isn't what Mailboat expected, so it was left alone."
                .into(),
        ));
    };
    servers.insert(
        SERVER_NAME.into(),
        json!({ "command": program, "args": ["--mcp"] }),
    );
    Ok(serde_json::to_string_pretty(&root)? + "\n")
}

/// Whether the config already starts this program for Mailboat.
pub fn has_mailboat(config: Option<&str>, program: &str) -> bool {
    config
        .and_then(|c| serde_json::from_str::<Value>(c).ok())
        .is_some_and(|v| {
            v["mcpServers"][SERVER_NAME]["command"] == program
                && v["mcpServers"][SERVER_NAME]["args"] == json!(["--mcp"])
        })
}

/// Adds Mailboat to Claude Desktop's config file, keeping a copy of the old
/// one beside it.
pub fn add_to_claude_desktop(config: &Path, program: &str) -> Result<()> {
    let io = |e: std::io::Error| CoreError::Other(format!("Claude Desktop's settings: {e}"));
    let old = match std::fs::read_to_string(config) {
        Ok(text) => Some(text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(io(e)),
    };
    let new = with_mailboat(old.as_deref(), program)?;
    if let Some(dir) = config.parent() {
        std::fs::create_dir_all(dir).map_err(io)?;
    }
    if let Some(old) = &old {
        std::fs::write(config.with_extension("json.before-mailboat"), old).map_err(io)?;
    }
    std::fs::write(config, new).map_err(io)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PROGRAM: &str = "/Applications/Mailboat.app/Contents/MacOS/mailboat";

    #[test]
    fn adds_mailboat_and_keeps_everything_else() {
        let before = r#"{"mcpServers":{"other":{"command":"x"}},"globalShortcut":"Alt+Space"}"#;
        let after: Value =
            serde_json::from_str(&with_mailboat(Some(before), PROGRAM).unwrap()).unwrap();
        assert_eq!(after["mcpServers"]["other"]["command"], "x");
        assert_eq!(after["globalShortcut"], "Alt+Space");
        assert_eq!(after["mcpServers"]["mailboat"]["command"], PROGRAM);
        assert!(has_mailboat(Some(&after.to_string()), PROGRAM));
        assert!(!has_mailboat(Some(before), PROGRAM));
    }

    #[test]
    fn starts_a_new_file_and_refuses_a_broken_one() {
        assert!(has_mailboat(
            Some(&with_mailboat(None, PROGRAM).unwrap()),
            PROGRAM
        ));
        assert!(with_mailboat(Some("{ not json"), PROGRAM).is_err());
        assert!(with_mailboat(Some("[1, 2]"), PROGRAM).is_err());
        assert!(with_mailboat(Some(r#"{"mcpServers": 3}"#), PROGRAM).is_err());
    }

    #[test]
    fn claude_code_gets_the_program_after_a_double_dash() {
        let args = claude_code_args(PROGRAM);
        assert_eq!(args[..5], ["mcp", "add", "--scope", "user", "mailboat"]);
        assert_eq!(args[5..], ["--", PROGRAM, "--mcp"]);
    }

    #[test]
    fn writes_the_file_with_a_copy_of_the_old_one() {
        let dir = std::env::temp_dir().join(format!("mailboat-setup-{}", std::process::id()));
        let file = dir.join("claude_desktop_config.json");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(&file, r#"{"theme":"dark"}"#).unwrap();
        add_to_claude_desktop(&file, PROGRAM).unwrap();
        assert!(has_mailboat(
            std::fs::read_to_string(&file).ok().as_deref(),
            PROGRAM
        ));
        assert_eq!(
            std::fs::read_to_string(dir.join("claude_desktop_config.json.before-mailboat")).unwrap(),
            r#"{"theme":"dark"}"#
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
