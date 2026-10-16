//! Loading mail older than the cache, on demand, when a list is scrolled
//! past its last cached conversation.
//!
//! The cache is not one tidy date range per view (an old starred thread can
//! sit in a label view far below the rest), so "older than the oldest cached
//! thread" would skip gaps. Instead this walks Gmail's own list for the view,
//! newest first, skips threads already cached, and fetches the next few
//! missing ones. Listing is cheap (500 IDs for one call); an `OlderCursor`
//! remembers where the walk got to so the next load carries on from there.

use std::collections::VecDeque;

use rusqlite::{Connection, OptionalExtension};

use crate::db::{store, Db};
use crate::error::Result;
use crate::gmail::{parse, GmailClient};
use crate::model::{AccountId, MailView};

/// Threads fetched per call. Each costs 10 quota units, so 25 take about
/// four seconds at the paced rate; rows appear chunk by chunk meanwhile.
pub const OLDER_BATCH: usize = 25;
/// Threads written per chunk, so rows show up while the rest load.
const WRITE_CHUNK: usize = 5;
/// IDs per `threads.list` call (Gmail's maximum; the cost is the same).
const LIST_PAGE: u32 = 500;

/// How far one account's walk through one view has got. Kept in memory;
/// starting over after a relaunch only costs a few cheap list calls.
#[derive(Debug, Clone, Default)]
pub struct OlderCursor {
    /// Gmail's token for the next page of IDs.
    page_token: Option<String>,
    /// IDs from pages already listed that haven't been checked yet.
    pending: VecDeque<String>,
    /// The first page has been listed.
    started: bool,
    /// Gmail has nothing further in this view.
    pub exhausted: bool,
}

/// The `threads.list` filter for a view in one account, or `None` if the
/// view has nothing to load there (local search, or another account's label).
pub fn gmail_filter(
    conn: &Connection,
    account: AccountId,
    view: &MailView,
) -> Result<Option<(Option<String>, Option<&'static str>)>> {
    Ok(match view {
        MailView::System { label } => Some((Some(label.gmail_id().to_string()), None)),
        // A user label belongs to one account; look up its Gmail ID there.
        MailView::UserLabel { label_id } => conn
            .query_row(
                "SELECT gmail_label_id FROM labels WHERE id = ?1 AND account_id = ?2",
                rusqlite::params![label_id, account],
                |r| r.get::<_, String>(0),
            )
            .optional()?
            .map(|gmail_id| (Some(gmail_id), None)),
        // Without a label, Gmail lists All Mail (no Spam or Trash).
        MailView::AllMail => Some((None, None)),
        MailView::Archive => Some((None, Some("-in:inbox"))),
        // Searching Gmail itself (`q=`) is Milestone 5.
        MailView::Search { .. } => None,
    })
}

/// Fetches up to `want` threads of `view` that the cache doesn't have yet,
/// continuing from `cursor`. Calls `on_chunk` after each small batch is
/// written so the list can refresh. Returns how many threads were added.
pub async fn load_older(
    db: &Db,
    gmail: &GmailClient,
    account: AccountId,
    view: &MailView,
    want: usize,
    cursor: &mut OlderCursor,
    on_chunk: &(dyn Fn() + Send + Sync),
) -> Result<usize> {
    let filter = gmail_filter(&db.conn(), account, view)?;
    let Some((label, q)) = filter else {
        cursor.exhausted = true;
        return Ok(0);
    };
    let cached = store::thread_ids_for_account(&db.conn(), account)?;

    let mut wanted: Vec<String> = Vec::new();
    while wanted.len() < want {
        if let Some(id) = cursor.pending.pop_front() {
            if !cached.contains(&id) {
                wanted.push(id);
            }
            continue;
        }
        if cursor.started && cursor.page_token.is_none() {
            cursor.exhausted = true;
            break;
        }
        let page = match gmail
            .search_threads(label.as_deref(), q, cursor.page_token.as_deref(), LIST_PAGE)
            .await
        {
            Ok(page) => page,
            Err(e) => {
                // A stale page token can't be trusted again: start over
                // next time. Cached threads are skipped, so that's cheap,
                // and the IDs picked so far will be found again.
                *cursor = OlderCursor::default();
                return Err(e);
            }
        };
        cursor.started = true;
        cursor.page_token = page.next_page_token;
        cursor
            .pending
            .extend(page.threads.into_iter().map(|t| t.id));
    }

    let mut added = 0;
    for (n, chunk) in wanted.chunks(WRITE_CHUNK).enumerate() {
        let threads = match gmail.batch_thread_metadata(chunk).await {
            Ok(threads) => threads,
            Err(e) => {
                // Put back what wasn't fetched, so the next load retries it.
                for id in wanted[n * WRITE_CHUNK..].iter().rev() {
                    cursor.pending.push_front(id.clone());
                }
                cursor.exhausted = false;
                return Err(e);
            }
        };
        {
            let mut conn = db.conn();
            // Gone since it was listed: nothing to add.
            for thread in threads.iter().flatten() {
                store::upsert_thread(&mut conn, account, &parse::thread_to_incoming(thread))?;
                added += 1;
            }
        }
        on_chunk();
    }
    // Everything listed was checked and there are no more pages.
    if cursor.pending.is_empty() && cursor.started && cursor.page_token.is_none() {
        cursor.exhausted = true;
    }
    Ok(added)
}
