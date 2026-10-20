//! How much each provider has been asked: requests, tokens and (Claude's
//! estimate of) cost. Sizes only, never what was sent.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use specta::Type;

use super::{AiProvider, Usage};
use crate::db::now_millis;
use crate::error::Result;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum Purpose {
    ListSummary,
    Summary,
    Writing,
    /// The suggestion chips in the writing assistant.
    ReplyIdeas,
}

impl Purpose {
    fn as_str(self) -> &'static str {
        match self {
            Purpose::ListSummary => "listSummary",
            Purpose::Summary => "summary",
            Purpose::Writing => "writing",
            Purpose::ReplyIdeas => "replyIdeas",
        }
    }
}

pub fn record(
    conn: &Connection,
    provider: AiProvider,
    purpose: Purpose,
    ok: bool,
    usage: &Usage,
) -> Result<()> {
    conn.execute(
        "INSERT INTO ai_usage (at, provider, purpose, ok, input_tokens, output_tokens, cost_usd)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            now_millis(),
            provider.as_str(),
            purpose.as_str(),
            ok,
            usage.input_tokens as i64,
            usage.output_tokens as i64,
            usage.cost_usd
        ],
    )?;
    Ok(())
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct UsageTotals {
    pub requests: u32,
    pub failed: u32,
    pub input_tokens: u64,
    pub output_tokens: u64,
    /// Sum of reported costs; `None` if the provider reports none.
    pub cost_usd: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ProviderUsage {
    pub provider: AiProvider,
    pub today: UsageTotals,
    pub last_30_days: UsageTotals,
}

const DAY_MS: i64 = 24 * 60 * 60 * 1000;

/// Totals per provider since `since` (Unix ms).
fn totals(conn: &Connection, provider: AiProvider, since: i64) -> Result<UsageTotals> {
    Ok(conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(NOT ok), 0), COALESCE(SUM(input_tokens), 0),
                COALESCE(SUM(output_tokens), 0), SUM(cost_usd)
         FROM ai_usage WHERE provider = ?1 AND at >= ?2",
        params![provider.as_str(), since],
        |r| {
            Ok(UsageTotals {
                requests: r.get(0)?,
                failed: r.get(1)?,
                input_tokens: r.get::<_, i64>(2)? as u64,
                output_tokens: r.get::<_, i64>(3)? as u64,
                cost_usd: r.get(4)?,
            })
        },
    )?)
}

/// Usage per provider: since local midnight (`today_start`, Unix ms, from
/// the caller, who knows the time zone) and over the last 30 days.
/// Old rows (over 90 days) are dropped.
pub fn report(conn: &Connection, today_start: i64) -> Result<Vec<ProviderUsage>> {
    let now = now_millis();
    conn.execute("DELETE FROM ai_usage WHERE at < ?1", [now - 90 * DAY_MS])?;
    AiProvider::ALL
        .into_iter()
        .map(|provider| {
            Ok(ProviderUsage {
                provider,
                today: totals(conn, provider, today_start)?,
                last_30_days: totals(conn, provider, now - 30 * DAY_MS)?,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    #[test]
    fn totals_add_up_per_provider() {
        let db = Db::open_in_memory().unwrap();
        let conn = db.conn();
        let u = Usage {
            input_tokens: 100,
            output_tokens: 20,
            cost_usd: Some(0.01),
        };
        record(&conn, AiProvider::Claude, Purpose::Writing, true, &u).unwrap();
        record(&conn, AiProvider::Claude, Purpose::Summary, false, &u).unwrap();
        record(
            &conn,
            AiProvider::Apple,
            Purpose::ListSummary,
            true,
            &Usage::default(),
        )
        .unwrap();
        let r = report(&conn, 0).unwrap();
        let claude = r.iter().find(|p| p.provider == AiProvider::Claude).unwrap();
        assert_eq!(claude.today.requests, 2);
        assert_eq!(claude.today.failed, 1);
        assert_eq!(claude.last_30_days.input_tokens, 200);
        assert!((claude.today.cost_usd.unwrap() - 0.02).abs() < 1e-9);
        let apple = r.iter().find(|p| p.provider == AiProvider::Apple).unwrap();
        assert_eq!(apple.today.requests, 1);
        assert_eq!(apple.today.cost_usd, None);
        let chatgpt = r
            .iter()
            .find(|p| p.provider == AiProvider::ChatGpt)
            .unwrap();
        assert_eq!(chatgpt.today, UsageTotals::default());
    }
}
