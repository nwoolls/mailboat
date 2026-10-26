//! `<app> --mcp`: what an AI app starts. It speaks MCP on stdin/stdout
//! and passes each request on to the running app over its socket,
//! connecting when needed, so the app can be opened or quit at any time.
//! With the app closed, the tools are still listed and each says to open
//! the app. It holds no mail, settings or tokens itself.

use std::path::PathBuf;
use std::sync::Arc;

use rmcp::model::{
    CallToolRequestParams, CallToolResponse, CallToolResult, ClientCapabilities, ClientConfig,
    ContentBlock, Implementation, ListToolsResult, PaginatedRequestParams, ServerConfig,
};
use rmcp::service::{RequestContext, RunningService};
use rmcp::{ErrorData, RoleClient, RoleServer, ServerHandler, ServiceExt};
use tokio::sync::Mutex;

use super::MailServer;
use crate::error::{CoreError, Result};

pub const NOT_RUNNING: &str = concat!(
    env!("BRAND_NAME"),
    " isn't open. Ask the user to open ",
    env!("BRAND_NAME"),
    ", then try again."
);

type Upstream = RunningService<RoleClient, ClientConfig>;

#[derive(Clone)]
pub struct Proxy {
    socket: PathBuf,
    upstream: Arc<Mutex<Option<Upstream>>>,
}

impl Proxy {
    pub fn new(socket: PathBuf) -> Self {
        Self {
            socket,
            upstream: Arc::new(Mutex::new(None)),
        }
    }

    /// The connection to the app, made now if there isn't one. Named after
    /// the AI app on our side, so the app's log says who asked.
    async fn connect(
        &self,
        context: &RequestContext<RoleServer>,
    ) -> Option<tokio::sync::MutexGuard<'_, Option<Upstream>>> {
        let mut upstream = self.upstream.lock().await;
        if upstream.as_ref().is_some_and(|u| u.is_closed()) {
            *upstream = None;
        }
        if upstream.is_none() {
            let name = context
                .peer
                .peer_info()
                .map(|i| i.client_info.name.clone())
                .unwrap_or_else(|| "unknown".into());
            *upstream = connect(&self.socket, &name).await.ok();
        }
        upstream.is_some().then_some(upstream)
    }
}

#[cfg(unix)]
async fn connect(socket: &PathBuf, client: &str) -> Result<Upstream> {
    let stream = tokio::net::UnixStream::connect(socket)
        .await
        .map_err(|e| CoreError::Other(format!("connect to {}: {e}", crate::brand::NAME)))?;
    ClientConfig::new(
        ClientCapabilities::default(),
        Implementation::new(client, env!("CARGO_PKG_VERSION")),
    )
    .serve(stream)
    .await
    .map_err(|e| CoreError::Other(format!("connect to {}: {e}", crate::brand::NAME)))
}

#[cfg(windows)]
async fn connect(socket: &PathBuf, client: &str) -> Result<Upstream> {
    use tokio::net::windows::named_pipe::ClientOptions;
    let err = |e: &dyn std::fmt::Display| {
        CoreError::Other(format!("connect to {}: {e}", crate::brand::NAME))
    };
    // Busy means the app is between handing one connection over and
    // opening the pipe for the next: a moment later it's free.
    let mut tries = 0;
    let stream = loop {
        match ClientOptions::new().open(socket) {
            Ok(stream) => break stream,
            Err(e) if e.raw_os_error() == Some(231) && tries < 20 => {
                tries += 1;
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            }
            Err(e) => return Err(err(&e)),
        }
    };
    ClientConfig::new(
        ClientCapabilities::default(),
        Implementation::new(client, env!("CARGO_PKG_VERSION")),
    )
    .serve(stream)
    .await
    .map_err(|e| err(&e))
}

#[cfg(not(any(unix, windows)))]
async fn connect(_socket: &PathBuf, _client: &str) -> Result<Upstream> {
    Err(CoreError::Other("not on this system yet".into()))
}

fn not_running() -> CallToolResponse {
    CallToolResult::error(vec![ContentBlock::text(NOT_RUNNING)]).into()
}

impl ServerHandler for Proxy {
    fn get_info(&self) -> ServerConfig {
        MailServer::info()
    }

    async fn list_tools(
        &self,
        request: Option<PaginatedRequestParams>,
        context: RequestContext<RoleServer>,
    ) -> std::result::Result<ListToolsResult, ErrorData> {
        if let Some(mut upstream) = self.connect(&context).await {
            if let Some(u) = upstream.as_ref() {
                match u.list_tools(request).await {
                    Ok(list) => return Ok(list),
                    Err(_) => *upstream = None,
                }
            }
        }
        Ok(ListToolsResult {
            tools: MailServer::tools(),
            ..Default::default()
        })
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        context: RequestContext<RoleServer>,
    ) -> std::result::Result<CallToolResponse, ErrorData> {
        // Twice: a connection to an app that has since restarted fails
        // once, then a fresh one is made.
        for _ in 0..2 {
            let Some(mut upstream) = self.connect(&context).await else {
                return Ok(not_running());
            };
            let Some(u) = upstream.as_ref() else {
                return Ok(not_running());
            };
            match u.call_tool_once(request.clone()).await {
                Ok(response) => return Ok(response),
                Err(_) => *upstream = None,
            }
        }
        Ok(not_running())
    }
}

/// Runs the proxy on stdin/stdout until the AI app closes it.
pub async fn run(socket: PathBuf) -> Result<()> {
    let service = Proxy::new(socket)
        .serve(rmcp::transport::stdio())
        .await
        .map_err(|e| CoreError::Other(format!("MCP: {e}")))?;
    service
        .waiting()
        .await
        .map_err(|e| CoreError::Other(format!("MCP: {e}")))?;
    Ok(())
}
