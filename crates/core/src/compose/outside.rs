//! Who is outside an account's organization, for the warning while
//! writing (docs/ROADMAP.md → 0.3.0 → "Warn about outside recipients").
//! It copies Gmail's own warning ("Warn for external recipients", a
//! Workspace administrator's setting): only Workspace accounts, and never
//! people in the account's Contacts or Other contacts. Gmail also knows the
//! organization's other domains and its directory; the app can't read
//! those with the permissions it has, so it counts the account's own domain
//! and its "Send mail as" aliases' domains as inside.
//!
//! This only gathers what the decision needs; the composer decides per
//! address (`src/features/compose/model/outside.ts`). Nothing leaves the
//! computer.

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::db::accounts;
use crate::error::Result;
use crate::model::AccountId;

/// Domains of personal Google accounts, which Gmail never warns for.
const PERSONAL_DOMAINS: &[&str] = &["gmail.com", "googlemail.com"];

/// What the composer needs to mark an account's outside recipients.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct OutsideRule {
    /// A Google Workspace account (not a personal Gmail one): only these
    /// are warned about, as in Gmail.
    pub workspace: bool,
    /// The domains that count as inside, in lower case: the account's own
    /// first, then its aliases'.
    pub domains: Vec<String>,
    /// Addresses in the account's Contacts and Other contacts, in lower
    /// case: never marked, wherever they are.
    pub known: Vec<String>,
}

/// An address as the composer compares it: trimmed, in lower case. Full
/// Unicode lower case, as JavaScript's `toLowerCase` makes it (SQLite's
/// `lower` changes only ASCII, so `É` stayed and never matched).
fn normalized(email: &str) -> String {
    email.trim().to_lowercase()
}

/// The part after the last `@`, in lower case, if there is one.
fn domain(email: &str) -> Option<String> {
    let email = normalized(email);
    let (_, domain) = email.rsplit_once('@')?;
    let domain = domain.trim().to_string();
    (!domain.is_empty()).then_some(domain)
}

/// The rule for one account.
pub fn rule(conn: &Connection, account: AccountId) -> Result<OutsideRule> {
    let own = accounts::get(conn, account)?.email;
    let mut domains: Vec<String> = domain(&own).into_iter().collect();
    let aliases: Vec<String> = {
        let mut stmt = conn.prepare(
            "SELECT email FROM send_as WHERE account_id = ?1 ORDER BY is_primary DESC, sort_order",
        )?;
        let rows = stmt.query_map([account], |r| r.get::<_, String>(0))?;
        rows.collect::<rusqlite::Result<_>>()?
    };
    for alias in &aliases {
        if let Some(d) = domain(alias) {
            if !domains.contains(&d) {
                domains.push(d);
            }
        }
    }
    let workspace = domains
        .first()
        .is_some_and(|d| !PERSONAL_DOMAINS.contains(&d.as_str()));
    let mut known: Vec<String> = {
        let mut stmt = conn.prepare("SELECT email FROM google_contacts WHERE account_id = ?1")?;
        let rows = stmt.query_map([account], |r| r.get::<_, String>(0))?;
        rows.map(|e| e.map(|e| normalized(&e)))
            .collect::<rusqlite::Result<_>>()?
    };
    known.sort();
    known.dedup();
    Ok(OutsideRule {
        workspace,
        domains,
        known,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    fn account(db: &Db, sub: &str, email: &str) -> AccountId {
        accounts::upsert(
            &db.conn(),
            &accounts::NewAccount {
                google_sub: sub,
                email,
                display_name: None,
                avatar_url: None,
                oauth_client: "default",
            },
        )
        .unwrap()
        .id
    }

    fn alias(db: &Db, account: AccountId, email: &str, primary: bool) {
        db.conn()
            .execute(
                "INSERT INTO send_as (account_id, email, is_primary) VALUES (?1, ?2, ?3)",
                rusqlite::params![account, email, primary],
            )
            .unwrap();
    }

    fn contact(db: &Db, account: AccountId, email: &str, kind: &str) {
        db.conn()
            .execute(
                "INSERT INTO google_contacts (account_id, email, kind) VALUES (?1, ?2, ?3)",
                rusqlite::params![account, email, kind],
            )
            .unwrap();
    }

    #[test]
    fn a_workspace_account_counts_its_own_and_its_aliases_domains() {
        let db = Db::open_in_memory().unwrap();
        let work = account(&db, "w", "Maya@Northwind.example");
        alias(&db, work, "maya@northwind.example", true);
        alias(&db, work, "events@Offsite.example", false);
        alias(&db, work, "maya.chen@northwind.example", false);
        let rule = rule(&db.conn(), work).unwrap();
        assert!(rule.workspace);
        assert_eq!(rule.domains, ["northwind.example", "offsite.example"]);
    }

    #[test]
    fn personal_gmail_accounts_are_never_warned_about() {
        let db = Db::open_in_memory().unwrap();
        // privacy-ok: made-up people; the test needs Google's real personal domains
        let personal = [("g", "maya@gmail.com"), ("m", "maya@GoogleMail.com")]; // privacy-ok: as above
        for (sub, email) in personal {
            let id = account(&db, sub, email);
            // An alias at a company doesn't make it a Workspace account.
            alias(&db, id, "maya@northwind.example", false);
            assert!(!rule(&db.conn(), id).unwrap().workspace, "{email}");
        }
    }

    #[test]
    fn contacts_and_other_contacts_are_known_per_account() {
        let db = Db::open_in_memory().unwrap();
        let work = account(&db, "w", "maya@northwind.example");
        let other = account(&db, "o", "maya@second.example");
        contact(&db, work, "Jordan@X.example", "saved");
        contact(&db, work, "jordan@x.example", "other");
        contact(&db, work, "sam@x.example", "other");
        contact(&db, other, "priya@y.example", "saved");
        // Review: lower case beyond ASCII, as the composer makes it.
        contact(&db, work, "Éva@X.example", "saved");
        let known = rule(&db.conn(), work).unwrap().known;
        assert_eq!(
            known,
            ["jordan@x.example", "sam@x.example", "éva@x.example"]
        );
        assert_eq!(rule(&db.conn(), other).unwrap().known, ["priya@y.example"]);
    }

    #[test]
    fn an_account_with_no_aliases_fetched_still_has_its_own_domain() {
        let db = Db::open_in_memory().unwrap();
        let work = account(&db, "w", "maya@northwind.example");
        let rule = rule(&db.conn(), work).unwrap();
        assert_eq!(rule.domains, ["northwind.example"]);
        assert!(rule.known.is_empty());
    }
}
