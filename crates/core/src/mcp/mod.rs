//! The app's mail for AI apps (Claude Desktop, Claude Code) over the Model
//! Context Protocol, with the official Rust SDK (`rmcp`).
//!
//! The AI app starts `<app> --mcp` (`proxy`), which speaks MCP on its
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
        Some(crate::brand::data_dir()?.join("mcp.sock"))
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
            r"\\.\pipe\{}-mcp-{user}",
            crate::brand::ID
        )))
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        None
    }
}

/// Serves AI apps' proxies on the named pipe `socket` until the app quits:
/// one `MailServer` per connection. Each instance of the pipe has an
/// access list for this user alone (`pipe`), so other accounts on the PC
/// can't connect, and remote clients are refused. If something else
/// already made the pipe (a second copy of the app), this one gives up.
#[cfg(windows)]
pub async fn listen(socket: &Path, db: Arc<Db>, host: Arc<dyn Host>) -> Result<()> {
    let io = |e: std::io::Error| CoreError::Other(format!("MCP pipe: {e}"));
    let mut next = pipe(socket, true).map_err(io)?;
    loop {
        next.connect().await.map_err(io)?;
        let stream = next;
        next = pipe(socket, false).map_err(io)?;
        let server = MailServer::new(db.clone(), host.clone());
        tokio::spawn(async move {
            if let Ok(running) = server.serve(stream).await {
                let _ = running.waiting().await;
            }
        });
    }
}

/// One instance of the AI apps' pipe, which only this user can connect to
/// or read the attributes of (DASA 1.7.1, 2.3.1): an explicit, protected
/// access list naming this user's SID, rather than Windows' default, which
/// also lets everyone read it and administrators and SYSTEM open it.
#[cfg(windows)]
fn pipe(
    socket: &Path,
    first: bool,
) -> std::io::Result<tokio::net::windows::named_pipe::NamedPipeServer> {
    let mut access = crate::owner_only::windows::UserOnly::new()?;
    // SAFETY: the attributes and the descriptor they point to live until
    // `access` drops, after the pipe has been made with them.
    unsafe {
        tokio::net::windows::named_pipe::ServerOptions::new()
            .first_pipe_instance(first)
            .reject_remote_clients(true)
            .create_with_security_attributes_raw(socket, access.attributes())
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

#[cfg(all(test, windows))]
mod pipe_tests {
    use std::os::windows::io::AsRawHandle;
    use std::path::Path;

    /// The AI apps' pipe has an access list for this user alone, which
    /// this user can still connect through; the app's later instances (for
    /// the next connection) get it too, and a second first instance (a
    /// second copy of the app) is refused.
    #[tokio::test]
    async fn only_this_user_can_open_the_pipe() {
        let name = format!(r"\\.\pipe\mail-core-test-{}", fastrand::u64(..));
        let server = super::pipe(Path::new(&name), true).unwrap();
        crate::owner_only::tests::assert_user_only(&crate::owner_only::tests::handle_dacl(
            server.as_raw_handle(),
        ));
        let _client = tokio::net::windows::named_pipe::ClientOptions::new()
            .open(&name)
            .unwrap();
        server.connect().await.unwrap();
        let later = super::pipe(Path::new(&name), false).unwrap();
        crate::owner_only::tests::assert_user_only(&crate::owner_only::tests::handle_dacl(
            later.as_raw_handle(),
        ));
        assert!(super::pipe(Path::new(&name), true).is_err());
    }
}
