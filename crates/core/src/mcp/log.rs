//! What AI apps asked of the MCP server, so the owner can see what an AI
//! looked at (Settings → AI). Which tool, which account and conversation,
//! and a line about it: the AI's own search words and how many results,
//! never email content. Kept 30 days.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::db::now_millis;
use crate::error::Result;
use crate::model::{AccountId, ThreadId};

/// How long requests are kept.
pub const KEEP_MS: i64 = 30 * 24 * 60 * 60 * 1000;

/// One request, as Settings lists it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct McpLogEntry {
    pub id: i64,
    /// Unix milliseconds.
    pub at: i64,
    /// The AI app, as it names itself ("claude-ai", "claude-code").
    pub client: String,
    pub tool: String,
    pub account_id: Option<AccountId>,
    pub thread_id: Option<ThreadId>,
    /// The conversation's subject, looked up now from the cache for
    /// showing (it isn't stored in the log).
    pub subject: Option<String>,
    pub detail: String,
    pub ok: bool,
}

/// What one request was about.
#[derive(Debug, Clone, Default)]
pub struct Request<'a> {
    pub client: &'a str,
    pub tool: &'a str,
    pub account: Option<AccountId>,
    pub thread: Option<ThreadId>,
    pub detail: String,
}

/// Notes a request, and forgets ones older than 30 days.
pub fn record(conn: &Connection, request: &Request<'_>, ok: bool) -> Result<()> {
    let now = now_millis();
    conn.execute(
        "INSERT INTO mcp_log (at, client, tool, account_id, thread_id, detail, ok)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            now,
            request.client,
            request.tool,
            request.account,
            request.thread,
            request.detail,
            ok
        ],
    )?;
    conn.execute("DELETE FROM mcp_log WHERE at < ?1", [now - KEEP_MS])?;
    Ok(())
}

/// The newest requests first.
pub fn recent(conn: &Connection, limit: u32) -> Result<Vec<McpLogEntry>> {
    let mut stmt = conn.prepare(
        "SELECT g.id, g.at, g.client, g.tool, g.account_id, g.thread_id, t.subject, g.detail, g.ok
         FROM mcp_log g LEFT JOIN threads t ON t.id = g.thread_id
         ORDER BY g.at DESC, g.id DESC LIMIT ?1",
    )?;
    let rows = stmt
        .query_map([limit], |r| {
            Ok(McpLogEntry {
                id: r.get(0)?,
                at: r.get(1)?,
                client: r.get(2)?,
                tool: r.get(3)?,
                account_id: r.get(4)?,
                thread_id: r.get(5)?,
                subject: r.get(6)?,
                detail: r.get(7)?,
                ok: r.get(8)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    #[test]
    fn keeps_thirty_days_newest_first() {
        let db = Db::open_in_memory().unwrap();
        let conn = db.conn();
        conn.execute(
            "INSERT INTO mcp_log (at, client, tool, detail, ok) VALUES (?1, 'x', 'old', '', 1)",
            [now_millis() - KEEP_MS - 1],
        )
        .unwrap();
        let ask = |tool, detail: &str| Request {
            client: "claude-ai",
            tool,
            detail: detail.into(),
            ..Default::default()
        };
        record(&conn, &ask("search_mail", "\"invoice\": 3 results"), true).unwrap();
        record(&conn, &ask("list_labels", ""), false).unwrap();
        let log = recent(&conn, 10).unwrap();
        let tools: Vec<_> = log.iter().map(|e| e.tool.as_str()).collect();
        assert_eq!(tools, ["list_labels", "search_mail"]);
        assert!(!log[0].ok);
        assert_eq!(log[1].detail, "\"invoice\": 3 results");
    }
}
