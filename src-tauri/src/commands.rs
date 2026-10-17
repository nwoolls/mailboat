//! Commands the UI can call. Each is a thin wrapper over `mailboat_core`;
//! logic and tests live there.

use std::sync::Arc;
use std::time::Duration;

use mailboat_core::attachments;
use mailboat_core::auth::{config, oauth, tokens, AccountTokens};
use mailboat_core::compose::contacts::Contact;
use mailboat_core::compose::identities::{self, Identity};
use mailboat_core::compose::{self, OpenedDraft, OutgoingMessage, ReplySource};
use mailboat_core::db::{accounts, query, store};
use mailboat_core::mail::images::{self, ImagePolicy};
use mailboat_core::mail::{self, SafeMessage};
use mailboat_core::model::{
    Account, AccountFilter, AccountId, AccountSyncState, Attachment, AttachmentId, DraftId, Label,
    LabelId, LabelUnread, ListQuery, MailView, MessageId, ThreadDetail, ThreadId, ThreadPage,
};
use mailboat_core::sync::{fetch_body, load_older, OLDER_BATCH};
use mailboat_core::CoreError;
use serde::Serialize;
use specta::Type;
use tauri::{AppHandle, State};
use tauri_specta::Event;

use crate::error::CmdResult;
use crate::events::MailChangedEvent;
use crate::files;
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub fn accounts_list(state: State<'_, AppState>) -> CmdResult<Vec<Account>> {
    Ok(accounts::list(&state.db.conn())?)
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct OAuthSetup {
    /// True if a Google OAuth client is available (file or env vars).
    pub configured: bool,
    /// Where to save the downloaded client JSON.
    pub client_file_path: String,
    /// Why loading failed, if it did.
    pub problem: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub fn oauth_setup(state: State<'_, AppState>) -> OAuthSetup {
    let result = state.oauth_config();
    OAuthSetup {
        configured: result.is_ok(),
        client_file_path: config::client_file_path(&state.config_dir)
            .display()
            .to_string(),
        problem: result.err().map(|e| e.to_string()),
    }
}

/// Opens Google sign-in in the browser and adds (or re-authorizes) the
/// account that signs in. Signing in again with a connected account
/// refreshes it instead of creating a duplicate. A second call cancels a
/// first one that is still waiting for the browser.
#[tauri::command]
#[specta::specta]
pub async fn account_add(
    state: State<'_, AppState>,
    login_hint: Option<String>,
) -> CmdResult<Account> {
    // The app can't tell when the browser tab is closed, so the user can
    // cancel (`account_add_cancel`), and starting again replaces a sign-in
    // that is still waiting instead of failing. The cancel is repeated
    // until the lock is free, in case the old sign-in hadn't started
    // listening for it yet.
    let _guard = loop {
        state.sign_in_cancel.notify_waiters();
        if let Ok(guard) =
            tokio::time::timeout(Duration::from_millis(100), state.sign_in.lock()).await
        {
            break guard;
        }
    };
    let config = state.oauth_config()?;
    let signed_in = oauth::sign_in(
        &state.http,
        &config,
        login_hint.as_deref(),
        |url| {
            open::that_detached(url)
                .map_err(|e| CoreError::Other(format!("could not open the browser: {e}")))
        },
        state.sign_in_cancel.notified(),
    )
    .await?;

    state.secrets.set(
        &tokens::refresh_token_key(&signed_in.user.sub),
        &signed_in.refresh_token,
    )?;
    let account = accounts::upsert(
        &state.db.conn(),
        &accounts::NewAccount {
            google_sub: &signed_in.user.sub,
            email: &signed_in.user.email,
            display_name: signed_in.user.name.as_deref(),
            avatar_url: signed_in.user.picture.as_deref(),
            oauth_client: &config.name,
        },
    )?;
    let account_tokens = Arc::new(AccountTokens::new(
        state.http.clone(),
        config,
        state.secrets.clone(),
        &signed_in.user.sub,
    ));
    account_tokens
        .seed(signed_in.access_token, signed_in.expires_in)
        .await;
    let _ = state.set_tokens(account.id, account_tokens);
    state.start_sync(account.id)?;
    Ok(account)
}

/// Stops waiting for a browser sign-in started by `account_add`.
#[tauri::command]
#[specta::specta]
pub fn account_add_cancel(state: State<'_, AppState>) {
    state.sign_in_cancel.notify_waiters();
}

/// Disconnects an account: stops its sync, deletes its cached mail and
/// removes its token from the keychain. Nothing changes in Gmail itself.
#[tauri::command]
#[specta::specta]
pub async fn account_remove(state: State<'_, AppState>, account_id: AccountId) -> CmdResult<()> {
    // Wait for the worker to end first, so a sync in flight can't write
    // into the account while its rows are being deleted.
    state.supervisor.stop_and_wait(account_id).await;
    state.forget_account(account_id);
    let sub = accounts::google_sub(&state.db.conn(), account_id)?;
    accounts::remove(&state.db.conn(), account_id)?;
    state.secrets.delete(&tokens::refresh_token_key(&sub))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn threads_list(state: State<'_, AppState>, query: ListQuery) -> CmdResult<ThreadPage> {
    Ok(query::list_threads(&state.db.conn(), &query)?)
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct OlderLoaded {
    /// Conversations added to the cache.
    pub added: u32,
    /// Gmail has nothing older in this view for any of the accounts.
    pub exhausted: bool,
}

/// Fetches conversations older than the cache for a view, from each
/// account in the filter at once (each has its own quota). Rows appear as
/// they arrive (`MailChangedEvent`). One account failing doesn't stop the
/// others; the error is only returned if every account failed.
#[tauri::command]
#[specta::specta]
pub async fn threads_load_older(
    app: AppHandle,
    state: State<'_, AppState>,
    accounts: AccountFilter,
    view: MailView,
) -> CmdResult<OlderLoaded> {
    let ids: Vec<AccountId> = match accounts {
        AccountFilter::All => accounts::list(&state.db.conn())?
            .into_iter()
            .map(|a| a.id)
            .collect(),
        AccountFilter::Only(ids) => ids,
    };
    let mut tasks = tokio::task::JoinSet::new();
    for account in ids {
        let mut cursor = state.take_older_cursor(account, &view);
        if cursor.exhausted {
            state.put_older_cursor(account, &view, cursor);
            continue;
        }
        // Someone is waiting at the end of the list: skip ahead of sync.
        let gmail = match state.gmail_for(account) {
            Ok(g) => g.interactive(),
            Err(e) => {
                state.put_older_cursor(account, &view, cursor);
                tasks.spawn(async move { (account, OlderCursorResult::Failed(e)) });
                continue;
            }
        };
        let (db, view, app) = (state.db.clone(), view.clone(), app.clone());
        tasks.spawn(async move {
            let on_chunk = || {
                let _ = MailChangedEvent {
                    account_id: account,
                }
                .emit(&app);
            };
            let result = load_older(
                &db,
                &gmail,
                account,
                &view,
                OLDER_BATCH,
                &mut cursor,
                &on_chunk,
            )
            .await;
            (account, OlderCursorResult::Done(cursor, result))
        });
    }

    let (mut added, mut exhausted, mut failures, mut tried) = (0, true, Vec::new(), 0);
    while let Some(joined) = tasks.join_next().await {
        let Ok((account, outcome)) = joined else {
            exhausted = false;
            continue;
        };
        tried += 1;
        match outcome {
            OlderCursorResult::Done(cursor, result) => {
                exhausted &= cursor.exhausted;
                state.put_older_cursor(account, &view, cursor);
                match result {
                    Ok(n) => {
                        added += n as u32;
                        state
                            .sync_log
                            .write(account, &format!("loaded {n} older threads"));
                    }
                    Err(e) => {
                        state
                            .sync_log
                            .write(account, &format!("loading older mail failed: {e}"));
                        failures.push(e);
                    }
                }
            }
            OlderCursorResult::Failed(e) => {
                exhausted = false;
                failures.push(e);
            }
        }
    }
    if tried > 0 && failures.len() == tried {
        return Err(failures.swap_remove(0).into());
    }
    Ok(OlderLoaded { added, exhausted })
}

enum OlderCursorResult {
    Done(mailboat_core::sync::OlderCursor, mailboat_core::Result<usize>),
    Failed(CoreError),
}

#[tauri::command]
#[specta::specta]
pub fn thread_get(state: State<'_, AppState>, thread_id: ThreadId) -> CmdResult<ThreadDetail> {
    Ok(query::thread_detail(&state.db.conn(), thread_id)?)
}

#[tauri::command]
#[specta::specta]
pub fn labels_list(state: State<'_, AppState>, accounts: AccountFilter) -> CmdResult<Vec<Label>> {
    Ok(query::user_labels(&state.db.conn(), &accounts)?)
}

/// Unread conversations per label, for the sidebar's counts.
#[tauri::command]
#[specta::specta]
pub fn unread_counts(
    state: State<'_, AppState>,
    accounts: AccountFilter,
) -> CmdResult<Vec<LabelUnread>> {
    Ok(query::unread_counts(&state.db.conn(), &accounts)?)
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct OpenedMessage {
    pub message_id: MessageId,
    pub sender_email: String,
    pub images_allowed: bool,
    /// Why images did or didn't load, so the reader can offer the opposite.
    pub image_policy: ImagePolicy,
    /// Files attached to the message (inline images left out).
    pub attachments: Vec<Attachment>,
    #[serde(flatten)]
    pub content: SafeMessage,
}

/// Returns a message ready for display, downloading its body with the
/// owning account's credentials if it isn't cached yet.
#[tauri::command]
#[specta::specta]
pub async fn message_open(
    state: State<'_, AppState>,
    message_id: MessageId,
) -> CmdResult<OpenedMessage> {
    let (account, _) = store::message_gmail_ref(&state.db.conn(), message_id)?;
    let cached = store::get_body(&state.db.conn(), message_id)?;
    let body = match cached {
        Some(body) => body,
        // The user is waiting: skip ahead of any background sync.
        None => {
            fetch_body(
                &state.db,
                &state.gmail_for(account)?.interactive(),
                message_id,
            )
            .await?
        }
    };
    let sender_email: String = state
        .db
        .conn()
        .query_row(
            "SELECT from_email FROM messages WHERE id = ?1",
            [message_id],
            |r| r.get(0),
        )
        .map_err(CoreError::from)?;
    let choice = store::sender_image_choice(&state.db.conn(), &sender_email)?;
    let (in_spam, in_trash) = store::message_spam_trash(&state.db.conn(), message_id)?;
    let image_policy = images::image_policy(in_spam, in_trash, choice);
    let images_allowed = image_policy.allows();
    // Inline images are part of the email, not remote content, so they're
    // fetched (once, then cached) whatever the remote-image choice.
    let inline = match state.gmail_for(account) {
        Ok(gmail) => {
            attachments::inline_images(
                &state.db,
                &gmail.interactive(),
                message_id,
                &state.attachments_dir,
            )
            .await
        }
        Err(_) => Default::default(),
    };
    let attachments = store::attachments_for(&state.db.conn(), message_id)?;
    Ok(OpenedMessage {
        message_id,
        sender_email,
        images_allowed,
        image_policy,
        attachments,
        content: mail::safe_message(&body, images_allowed, &inline),
    })
}

/// Marks threads read or unread. Threads may span accounts; each is sent to
/// its own account. The local cache changes immediately; anything Gmail
/// refuses is put back, and the error is returned.
#[tauri::command]
#[specta::specta]
pub async fn threads_set_read(
    state: State<'_, AppState>,
    thread_ids: Vec<ThreadId>,
    read: bool,
) -> CmdResult<()> {
    mailboat_core::actions::set_read(
        &state.db,
        |account| state.gmail_for(account),
        &thread_ids,
        read,
    )
    .await?;
    Ok(())
}

/// Archives threads (out of the Inbox) or moves them back to the Inbox.
/// Routed per account like `threads_set_read`.
#[tauri::command]
#[specta::specta]
pub async fn threads_set_archived(
    state: State<'_, AppState>,
    thread_ids: Vec<ThreadId>,
    archived: bool,
) -> CmdResult<()> {
    mailboat_core::actions::set_archived(
        &state.db,
        |account| state.gmail_for(account),
        &thread_ids,
        archived,
    )
    .await?;
    Ok(())
}

/// Stars or unstars threads. Routed per account like `threads_set_read`.
#[tauri::command]
#[specta::specta]
pub async fn threads_set_starred(
    state: State<'_, AppState>,
    thread_ids: Vec<ThreadId>,
    starred: bool,
) -> CmdResult<()> {
    mailboat_core::actions::set_starred(
        &state.db,
        |account| state.gmail_for(account),
        &thread_ids,
        starred,
    )
    .await?;
    Ok(())
}

/// Moves threads to the Trash, or restores them. Routed per account like
/// `threads_set_read`.
#[tauri::command]
#[specta::specta]
pub async fn threads_set_trashed(
    state: State<'_, AppState>,
    thread_ids: Vec<ThreadId>,
    trashed: bool,
) -> CmdResult<()> {
    mailboat_core::actions::set_trashed(
        &state.db,
        |account| state.gmail_for(account),
        &thread_ids,
        trashed,
    )
    .await?;
    Ok(())
}

/// Adds and removes user labels. Each label applies only to threads of
/// the account it belongs to.
#[tauri::command]
#[specta::specta]
pub async fn threads_change_labels(
    state: State<'_, AppState>,
    thread_ids: Vec<ThreadId>,
    add: Vec<LabelId>,
    remove: Vec<LabelId>,
) -> CmdResult<()> {
    mailboat_core::actions::change_labels(
        &state.db,
        |account| state.gmail_for(account),
        &thread_ids,
        &add,
        &remove,
    )
    .await?;
    Ok(())
}

/// Downloads an attachment (once) with its account's credentials, marked
/// as downloaded from the internet, and returns where it is.
async fn downloaded(
    state: &AppState,
    attachment_id: AttachmentId,
) -> CmdResult<std::path::PathBuf> {
    let account = store::attachment_ref(&state.db.conn(), attachment_id)?.account;
    let gmail = state.gmail_for(account)?.interactive();
    let path =
        attachments::download(&state.db, &gmail, attachment_id, &state.attachments_dir).await?;
    files::quarantine(&path);
    Ok(path)
}

/// Opens an attachment with its default app.
#[tauri::command]
#[specta::specta]
pub async fn attachment_open(
    state: State<'_, AppState>,
    attachment_id: AttachmentId,
) -> CmdResult<()> {
    let path = downloaded(&state, attachment_id).await?;
    Ok(files::open(&path)?)
}

/// Shows an attachment in Quick Look (macOS).
#[tauri::command]
#[specta::specta]
pub async fn attachment_preview(
    state: State<'_, AppState>,
    attachment_id: AttachmentId,
) -> CmdResult<()> {
    let path = downloaded(&state, attachment_id).await?;
    Ok(files::quick_look(&path)?)
}

/// Saves a copy of an attachment to Downloads ("name (1).pdf" if the name
/// is taken) and returns the file name it got.
#[tauri::command]
#[specta::specta]
pub async fn attachment_save(
    state: State<'_, AppState>,
    attachment_id: AttachmentId,
) -> CmdResult<String> {
    let downloads = state
        .downloads_dir
        .clone()
        .ok_or_else(|| CoreError::Config("couldn't find the Downloads folder".into()))?;
    let cached = downloaded(&state, attachment_id).await?;
    let filename = store::attachment_ref(&state.db.conn(), attachment_id)?.filename;
    let target = attachments::unique_path(&downloads, &filename);
    std::fs::copy(&cached, &target)
        .map_err(|e| CoreError::Other(format!("could not save to Downloads: {e}")))?;
    files::quarantine(&target);
    let name = target
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or(filename);
    state.saved.lock().unwrap().insert(attachment_id, target);
    Ok(name)
}

/// Shows a saved attachment in Finder.
#[tauri::command]
#[specta::specta]
pub fn attachment_reveal(state: State<'_, AppState>, attachment_id: AttachmentId) -> CmdResult<()> {
    let saved = state.saved.lock().unwrap().get(&attachment_id).cloned();
    let path = saved.ok_or_else(|| CoreError::NotFound("that attachment wasn't saved".into()))?;
    Ok(files::reveal(&path)?)
}

/// Remembers to load (`allow`) or block remote images from this sender, in
/// every account. Spam stays blocked regardless.
#[tauri::command]
#[specta::specta]
pub fn sender_allow_images(
    state: State<'_, AppState>,
    sender_email: String,
    allow: bool,
) -> CmdResult<()> {
    Ok(store::set_sender_allows_images(
        &state.db.conn(),
        &sender_email,
        allow,
    )?)
}

/// Every address mail can be sent from: each account and its Gmail "Send
/// mail as" aliases (read by sync; `IdentitiesChangedEvent` says when).
#[tauri::command]
#[specta::specta]
pub fn identities_list(state: State<'_, AppState>) -> CmdResult<Vec<Identity>> {
    Ok(identities::list(&state.db.conn())?)
}

/// Everyone compose can suggest in To/Cc/Bcc, best first, from cached
/// mail of every account. The UI filters it as you type.
#[tauri::command]
#[specta::specta]
pub fn contacts_list(state: State<'_, AppState>) -> CmdResult<Vec<Contact>> {
    Ok(compose::contacts::all(&state.db.conn())?)
}

/// What a reply or forward needs from a message (people, subject, text),
/// fetched with its own account's credentials if not cached.
#[tauri::command]
#[specta::specta]
pub async fn reply_source(
    state: State<'_, AppState>,
    message_id: MessageId,
) -> CmdResult<ReplySource> {
    let (account, _) = store::message_gmail_ref(&state.db.conn(), message_id)?;
    let gmail = state.gmail_for(account)?.interactive();
    Ok(compose::reply_source(&state.db, &gmail, message_id).await?)
}

/// Sends a message with the From account's Gmail and returns the
/// conversation it's in (already cached, so it shows at once).
#[tauri::command]
#[specta::specta]
pub async fn message_send(
    app: AppHandle,
    state: State<'_, AppState>,
    message: OutgoingMessage,
) -> CmdResult<Option<ThreadId>> {
    let gmail = state.gmail_for(message.account_id)?.interactive();
    let files = compose::forwarded_files(
        &state.db,
        |account| Ok(state.gmail_for(account)?.interactive()),
        &message.forwarded,
        &state.attachments_dir,
    )
    .await?;
    let thread = compose::send_with_files(&state.db, &gmail, &message, &files).await?;
    // Sent: its saved draft goes. If that fails the mail is still sent;
    // the leftover draft is logged and shows in Drafts to delete by hand.
    if let Some(draft) = message.draft {
        if let Err(e) =
            compose::delete_draft(&state.db, &|account| state.gmail_for(account), draft).await
        {
            state.sync_log.write(
                message.account_id,
                &format!("sent, but its draft wasn't deleted ({}): {e}", e.kind()),
            );
        }
    }
    let _ = MailChangedEvent {
        account_id: message.account_id,
    }
    .emit(&app);
    Ok(thread)
}

/// Saves a message being written as a Gmail draft (creating it the first
/// time, replacing it after) and returns its local draft ID.
#[tauri::command]
#[specta::specta]
pub async fn draft_save(
    app: AppHandle,
    state: State<'_, AppState>,
    draft: Option<DraftId>,
    message: OutgoingMessage,
) -> CmdResult<DraftId> {
    let files = compose::forwarded_files(
        &state.db,
        |account| state.gmail_for(account),
        &message.forwarded,
        &state.attachments_dir,
    )
    .await?;
    let id = compose::save_draft_with_files(
        &state.db,
        |account| state.gmail_for(account),
        draft,
        &message,
        &files,
    )
    .await?;
    // The saved draft is cached already: lists (Drafts) refresh now.
    let _ = MailChangedEvent {
        account_id: message.account_id,
    }
    .emit(&app);
    Ok(id)
}

/// Deletes a saved draft (discarded), from Gmail too.
#[tauri::command]
#[specta::specta]
pub async fn draft_delete(state: State<'_, AppState>, draft: DraftId) -> CmdResult<()> {
    Ok(compose::delete_draft(&state.db, &|account| state.gmail_for(account), draft).await?)
}

/// Opens a draft shown in a conversation for editing (made here or in
/// Gmail elsewhere), with its own account's credentials.
#[tauri::command]
#[specta::specta]
pub async fn draft_open(
    state: State<'_, AppState>,
    message_id: MessageId,
) -> CmdResult<OpenedDraft> {
    let (account, _) = store::message_gmail_ref(&state.db.conn(), message_id)?;
    let gmail = state.gmail_for(account)?.interactive();
    Ok(compose::open_draft(&state.db, &gmail, message_id).await?)
}

/// Discards a draft shown in a conversation: deleted from Gmail and the
/// cache, and lists refresh.
#[tauri::command]
#[specta::specta]
pub async fn draft_discard(
    app: AppHandle,
    state: State<'_, AppState>,
    message_id: MessageId,
) -> CmdResult<()> {
    let (account, _) = store::message_gmail_ref(&state.db.conn(), message_id)?;
    let gmail = state.gmail_for(account)?.interactive();
    compose::discard_draft_message(&state.db, &gmail, message_id).await?;
    let _ = MailChangedEvent {
        account_id: account,
    }
    .emit(&app);
    Ok(())
}

/// Mail HTML (a signature, a quote) prepared for showing in the app the
/// way the reader shows email: sanitized, and "adaptive" where possible,
/// so it sits on the glass with colours adjusted for dark mode instead of
/// on a white card.
#[tauri::command]
#[specta::specta]
pub fn html_preview(html: String) -> SafeMessage {
    mail::sanitize::sanitize_html(&html, true)
}

/// Opens a link from the message being written in the default browser
/// (or mail app). Only web and mail links; anything else is refused.
#[tauri::command]
#[specta::specta]
pub fn link_open(url: String) -> CmdResult<()> {
    let lower = url.to_ascii_lowercase();
    if !["http://", "https://", "mailto:"]
        .iter()
        .any(|p| lower.starts_with(p))
    {
        return Err(CoreError::Invalid(format!("not a web or mail link: {url}")).into());
    }
    open::that_detached(&url)
        .map_err(|e| CoreError::Other(format!("could not open the link: {e}")))?;
    Ok(())
}

/// Wakes sync workers now. `None` means every account.
#[tauri::command]
#[specta::specta]
pub fn sync_now(state: State<'_, AppState>, account_ids: Option<Vec<AccountId>>) {
    state.supervisor.sync_now(account_ids.as_deref());
}

#[tauri::command]
#[specta::specta]
pub fn sync_status_list(state: State<'_, AppState>) -> CmdResult<Vec<AccountSyncState>> {
    Ok(store::sync_states(&state.db.conn())?)
}
