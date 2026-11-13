//! User actions on mail: read/unread, archive, star, labels and trash.
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
use crate::model::{AccountId, LabelId, LabelKind, ThreadId};

const UNREAD: &str = "UNREAD";
const INBOX: &str = "INBOX";
const STARRED: &str = "STARRED";
const TRASH: &str = "TRASH";
const SPAM: &str = "SPAM";

/// Which Gmail call carries the change.
#[derive(Debug, Clone, Copy)]
enum Remote {
    /// `threads.modify` with the plan's labels.
    Modify,
    /// `threads.trash` (Gmail adds TRASH itself).
    Trash,
    /// `threads.untrash` (Gmail removes TRASH itself).
    Untrash,
}

/// The label change for one account's threads, as Gmail label IDs.
#[derive(Debug, Default)]
struct AccountPlan {
    threads: Vec<(ThreadId, String)>,
    add: Vec<String>,
    remove: Vec<String>,
}

/// Groups local threads by owning account, with their Gmail IDs.
fn by_account(
    db: &Db,
    threads: &[ThreadId],
) -> Result<BTreeMap<AccountId, Vec<(ThreadId, String)>>> {
    let conn = db.conn();
    let mut groups: BTreeMap<AccountId, Vec<(ThreadId, String)>> = BTreeMap::new();
    for &thread in threads {
        let (account, gmail_id) = store::thread_gmail_ref(&conn, thread)?;
        let group = groups.entry(account).or_default();
        if !group.iter().any(|(t, _)| *t == thread) {
            group.push((thread, gmail_id));
        }
    }
    Ok(groups)
}

/// The same system-label change for every account.
fn system_plan(
    db: &Db,
    threads: &[ThreadId],
    add: &[&str],
    remove: &[&str],
) -> Result<BTreeMap<AccountId, AccountPlan>> {
    Ok(by_account(db, threads)?
        .into_iter()
        .map(|(account, threads)| {
            let plan = AccountPlan {
                threads,
                add: add.iter().map(|s| s.to_string()).collect(),
                remove: remove.iter().map(|s| s.to_string()).collect(),
            };
            (account, plan)
        })
        .collect())
}

/// Applies a plan: locally first, then per account to Gmail. Threads Gmail
/// refuses are restored locally and the first error is returned; the
/// others keep their new state. Returns the accounts touched.
async fn apply(
    db: &Db,
    gmail_for: impl Fn(AccountId) -> Result<GmailClient>,
    plans: BTreeMap<AccountId, AccountPlan>,
    remote: Remote,
) -> Result<Vec<AccountId>> {
    // Optimistic local change, remembering how to undo it. The lock is
    // taken per statement, never across the Gmail calls below.
    let mut snapshots: BTreeMap<ThreadId, Vec<store::LabelSnapshot>> = BTreeMap::new();
    for plan in plans.values() {
        for (thread, _) in &plan.threads {
            let mut saved = Vec::new();
            for label in plan.add.iter().chain(&plan.remove) {
                saved.push(store::label_snapshot(&db.conn(), *thread, label)?);
            }
            for label in &plan.add {
                store::set_thread_label(&mut db.conn(), *thread, label, true)?;
            }
            for label in &plan.remove {
                store::set_thread_label(&mut db.conn(), *thread, label, false)?;
            }
            snapshots.insert(*thread, saved);
        }
    }
    let restore = |thread: &ThreadId| -> Result<()> {
        for snapshot in &snapshots[thread] {
            store::restore_label_snapshot(&mut db.conn(), snapshot)?;
        }
        Ok(())
    };

    let mut first_error: Option<CoreError> = None;
    for (&account, plan) in &plans {
        // The user is waiting on this, so it skips ahead of background sync.
        let gmail = match gmail_for(account) {
            Ok(g) => g.interactive(),
            Err(e) => {
                for (thread, _) in &plan.threads {
                    restore(thread)?;
                }
                first_error.get_or_insert(e);
                continue;
            }
        };
        let add: Vec<&str> = plan.add.iter().map(String::as_str).collect();
        let remove: Vec<&str> = plan.remove.iter().map(String::as_str).collect();
        for (thread, gmail_id) in &plan.threads {
            let result = match remote {
                Remote::Modify => gmail.modify_thread(gmail_id, &add, &remove).await,
                Remote::Trash => gmail.trash_thread(gmail_id).await,
                Remote::Untrash => gmail.untrash_thread(gmail_id).await,
            };
            if let Err(e) = result {
                restore(thread)?;
                first_error.get_or_insert(e);
            }
        }
    }
    match first_error {
        Some(e) => Err(e),
        None => Ok(plans.into_keys().collect()),
    }
}

/// Marks threads read or unread.
pub async fn set_read(
    db: &Db,
    gmail_for: impl Fn(AccountId) -> Result<GmailClient>,
    threads: &[ThreadId],
    read: bool,
) -> Result<Vec<AccountId>> {
    let plans = if read {
        system_plan(db, threads, &[], &[UNREAD])?
    } else {
        system_plan(db, threads, &[UNREAD], &[])?
    };
    apply(db, gmail_for, plans, Remote::Modify).await
}

/// Archives threads (takes them out of the Inbox), or moves them back.
/// Gmail has no archived label: archived just means not in INBOX.
pub async fn set_archived(
    db: &Db,
    gmail_for: impl Fn(AccountId) -> Result<GmailClient>,
    threads: &[ThreadId],
    archived: bool,
) -> Result<Vec<AccountId>> {
    let plans = if archived {
        system_plan(db, threads, &[], &[INBOX])?
    } else {
        system_plan(db, threads, &[INBOX], &[])?
    };
    apply(db, gmail_for, plans, Remote::Modify).await
}

/// Stars or unstars threads (every message, as `threads.modify` does).
pub async fn set_starred(
    db: &Db,
    gmail_for: impl Fn(AccountId) -> Result<GmailClient>,
    threads: &[ThreadId],
    starred: bool,
) -> Result<Vec<AccountId>> {
    let plans = if starred {
        system_plan(db, threads, &[STARRED], &[])?
    } else {
        system_plan(db, threads, &[], &[STARRED])?
    };
    apply(db, gmail_for, plans, Remote::Modify).await
}

/// Moves threads to the Trash, or takes them out. Gmail empties the Trash
/// itself after 30 days; deleting forever needs a broader scope than
/// the app asks for. The cached copy mirrors what Gmail does: trashing
/// drops INBOX, and taking a thread out of the Trash doesn't bring it
/// back, so it is in All Mail only (checked in Gmail, 2026-11-12).
pub async fn set_trashed(
    db: &Db,
    gmail_for: impl Fn(AccountId) -> Result<GmailClient>,
    threads: &[ThreadId],
    trashed: bool,
) -> Result<Vec<AccountId>> {
    if trashed {
        let plans = system_plan(db, threads, &[TRASH], &[INBOX])?;
        apply(db, gmail_for, plans, Remote::Trash).await
    } else {
        let plans = system_plan(db, threads, &[], &[TRASH])?;
        apply(db, gmail_for, plans, Remote::Untrash).await
    }
}

/// Adds and removes user labels. A user label belongs to one account, so
/// each label only applies to that account's threads in the selection; a
/// label whose account has no thread in the selection is an error (it
/// would otherwise silently do nothing).
pub async fn change_labels(
    db: &Db,
    gmail_for: impl Fn(AccountId) -> Result<GmailClient>,
    threads: &[ThreadId],
    add: &[LabelId],
    remove: &[LabelId],
) -> Result<Vec<AccountId>> {
    let groups = by_account(db, threads)?;
    let mut plans: BTreeMap<AccountId, AccountPlan> = BTreeMap::new();
    for (labels, adding) in [(add, true), (remove, false)] {
        for &label in labels {
            let (account, gmail_label_id, kind) = store::label_ref(&db.conn(), label)?;
            if kind != LabelKind::User {
                return Err(CoreError::Invalid(format!(
                    "label {} is a system label",
                    label.0
                )));
            }
            let Some(account_threads) = groups.get(&account) else {
                return Err(CoreError::Invalid(format!(
                    "label {} belongs to an account with no selected conversation",
                    label.0
                )));
            };
            let plan = plans.entry(account).or_insert_with(|| AccountPlan {
                threads: account_threads.clone(),
                ..AccountPlan::default()
            });
            if adding {
                plan.add.push(gmail_label_id);
            } else {
                plan.remove.push(gmail_label_id);
            }
        }
    }
    apply(db, gmail_for, plans, Remote::Modify).await
}

/// What "Empty Spam" did.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct EmptiedSpam {
    /// Messages moved from Spam to Trash, every account.
    pub moved: u32,
    /// Accounts that couldn't be emptied (signed out, offline…).
    pub failed: u32,
}

/// Gmail's limit for `messages.batchModify`.
const BATCH_MODIFY_MAX: usize = 1000;

/// Empties each account's Spam into Trash (Gmail deletes Trash after 30
/// days). The app has `gmail.modify`, which can't delete for good. Every
/// message in Gmail's Spam goes, not only those cached. Each account is
/// done with its own client; one failing doesn't stop the others, and the
/// error comes back only if every account failed.
pub async fn empty_spam(
    db: &Db,
    gmail_for: impl Fn(AccountId) -> Result<GmailClient>,
    accounts: &[AccountId],
) -> Result<EmptiedSpam> {
    let mut done = EmptiedSpam {
        moved: 0,
        failed: 0,
    };
    let mut first_error = None;
    for &account in accounts {
        match empty_account_spam(db, &gmail_for, account).await {
            Ok(n) => done.moved += n,
            Err(e) => {
                done.failed += 1;
                first_error.get_or_insert(e);
            }
        }
    }
    match first_error {
        Some(e) if done.failed as usize == accounts.len() => Err(e),
        _ => Ok(done),
    }
}

async fn empty_account_spam(
    db: &Db,
    gmail_for: &impl Fn(AccountId) -> Result<GmailClient>,
    account: AccountId,
) -> Result<u32> {
    let gmail = gmail_for(account)?.interactive();
    let mut ids: Vec<String> = Vec::new();
    let mut page_token: Option<String> = None;
    loop {
        let page = gmail
            .label_message_ids(SPAM, page_token.as_deref(), 500)
            .await?;
        ids.extend(page.messages.into_iter().map(|m| m.id));
        page_token = page.next_page_token;
        if page_token.is_none() {
            break;
        }
    }
    for chunk in ids.chunks(BATCH_MODIFY_MAX) {
        gmail
            .batch_modify_messages(chunk, &[TRASH.to_string()], &[SPAM.to_string()])
            .await?;
    }
    // The cache follows at once (sync would catch up anyway).
    store::spam_to_trash(&mut db.conn(), account)?;
    Ok(u32::try_from(ids.len()).unwrap_or(u32::MAX))
}

/// Reports threads as spam (out of the Inbox, into Spam, as Gmail does) or
/// as not spam (back to the Inbox). Routed per account like the others.
pub async fn set_spam(
    db: &Db,
    gmail_for: impl Fn(AccountId) -> Result<GmailClient>,
    threads: &[ThreadId],
    spam: bool,
) -> Result<Vec<AccountId>> {
    let plans = if spam {
        system_plan(db, threads, &[SPAM], &[INBOX])?
    } else {
        system_plan(db, threads, &[INBOX], &[SPAM])?
    };
    apply(db, gmail_for, plans, Remote::Modify).await
}
