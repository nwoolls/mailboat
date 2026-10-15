//! User actions on mail (Milestone 3 grows this; read/unread is first).
//!
//! Every action follows the same pattern:
//! 1. Resolve each thread's owning account. A selection spanning accounts
//!    is split, and each part uses only its own account's Gmail client.
//! 2. Apply the change to the local cache first, so the UI updates at once.
//! 3. Tell Gmail. If Gmail refuses, put that thread back as it was.

use std::collections::BTreeMap;

use crate::db::{store, Db};
use crate::error::{CoreError, Result};
use crate::gmail::GmailClient;
use crate::model::{AccountId, ThreadId};

const UNREAD: &str = "UNREAD";

/// Groups local threads by owning account, with their Gmail IDs.
fn by_account(
    db: &Db,
    threads: &[ThreadId],
) -> Result<BTreeMap<AccountId, Vec<(ThreadId, String)>>> {
    let conn = db.conn();
    let mut groups: BTreeMap<AccountId, Vec<(ThreadId, String)>> = BTreeMap::new();
    for &thread in threads {
        let (account, gmail_id) = store::thread_gmail_ref(&conn, thread)?;
        groups.entry(account).or_default().push((thread, gmail_id));
    }
    Ok(groups)
}

/// Marks threads read or unread. Returns the accounts touched. If Gmail
/// refuses some threads, those are restored locally and the first error is
/// returned; the others keep their new state.
pub async fn set_read(
    db: &Db,
    gmail_for: impl Fn(AccountId) -> Result<GmailClient>,
    threads: &[ThreadId],
    read: bool,
) -> Result<Vec<AccountId>> {
    let groups = by_account(db, threads)?;

    // Optimistic local change, remembering how to undo it.
    let mut snapshots = BTreeMap::new();
    for (thread, _) in groups.values().flatten() {
        let snapshot = store::label_snapshot(&db.conn(), *thread, UNREAD)?;
        store::set_thread_label(&mut db.conn(), *thread, UNREAD, !read)?;
        snapshots.insert(*thread, snapshot);
    }

    let (add, remove): (&[&str], &[&str]) = if read {
        (&[], &[UNREAD])
    } else {
        (&[UNREAD], &[])
    };
    let mut first_error: Option<CoreError> = None;
    for (&account, threads) in &groups {
        // The user is waiting on this, so it skips ahead of background sync.
        let gmail = match gmail_for(account) {
            Ok(g) => g.interactive(),
            Err(e) => {
                for (thread, _) in threads {
                    store::restore_label_snapshot(&mut db.conn(), &snapshots[thread])?;
                }
                first_error.get_or_insert(e);
                continue;
            }
        };
        for (thread, gmail_id) in threads {
            if let Err(e) = gmail.modify_thread(gmail_id, add, remove).await {
                store::restore_label_snapshot(&mut db.conn(), &snapshots[thread])?;
                first_error.get_or_insert(e);
            }
        }
    }
    match first_error {
        Some(e) => Err(e),
        None => Ok(groups.into_keys().collect()),
    }
}
