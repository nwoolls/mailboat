//! The app's side of the MCP server for AI apps (`mail_core::mcp`):
//! listening while Mailboat runs, the `--mcp` proxy mode, and Settings →
//! AI → AI apps (connecting Claude, the request log).

use std::path::PathBuf;
use std::sync::Arc;

use mail_core::ai::process;
use mail_core::db::Db;
use mail_core::gmail::GmailClient;
use mail_core::mcp::{self, log::McpLogEntry, setup, Host};
use mail_core::model::AccountId;
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Manager, State};
use tauri_specta::Event;

use crate::error::{AppError, CmdResult};
use crate::events::MailChangedEvent;
use crate::state::AppState;

struct AppHost {
    app: AppHandle,
}

impl Host for AppHost {
    fn gmail(&self, account: AccountId) -> mail_core::error::Result<GmailClient> {
        self.app.state::<AppState>().gmail_for(account)
    }

    fn mail_changed(&self, account: AccountId) {
        let _ = MailChangedEvent {
            account_id: account,
        }
        .emit(&self.app);
    }
}

/// Serves AI apps for as long as Mailboat runs. Only answers for accounts
/// turned on in Settings; with none, every request says so.
pub fn start(app: AppHandle, db: Arc<Db>) {
    let Some(socket) = mcp::socket_path() else {
        return;
    };
    tauri::async_runtime::spawn(async move {
        let host = Arc::new(AppHost { app: app.clone() });
        if let Err(e) = mcp::listen(&socket, db, host).await {
            app.state::<AppState>()
                .sync_log
                .write(AccountId(0), &format!("MCP server stopped: {e}"));
        }
    });
}

/// `mailboat --mcp`, started by an AI app: passes its requests to the
/// running Mailboat. Nothing but MCP may go to stdout.
pub fn run_proxy() -> i32 {
    let Some(socket) = mcp::socket_path() else {
        eprintln!("Mailboat's MCP server isn't available on this system yet.");
        return 1;
    };
    let runtime = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(r) => r,
        Err(e) => {
            eprintln!("mailboat --mcp: {e}");
            return 1;
        }
    };
    match runtime.block_on(mcp::proxy::run(socket)) {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("mailboat --mcp: {e}");
            1
        }
    }
}

fn fail(message: impl Into<String>) -> AppError {
    mail_core::CoreError::Other(message.into()).into()
}

fn program() -> CmdResult<String> {
    let exe = std::env::current_exe().map_err(|e| fail(e.to_string()))?;
    Ok(exe.to_string_lossy().into_owned())
}

/// How AI apps connect, for Settings.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct McpSetup {
    /// What AI apps start (this app, with `--mcp`).
    pub program: String,
    /// The same as a command for Terminal (Claude Code).
    pub claude_code_command: String,
    /// Claude Code is installed (its `claude` command was found).
    pub claude_code_installed: bool,
    /// Claude Code already starts Mailboat.
    pub claude_code_connected: bool,
    /// Claude Desktop's config already starts Mailboat.
    pub claude_desktop_connected: bool,
}

/// Claude Code: installed on its own, or the copy inside the Claude app
/// (as for Claude as an AI provider, `ai::apps`).
fn claude() -> Option<PathBuf> {
    process::find_program("claude").or_else(mail_core::ai::apps::claude)
}

#[tauri::command]
#[specta::specta]
pub async fn mcp_setup() -> CmdResult<McpSetup> {
    let program = program()?;
    let claude = claude();
    let claude_code_connected = match &claude {
        Some(c) => process::run_quick(c, &["mcp", "get", setup::SERVER_NAME])
            .await
            .map(|(ok, out, _)| ok && out.contains(&program))
            .unwrap_or(false),
        None => false,
    };
    let desktop = setup::claude_desktop_config().and_then(|p| std::fs::read_to_string(p).ok());
    Ok(McpSetup {
        claude_code_command: format!("claude {}", setup::claude_code_args(&program).join(" ")),
        claude_code_installed: claude.is_some(),
        claude_code_connected,
        claude_desktop_connected: setup::has_mailboat(desktop.as_deref(), &program),
        program,
    })
}

/// Adds Mailboat to Claude Code for every project (`claude mcp add`).
#[tauri::command]
#[specta::specta]
pub async fn mcp_connect_claude_code() -> CmdResult<()> {
    let program = program()?;
    let claude = claude().ok_or_else(|| fail("Claude Code isn't installed."))?;
    // An older entry (another build of Mailboat) is replaced.
    let _ = process::run_quick(
        &claude,
        &["mcp", "remove", "--scope", "user", setup::SERVER_NAME],
    )
    .await;
    let args = setup::claude_code_args(&program);
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    let (ok, out, err) = process::run_quick(&claude, &args).await?;
    if !ok {
        return Err(fail(format!(
            "Claude Code said: {}",
            if err.trim().is_empty() {
                out.trim()
            } else {
                err.trim()
            }
        )));
    }
    Ok(())
}

/// Adds Mailboat to Claude Desktop's config (it needs restarting to see it).
#[tauri::command]
#[specta::specta]
pub fn mcp_connect_claude_desktop() -> CmdResult<()> {
    let config = setup::claude_desktop_config()
        .ok_or_else(|| fail("Claude Desktop's settings weren't found."))?;
    setup::add_to_claude_desktop(&config, &program()?)?;
    Ok(())
}

/// What AI apps asked for, newest first.
#[tauri::command]
#[specta::specta]
pub fn mcp_log(state: State<'_, AppState>, limit: u32) -> CmdResult<Vec<McpLogEntry>> {
    Ok(mcp::log::recent(&state.db.conn(), limit.min(500))?)
}
