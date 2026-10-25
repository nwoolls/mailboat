//! Mailboat's mail for AI apps (Claude Desktop, Claude Code) over the Model
//! Context Protocol, with the official Rust SDK (`rmcp`).
//!
//! The AI app starts `mailboat --mcp` (`proxy`), which speaks MCP on its
//! stdin/stdout and passes each request to the running app over a local
//! socket only the user can open (`socket_path`). The app answers with
//! `MailServer`: shared accounts only (Settings → AI), never Spam or
//! Trash, drafts only where allowed, nothing ever sent. Every request is
//! logged without content (`log`).

pub mod log;
pub mod proxy;
mod server;
pub mod setup;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use rmcp::ServiceExt;

pub use server::{Host, MailServer, INSTRUCTIONS};

use crate::db::Db;
use crate::error::{CoreError, Result};

/// Where the app listens: in its data folder, which only the user can
/// open. The proxy and the app agree on it without asking anyone.
pub fn socket_path() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var_os("HOME")?;
        Some(
            PathBuf::from(home)
                .join("Library/Application Support/com.nwoolls.mailboat")
                .join("mcp.sock"),
        )
    }
    #[cfg(windows)]
    {
        // Windows has no socket files: a named pipe, one per user. Pipe
        // names can't hold a backslash, so anything odd becomes `_`.
        let user: String = std::env::var("USERNAME")
            .unwrap_or_default()
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
            .collect();
        Some(PathBuf::from(format!(
            r"\\.\pipe\com.nwoolls.mailboat-mcp-{user}"
        )))
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        None
    }
}

/// Serves AI apps' proxies on the named pipe `socket` until the app quits:
/// one `MailServer` per connection. Only this user (and administrators)
/// can write to a pipe they created, so other accounts on the PC can't
/// send it requests; remote clients are refused. If something else
/// already made the pipe (a second copy of Mailboat), this one gives up.
#[cfg(windows)]
pub async fn listen(socket: &Path, db: Arc<Db>, host: Arc<dyn Host>) -> Result<()> {
    use tokio::net::windows::named_pipe::ServerOptions;
    let io = |e: std::io::Error| CoreError::Other(format!("MCP pipe: {e}"));
    let mut next = ServerOptions::new()
        .first_pipe_instance(true)
        .reject_remote_clients(true)
        .create(socket)
        .map_err(io)?;
    loop {
        next.connect().await.map_err(io)?;
        let stream = next;
        next = ServerOptions::new()
            .reject_remote_clients(true)
            .create(socket)
            .map_err(io)?;
        let server = MailServer::new(db.clone(), host.clone());
        tokio::spawn(async move {
            if let Ok(running) = server.serve(stream).await {
                let _ = running.waiting().await;
            }
        });
    }
}

/// Serves AI apps' proxies on `socket` until the app quits: one
/// `MailServer` per connection. A socket left by an earlier run is
/// replaced; the new one is readable and writable by the user only.
#[cfg(unix)]
pub async fn listen(socket: &Path, db: Arc<Db>, host: Arc<dyn Host>) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let io = |e: std::io::Error| CoreError::Other(format!("MCP socket: {e}"));
    if let Some(dir) = socket.parent() {
        std::fs::create_dir_all(dir).map_err(io)?;
    }
    let _ = std::fs::remove_file(socket);
    let listener = tokio::net::UnixListener::bind(socket).map_err(io)?;
    std::fs::set_permissions(socket, std::fs::Permissions::from_mode(0o600)).map_err(io)?;
    loop {
        let (stream, _) = listener.accept().await.map_err(io)?;
        let server = MailServer::new(db.clone(), host.clone());
        tokio::spawn(async move {
            if let Ok(running) = server.serve(stream).await {
                let _ = running.waiting().await;
            }
        });
    }
}
