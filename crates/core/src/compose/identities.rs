//! The addresses mail can be sent from: each account's own address plus
//! the aliases set up in Gmail under "Send mail as" (`settings.sendAs`).

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::db::{accounts, Db};
use crate::error::Result;
use crate::gmail::types::SendAs;
use crate::gmail::GmailClient;
use crate::model::AccountId;

/// One address compose can use as From.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    pub account_id: AccountId,
    pub email: String,
    pub name: Option<String>,
    /// The account's own address (not an alias).
    pub is_primary: bool,
    /// Gmail's default From for new mail in this account.
    pub is_default: bool,
    /// HTML signature from Gmail's settings, if any.
    pub signature: Option<String>,
}

/// Every account's identities, accounts in sidebar order, each account's
/// default first. An account whose aliases were never fetched still offers
/// its own address.
pub fn list(conn: &Connection) -> Result<Vec<Identity>> {
    let mut stmt = conn.prepare(
        "SELECT account_id, email, display_name, is_primary, is_default, signature
         FROM send_as ORDER BY account_id, is_default DESC, is_primary DESC, sort_order",
    )?;
    let stored: Vec<Identity> = stmt
        .query_map([], |r| {
            Ok(Identity {
                account_id: r.get(0)?,
                email: r.get(1)?,
                name: r.get(2)?,
                is_primary: r.get(3)?,
                is_default: r.get(4)?,
                signature: r.get(5)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    let mut out = Vec::new();
    for account in accounts::list(conn)? {
        // Gmail leaves the main address's name blank when it's the Google
        // account's own name.
        let mine: Vec<Identity> = stored
            .iter()
            .filter(|i| i.account_id == account.id)
            .map(|i| Identity {
                name: i
                    .name
                    .clone()
                    .or_else(|| i.is_primary.then(|| account.display_name.clone()).flatten()),
                ..i.clone()
            })
            .collect();
        if mine.is_empty() {
            out.push(Identity {
                account_id: account.id,
                email: account.email,
                name: account.display_name,
                is_primary: true,
                is_default: true,
                signature: None,
            });
        } else {
            out.extend(mine);
        }
    }
    Ok(out)
}

/// Replaces an account's identities with what Gmail reported. Aliases
/// still waiting for verification can't send yet, so they're left out.
pub fn store(conn: &mut Connection, account: AccountId, send_as: &[SendAs]) -> Result<()> {
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM send_as WHERE account_id = ?1", [account])?;
    for (order, s) in send_as.iter().enumerate() {
        let verified = s.is_primary
            || s.verification_status
                .as_deref()
                .is_none_or(|v| v == "accepted");
        if !verified {
            continue;
        }
        tx.execute(
            "INSERT OR REPLACE INTO send_as
               (account_id, email, display_name, reply_to, signature, is_primary, is_default, sort_order)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                account,
                s.send_as_email,
                s.display_name.as_deref().filter(|n| !n.trim().is_empty()),
                s.reply_to_address.as_deref().filter(|r| !r.is_empty()),
                s.signature.as_deref().filter(|sig| !sig.trim().is_empty()),
                s.is_primary,
                s.is_default,
                order as i64,
            ],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// Fetches an account's identities from Gmail and stores them.
pub async fn refresh(db: &Db, gmail: &GmailClient, account: AccountId) -> Result<()> {
    let list = gmail.send_as().await?;
    store(&mut db.conn(), account, &list.send_as)
}

/// Whether `email` is one of the account's identities.
pub fn owns(conn: &Connection, account: AccountId, email: &str) -> Result<bool> {
    Ok(list(conn)?
        .iter()
        .any(|i| i.account_id == account && i.email.eq_ignore_ascii_case(email)))
}
