//! Commands the UI can call. Each is a thin wrapper over `mailboat_core`;
//! logic and tests live there.

use std::sync::Arc;
use std::time::Duration;

use mailboat_core::auth::{config, oauth, tokens, AccountTokens};
use mailboat_core::db::{accounts, query, store};
use mailboat_core::mail::images::{self, ImagePolicy};
use mailboat_core::mail::{self, SafeMessage};
use mailboat_core::model::{
    Account, AccountFilter, AccountId, AccountSyncState, Label, LabelUnread, ListQuery, MailView,
    MessageId, ThreadDetail, ThreadId, ThreadPage,
};
use mailboat_core::sync::{fetch_body, load_older, OLDER_BATCH};
use mailboat_core::CoreError;
use serde::Serialize;
use specta::Type;
use tauri::{AppHandle, State};
use tauri_specta::Event;

use crate::error::CmdResult;
use crate::events::MailChangedEvent;
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
    Ok(OpenedMessage {
        message_id,
        sender_email,
        images_allowed,
        image_policy,
        content: mail::safe_message(&body, images_allowed),
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
