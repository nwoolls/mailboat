//! One sync pass for one account: a full sync (first run, or when the
//! historyId expired) or an incremental `history.list` sync.

use std::collections::{BTreeSet, HashSet};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::db::store::{self, IncomingLabel, StoredBody};
use crate::db::Db;
use crate::error::{CoreError, Result};
use crate::gmail::{parse, GmailClient};
use crate::model::{AccountId, LabelKind, MessageId};

/// One part of what the initial sync downloads: the newest `max` threads
/// of a label, or of All Mail when `label` is `None`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScopePart {
    pub label: Option<&'static str>,
    pub max: usize,
}

/// Bump when `SyncConfig::default().scope` widens, so accounts synced under
/// the old scope get a one-time widening pass. 1 = INBOX/STARRED/SENT only.
pub const SCOPE_VERSION: u32 = 2;

/// Bump to rerun the one-time attachment catch-up (`mark_attachments`).
pub const ATTACHMENTS_VERSION: u32 = 1;

/// The catch-up asks Gmail for at most this many messages with attachments
/// (5 quota units per 500), newest first; older ones are marked when opened.
const ATTACHMENT_CATCH_UP_MAX: usize = 20_000;

#[derive(Debug, Clone)]
pub struct SyncConfig {
    /// What the initial sync downloads, in order (the Inbox fills first).
    /// Older mail loads later.
    pub scope: Vec<ScopePart>,
    /// Bodies of the newest messages to prefetch after each pass.
    pub body_prefetch: u32,
    /// Downloads new mail's remote images after each pass (Settings can
    /// turn it off); `None` never does (tests).
    pub images: Option<crate::mail::prefetch::Prefetch>,
    /// How often a long first sync stops to pick up mail that arrived since
    /// it began, so new mail shows within minutes instead of after
    /// thousands of old conversations.
    pub catch_up_every: Duration,
}

impl Default for SyncConfig {
    fn default() -> Self {
        let part = |label, max| ScopePart { label, max };
        Self {
            scope: vec![
                part(Some("INBOX"), 2000),
                // All Mail covers archived and sent mail. Most of the owner's
                // mail is archived (Inbox Zero), so this is the big one.
                part(None, 5000),
                part(Some("STARRED"), 1000),
                part(Some("DRAFT"), 200),
                part(Some("SPAM"), 100),
                part(Some("TRASH"), 100),
            ],
            body_prefetch: 25,
            images: None,
            catch_up_every: Duration::from_secs(120),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum SyncPhase {
    Listing,
    Fetching,
    Bodies,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SyncProgress {
    pub account_id: AccountId,
    pub phase: SyncPhase,
    pub done: u32,
    pub total: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SyncKind {
    Full,
    Incremental,
    /// Incremental, plus a one-time fetch of threads a wider scope added.
    Widened,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyncOutcome {
    pub kind: SyncKind,
    /// Threads added, changed or removed.
    pub changed_threads: usize,
    /// Messages that just arrived unread in the Inbox (not on a full sync),
    /// for notifications.
    pub new_inbox: Vec<MessageId>,
    /// Messages that just arrived unread anywhere but Spam and Trash (a
    /// superset of `new_inbox`), for "notify about all new mail".
    pub new_unread: Vec<MessageId>,
}

/// Threads fetched per write, so progress updates and DB locks stay short.
const FETCH_CHUNK: usize = 120;

pub struct SyncEngine<'a> {
    pub db: &'a Db,
    pub gmail: &'a GmailClient,
    pub account: AccountId,
    pub config: &'a SyncConfig,
    pub progress: &'a (dyn Fn(SyncProgress) + Send + Sync),
}

impl SyncEngine<'_> {
    /// Incremental if we have a cursor, full otherwise or if it expired.
    /// An account cached under an older, narrower scope is widened after
    /// its incremental pass.
    pub async fn run(&self) -> Result<SyncOutcome> {
        let cursor = store::history_id(&self.db.conn(), self.account)?;
        let mut outcome = match cursor {
            Some(start) => match self.incremental(start).await {
                Err(CoreError::HistoryExpired) => self.full_then_catch_up().await,
                other => other,
            },
            None => self.full_then_catch_up().await,
        }?;
        let scope = store::scope_version(&self.db.conn(), self.account)?;
        if outcome.kind == SyncKind::Incremental && scope < SCOPE_VERSION {
            let added = self.widen().await?;
            outcome = SyncOutcome {
                kind: SyncKind::Widened,
                changed_threads: outcome.changed_threads + added,
                new_inbox: outcome.new_inbox,
                new_unread: outcome.new_unread,
            };
        }
        let attachments = store::attachments_version(&self.db.conn(), self.account)?;
        if attachments < ATTACHMENTS_VERSION {
            self.mark_attachments().await?;
        }
        self.prefetch_bodies().await?;
        Ok(outcome)
    }

    /// A full sync, then at once what arrived while it ran. A full sync
    /// notes where Gmail's history stood when it began and stores that as
    /// the cursor, so replaying from there finds the mail that came since
    /// (and notifies about it): without this it waited for the next pass,
    /// after the body prefetch and the poll interval.
    async fn full_then_catch_up(&self) -> Result<SyncOutcome> {
        let mut outcome = self.full().await?;
        let cursor = store::history_id(&self.db.conn(), self.account)?;
        let Some(start) = cursor else {
            return Ok(outcome);
        };
        match self.incremental(start).await {
            Ok(after) => {
                outcome.changed_threads += after.changed_threads;
                outcome.new_inbox = after.new_inbox;
                outcome.new_unread = after.new_unread;
            }
            // Gmail kept no history that old: nothing to catch up on.
            Err(CoreError::HistoryExpired) => {}
            Err(e) => return Err(e),
        }
        Ok(outcome)
    }

    /// One-time catch-up for caches built before sync could tell which
    /// messages have attachments: asks Gmail (`has:attachment`, IDs only)
    /// and marks the cached ones. Interrupted? It runs again next pass.
    pub async fn mark_attachments(&self) -> Result<usize> {
        let mut ids: Vec<String> = Vec::new();
        let mut page_token: Option<String> = None;
        loop {
            let page = self
                .gmail
                .search_message_ids("has:attachment", page_token.as_deref(), 500)
                .await?;
            ids.extend(page.messages.into_iter().map(|m| m.id));
            page_token = page.next_page_token;
            if page_token.is_none() || ids.len() >= ATTACHMENT_CATCH_UP_MAX {
                break;
            }
        }
        let changed =
            store::mark_messages_with_attachments(&mut self.db.conn(), self.account, &ids)?;
        store::set_attachments_version(&self.db.conn(), self.account, ATTACHMENTS_VERSION)?;
        Ok(changed)
    }

    fn report(&self, phase: SyncPhase, done: usize, total: usize) {
        (self.progress)(SyncProgress {
            account_id: self.account,
            phase,
            done: done as u32,
            total: total as u32,
        });
    }

    pub async fn full(&self) -> Result<SyncOutcome> {
        // Read the historyId first: anything that changes while we list and
        // fetch is replayed by the next incremental pass. If an earlier full
        // sync was interrupted (rate limit, network, app quit), resume it:
        // keep its historyId and skip threads it already fetched.
        let pending = store::pending_full_sync(&self.db.conn(), self.account)?;
        let (start_history_id, started_at) = match pending {
            Some(p) => p,
            None => {
                let profile = self.gmail.profile().await?;
                let started_at =
                    store::begin_full_sync(&self.db.conn(), self.account, profile.history_id)?;
                (profile.history_id, started_at)
            }
        };
        self.sync_labels().await?;

        let (ids, seen) = self.list_scope().await?;

        // Threads cached earlier that are no longer in the window are stale
        // after a resync (the history that would have updated them is gone).
        let stale: Vec<String> = store::thread_ids_for_account(&self.db.conn(), self.account)?
            .into_iter()
            .filter(|id| !seen.contains(id))
            .collect();
        {
            let conn = self.db.conn();
            for id in &stale {
                store::delete_thread(&conn, self.account, id)?;
            }
        }

        let done = store::threads_synced_since(&self.db.conn(), self.account, started_at)?;
        let todo: Vec<String> = ids
            .iter()
            .filter(|id| !done.contains(*id))
            .cloned()
            .collect();
        self.fetch_chunks(&todo, Some(start_history_id), false)
            .await?;
        store::set_history_id(&self.db.conn(), self.account, Some(start_history_id), true)?;
        store::set_scope_version(&self.db.conn(), self.account, SCOPE_VERSION)?;
        // Threads fetched now carry sync's own attachment guess.
        store::set_attachments_version(&self.db.conn(), self.account, ATTACHMENTS_VERSION)?;
        Ok(SyncOutcome {
            kind: SyncKind::Full,
            changed_threads: ids.len() + stale.len(),
            new_inbox: Vec::new(),
            new_unread: Vec::new(),
        })
    }

    /// Thread IDs in the sync scope, in scope order, without duplicates.
    async fn list_scope(&self) -> Result<(Vec<String>, HashSet<String>)> {
        self.report(SyncPhase::Listing, 0, 0);
        let mut ids: Vec<String> = Vec::new();
        let mut seen = HashSet::new();
        for part in &self.config.scope {
            let mut page_token: Option<String> = None;
            let mut count = 0;
            loop {
                let remaining = part.max - count;
                let page = self
                    .gmail
                    .list_threads(part.label, page_token.as_deref(), remaining.min(500) as u32)
                    .await?;
                for t in page.threads {
                    count += 1;
                    if seen.insert(t.id.clone()) {
                        ids.push(t.id);
                    }
                }
                page_token = page.next_page_token;
                if page_token.is_none() || count >= part.max {
                    break;
                }
            }
            self.report(SyncPhase::Listing, ids.len(), 0);
        }
        Ok((ids, seen))
    }

    /// Fetches threads the current scope covers but the cache lacks, for an
    /// account that synced under an older scope. Threads already cached are
    /// kept current by incremental sync, so they are skipped, and the
    /// history cursor is left alone. Interrupted? The next pass simply
    /// fetches whatever is still missing.
    pub async fn widen(&self) -> Result<usize> {
        let (ids, _) = self.list_scope().await?;
        let cached = store::thread_ids_for_account(&self.db.conn(), self.account)?;
        let missing: Vec<String> = ids.into_iter().filter(|id| !cached.contains(id)).collect();
        self.fetch_threads(&missing).await?;
        store::set_scope_version(&self.db.conn(), self.account, SCOPE_VERSION)?;
        Ok(missing.len())
    }

    pub async fn incremental(&self, start: u64) -> Result<SyncOutcome> {
        Ok(self.replay(start, true).await?.0)
    }

    /// Applies what Gmail's history says changed since `start`, and returns
    /// the history ID it reached. `commit` makes it a real pass: it stores
    /// where it reached and works out which messages are new mail. Without
    /// it (a long first sync catching up part-way) only the cache changes
    /// and nothing is reported, so the first sync's progress keeps counting
    /// its long fetch; the real pass at the end replays it all again.
    async fn replay(&self, start: u64, commit: bool) -> Result<(SyncOutcome, u64)> {
        let mut changed: BTreeSet<String> = BTreeSet::new();
        let mut deleted: Vec<String> = Vec::new();
        let mut added: Vec<String> = Vec::new();
        let mut page_token: Option<String> = None;
        let mut latest = start;
        let mut labels_changed = false;
        loop {
            let page = self.gmail.history(start, page_token.as_deref()).await?;
            for h in &page.history {
                added.extend(h.messages_added.iter().map(|m| m.message.id.clone()));
                for m in h
                    .messages_added
                    .iter()
                    .chain(&h.labels_added)
                    .chain(&h.labels_removed)
                {
                    changed.insert(m.message.thread_id.clone());
                }
                for m in &h.messages {
                    changed.insert(m.thread_id.clone());
                }
                for m in &h.messages_deleted {
                    deleted.push(m.message.id.clone());
                    changed.insert(m.message.thread_id.clone());
                }
                labels_changed |= !h.labels_added.is_empty() || !h.labels_removed.is_empty();
            }
            if let Some(id) = page.history_id {
                latest = latest.max(id);
            }
            page_token = page.next_page_token;
            if page_token.is_none() {
                break;
            }
        }

        if labels_changed {
            // Cheap, and catches labels created since the last pass.
            self.sync_labels().await?;
        }
        if !deleted.is_empty() {
            store::delete_messages(&mut self.db.conn(), self.account, &deleted)?;
        }
        let ids: Vec<String> = changed.into_iter().collect();
        self.fetch_chunks(&ids, None, !commit).await?;
        let (new_inbox, new_unread) = if commit {
            store::set_history_id(&self.db.conn(), self.account, Some(latest), false)?;
            // One lock at a time: two in one expression would wait on each other.
            let new_inbox = store::new_inbox_messages(&self.db.conn(), self.account, &added)?;
            let new_unread = store::new_unread_messages(&self.db.conn(), self.account, &added)?;
            (new_inbox, new_unread)
        } else {
            (Vec::new(), Vec::new())
        };
        let outcome = SyncOutcome {
            kind: SyncKind::Incremental,
            changed_threads: ids.len(),
            new_inbox,
            new_unread,
        };
        Ok((outcome, latest))
    }

    async fn sync_labels(&self) -> Result<()> {
        refresh_labels(self.db, self.gmail, self.account).await
    }

    /// Fetches threads by Gmail ID and writes them (or deletes vanished ones).
    async fn fetch_threads(&self, ids: &[String]) -> Result<()> {
        self.fetch_chunks(ids, None, false).await
    }

    /// `fetch_threads`, chunk by chunk. `catch_up` is a first sync's
    /// starting history point: every `catch_up_every` it stops to pick up
    /// what changed since (mail that arrived meanwhile), which is why a
    /// long first sync shows new mail as it comes. `quiet` reports no
    /// progress.
    async fn fetch_chunks(&self, ids: &[String], catch_up: Option<u64>, quiet: bool) -> Result<()> {
        let total = ids.len();
        let report = |done: usize| {
            if !quiet {
                self.report(SyncPhase::Fetching, done, total);
            }
        };
        report(0);
        let mut catch_up_from = catch_up;
        let mut last_catch_up = Instant::now();
        for (n, chunk) in ids.chunks(FETCH_CHUNK).enumerate() {
            let threads = self.gmail.batch_thread_metadata(chunk).await?;
            // The lock ends with this block: nothing awaits while holding it.
            {
                let mut conn = self.db.conn();
                for (id, thread) in chunk.iter().zip(threads) {
                    match thread {
                        Some(t) => {
                            store::upsert_thread(
                                &mut conn,
                                self.account,
                                &parse::thread_to_incoming(&t),
                            )?;
                        }
                        None => store::delete_thread(&conn, self.account, id)?,
                    }
                }
            }
            let done = (n * FETCH_CHUNK + chunk.len()).min(total);
            report(done);
            let Some(from) = catch_up_from else { continue };
            if last_catch_up.elapsed() < self.config.catch_up_every {
                continue;
            }
            // Boxed: replay fetches threads in its turn.
            match Box::pin(self.replay(from, false)).await {
                // Next time, only what changed since this.
                Ok((_, reached)) => catch_up_from = Some(reached),
                // Too old to replay: the full sync is rebuilding it all anyway.
                Err(CoreError::HistoryExpired) => catch_up_from = None,
                Err(e) => return Err(e),
            }
            last_catch_up = Instant::now();
            // Shows what it found (the window refreshes on this report) and
            // puts the count back.
            report(done);
        }
        Ok(())
    }

    async fn prefetch_bodies(&self) -> Result<()> {
        if self.config.body_prefetch == 0 {
            return Ok(());
        }
        let missing =
            store::messages_missing_body(&self.db.conn(), self.account, self.config.body_prefetch)?;
        for (i, id) in missing.iter().enumerate() {
            match fetch_body(self.db, self.gmail, *id).await {
                Ok(_) | Err(CoreError::NotFound(_)) => {}
                Err(e) => return Err(e),
            }
            self.report(SyncPhase::Bodies, i + 1, missing.len());
        }
        Ok(())
    }
}

/// Fetches an account's labels from Gmail and stores them.
pub async fn refresh_labels(db: &Db, gmail: &GmailClient, account: AccountId) -> Result<()> {
    let labels: Vec<IncomingLabel> = gmail
        .labels()
        .await?
        .labels
        .into_iter()
        .map(|l| IncomingLabel {
            kind: if l.label_type.as_deref() == Some("user") {
                LabelKind::User
            } else {
                LabelKind::System
            },
            color_bg: l.color.as_ref().and_then(|c| c.background_color.clone()),
            color_fg: l.color.as_ref().and_then(|c| c.text_color.clone()),
            gmail_label_id: l.id,
            name: l.name,
        })
        .collect();
    store::sync_labels(&mut db.conn(), account, &labels)
}

/// Returns a message body, fetching and caching it if needed.
pub async fn fetch_body(db: &Db, gmail: &GmailClient, message: MessageId) -> Result<StoredBody> {
    let cached = store::get_body(&db.conn(), message)?;
    if let Some(body) = cached {
        return Ok(body);
    }
    let (_, gmail_id) = store::message_gmail_ref(&db.conn(), message)?;
    let full = gmail.message_full(&gmail_id).await?;
    let body = full
        .payload
        .as_ref()
        .map(parse::extract_body)
        .unwrap_or(StoredBody {
            html: None,
            text: None,
        });
    let attachments = full
        .payload
        .as_ref()
        .map(|p| parse::extract_attachments(p, body.html.as_deref()))
        .unwrap_or_default();
    store::set_body(&mut db.conn(), message, &body, &attachments)?;
    // Meeting invitations: keep an inline calendar part with the body. An
    // attached-only one is downloaded when the invitation is shown
    // (`calendar::invite_for`), not for every body sync fetches.
    match full.payload.as_ref().and_then(parse::calendar_part) {
        Some(parse::CalendarPart::Inline(ics)) => {
            store::set_calendar(&db.conn(), message, Some(&ics))?
        }
        Some(parse::CalendarPart::Attachment { .. }) => {}
        None => store::set_calendar(&db.conn(), message, None)?,
    }
    Ok(body)
}
