//! Commands the UI can call. Each is a thin wrapper over `mail_core`;
//! logic and tests live there.

use std::sync::Arc;
use std::time::Duration;

use mail_core::attachments;
use mail_core::auth::{config, oauth, tokens, AccountTokens};
use mail_core::brand;
use mail_core::calendar::{self, InviteCard};
use mail_core::compose::contacts::Contact;
use mail_core::compose::identities::{self, Identity};
use mail_core::compose::{self, OpenedDraft, OutgoingMessage, ReplySource};
use mail_core::db::{accounts, query, store};
use mail_core::mail::images::{self, ImagePolicy};
use mail_core::mail::invite::Answer;
use mail_core::mail::mailto::Mailto;
use mail_core::mail::{self, prefetch, SafeMessage};
use mail_core::model::{
    Account, AccountFilter, AccountId, AccountSyncState, Attachment, AttachmentId, DraftId, Label,
    LabelId, LabelUnread, ListQuery, MailView, MessageId, ThreadDetail, ThreadId, ThreadPage,
};
use mail_core::rules::{
    self, AccountRules, MatchCount, RuleActions, RuleCriteria, RulesState, SavedRule,
};
use mail_core::settings::{self, AppSettings};
use mail_core::sync::{fetch_body, load_older, OLDER_BATCH};
use mail_core::vacation::{self, AccountVacation, VacationSettings, VacationState};
use mail_core::CoreError;
use serde::Serialize;
use specta::Type;
use tauri::{AppHandle, State};
use tauri_specta::Event;

use crate::error::{AppError, CmdResult};
use crate::events::{IdentitiesChangedEvent, MailChangedEvent};
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
    /// The Google Cloud project of the client in use, when its file says.
    pub project_id: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub fn oauth_setup(state: State<'_, AppState>) -> OAuthSetup {
    let result = state.oauth_config();
    OAuthSetup {
        project_id: result.as_ref().ok().and_then(|c| c.project_id.clone()),
        configured: result.is_ok(),
        client_file_path: config::client_file_path(&state.config_dir)
            .display()
            .to_string(),
        problem: result.err().map(|e| e.to_string()),
    }
}

/// Checks a Google client file given during setup (dropped, chosen, or
/// built from a pasted ID and secret) and saves it as the app's client.
/// Says plainly what's wrong with any other file.
#[tauri::command]
#[specta::specta]
pub fn oauth_client_save(
    state: State<'_, AppState>,
    text: String,
) -> CmdResult<config::CheckedClient> {
    Ok(config::save(&state.config_dir, &text)?)
}

/// Looks in Downloads for the client file Google's console just
/// downloaded (in the last hour) and saves it if found. Asked for only
/// when the user chooses "Watch my Downloads" (macOS asks once to allow
/// it).
#[tauri::command]
#[specta::specta]
pub fn oauth_client_from_downloads(
    app: AppHandle,
    state: State<'_, AppState>,
) -> CmdResult<Option<config::CheckedClient>> {
    use tauri::Manager;
    let Ok(dir) = app.path().download_dir() else {
        return Ok(None);
    };
    let Some(path) = config::find_download(&dir, Duration::from_secs(60 * 60)) else {
        return Ok(None);
    };
    let text = config::read_download(&path)?;
    Ok(Some(config::save(&state.config_dir, &text)?))
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
    if state.demo.is_some() {
        // Signing in again: the made-up Google just lets the account back in.
        let all = accounts::list(&state.db.conn())?;
        let known = all.iter().find(|a| Some(&a.email) == login_hint.as_ref());
        if let Some(account) = known {
            let session = state
                .demo_sessions
                .lock()
                .unwrap()
                .get(&account.id)
                .cloned();
            if let Some(session) = session {
                session.renew();
                state.supervisor.sync_now(Some(&[account.id]));
                return Ok(accounts::get(&state.db.conn(), account.id)?);
            }
        }
        return Err(CoreError::Invalid(
            "The demo has no Google connection, so it can't add accounts.".into(),
        )
        .into());
    }
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
    let hook = state.scope_hook(account.id);
    if let Some(scopes) = &signed_in.scopes {
        hook(scopes);
    }
    let account_tokens = Arc::new(
        AccountTokens::new(
            state.http.clone(),
            config,
            state.secrets.clone(),
            &signed_in.user.sub,
        )
        .with_scope_hook(hook),
    );
    account_tokens
        .seed(signed_in.access_token, signed_in.expires_in)
        .await;
    let _ = state.set_tokens(account.id, account_tokens);
    state.start_sync(account.id)?;
    // Re-read, with the permissions just recorded.
    Ok(accounts::get(&state.db.conn(), account.id)?)
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
    tokens::remove_account(&state.db, state.secrets.as_ref(), account_id)?;
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
    /// Accounts that couldn't load (no Gmail client, a network error…).
    /// The list waits for "Try again" after any, rather than asking again
    /// at once and failing the same way over and over.
    pub failed: u32,
}

/// Fetches conversations older than the cache for a view, from each
/// account in the filter at once (each has its own quota). Rows appear as
/// they arrive (`MailChangedEvent`). One account failing doesn't stop the
/// others; the error is only returned if every account failed, and
/// otherwise counted in `failed`.
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
    let mut panicked = 0;
    while let Some(joined) = tasks.join_next().await {
        let Ok((account, outcome)) = joined else {
            exhausted = false;
            panicked += 1;
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
                        state.sync_log.write(
                            account,
                            &format!("loading older mail failed: {}", e.for_log()),
                        );
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
    Ok(OlderLoaded {
        added,
        exhausted,
        failed: failures.len() as u32 + panicked,
    })
}

enum OlderCursorResult {
    Done(mail_core::sync::OlderCursor, mail_core::Result<usize>),
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
    /// The account it belongs to (e.g. to sign it in again).
    pub account_id: AccountId,
    pub sender_email: String,
    pub images_allowed: bool,
    /// Why images did or didn't load, so the reader can offer the opposite.
    pub image_policy: ImagePolicy,
    /// Files attached to the message (inline images left out).
    pub attachments: Vec<Attachment>,
    /// Shown with its original colors on the white card, because its
    /// sender was switched to "Original colors" (remembered by address).
    pub original_colors: bool,
    #[serde(flatten)]
    pub content: SafeMessage,
}

/// Returns a message ready for display, downloading its body with the
/// owning account's credentials if it isn't cached yet. An email whose
/// sender was switched to "Original colors" is shown on the white card
/// with its own colors instead of on the glass.
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
    let (image_policy, sender_email) = images::policy_for_message(&state.db.conn(), message_id)?;
    let images_allowed = image_policy.allows();
    let original_colors = store::sender_wants_original_colors(&state.db.conn(), &sender_email)?;
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
    // Images downloaded when the mail arrived show from their copies; once
    // opened, the rest load now, so there's nothing left to download.
    let cached = match (&body.html, images_allowed) {
        (Some(html), true) => {
            let urls = mail::sanitize::remote_image_urls(html);
            mail::prefetch::cached_for(&state.db.conn(), &state.images_dir, &urls)?
        }
        _ => Default::default(),
    };
    prefetch::mark_done(&state.db.conn(), message_id)?;
    let attachments = store::attachments_for(&state.db.conn(), message_id)?;
    Ok(OpenedMessage {
        message_id,
        account_id: account,
        sender_email,
        images_allowed,
        image_policy,
        attachments,
        original_colors,
        content: mail::safe_message(&body, images_allowed, &inline, &cached, original_colors),
    })
}

/// Copies text to the clipboard (a sign-in code, say).
#[tauri::command]
#[specta::specta]
pub fn text_copy(text: String) -> CmdResult<()> {
    Ok(crate::email_menu::copy_text(&text).map_err(CoreError::Other)?)
}

/// Remembers (or forgets) that a sender's emails open with their original
/// colors on the white card, for every account.
#[tauri::command]
#[specta::specta]
pub fn sender_original_colors(
    state: State<'_, AppState>,
    sender_email: String,
    original: bool,
) -> CmdResult<()> {
    Ok(store::set_sender_original_colors(
        &state.db.conn(),
        &sender_email,
        original,
    )?)
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
    mail_core::actions::set_read(
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
    mail_core::actions::set_archived(
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
    mail_core::actions::set_starred(
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
    mail_core::actions::set_trashed(
        &state.db,
        |account| state.gmail_for(account),
        &thread_ids,
        trashed,
    )
    .await?;
    Ok(())
}

/// Creates a user label in one account.
#[tauri::command]
#[specta::specta]
pub async fn label_create(
    app: AppHandle,
    state: State<'_, AppState>,
    account_id: AccountId,
    name: String,
) -> CmdResult<Label> {
    let gmail = state.gmail_for(account_id)?.interactive();
    let label = mail_core::labels::create(&state.db, &gmail, account_id, &name).await?;
    let _ = MailChangedEvent { account_id }.emit(&app);
    Ok(label)
}

/// Renames a user label (and the labels nested under it).
#[tauri::command]
#[specta::specta]
pub async fn label_rename(
    app: AppHandle,
    state: State<'_, AppState>,
    label_id: LabelId,
    name: String,
) -> CmdResult<()> {
    let (account, _, _) = store::label_ref(&state.db.conn(), label_id)?;
    mail_core::labels::rename(
        &state.db,
        |a| Ok(state.gmail_for(a)?.interactive()),
        label_id,
        &name,
    )
    .await?;
    let _ = MailChangedEvent {
        account_id: account,
    }
    .emit(&app);
    Ok(())
}

/// Deletes a user label; its conversations stay.
#[tauri::command]
#[specta::specta]
pub async fn label_delete(
    app: AppHandle,
    state: State<'_, AppState>,
    label_id: LabelId,
) -> CmdResult<()> {
    let (account, _, _) = store::label_ref(&state.db.conn(), label_id)?;
    mail_core::labels::delete(
        &state.db,
        |a| Ok(state.gmail_for(a)?.interactive()),
        label_id,
    )
    .await?;
    let _ = MailChangedEvent {
        account_id: account,
    }
    .emit(&app);
    Ok(())
}

/// Reports threads as spam or not spam. Routed per account like
/// `threads_set_read`.
#[tauri::command]
#[specta::specta]
pub async fn threads_set_spam(
    state: State<'_, AppState>,
    thread_ids: Vec<ThreadId>,
    spam: bool,
) -> CmdResult<()> {
    mail_core::actions::set_spam(
        &state.db,
        |account| state.gmail_for(account),
        &thread_ids,
        spam,
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
    mail_core::actions::change_labels(
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

/// Saves an image from an email (its right-click menu) to Downloads
/// ("logo (1).png" if the name is taken) and returns the file name it got.
/// `src` is the image's address as the email shows it: a `data:` URL or a
/// web address (fetched again; it has already loaded on screen).
#[tauri::command]
#[specta::specta]
pub async fn email_image_save(state: State<'_, AppState>, src: String) -> CmdResult<String> {
    let downloads = state
        .downloads_dir
        .clone()
        .ok_or_else(|| CoreError::Config("couldn't find the Downloads folder".into()))?;
    let image = mail_core::mail::saved_image::load(&state.http, &src).await?;
    let target = attachments::unique_path(&downloads, &image.filename);
    std::fs::write(&target, &image.bytes)
        .map_err(|e| CoreError::Other(format!("could not save to Downloads: {e}")))?;
    files::quarantine(&target);
    Ok(target
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or(image.filename))
}

/// The raw email as it arrived ("Show original"), fetched with its
/// account's credentials. Never cached or logged.
async fn raw_message(state: &AppState, message_id: MessageId) -> CmdResult<Vec<u8>> {
    let (account, gmail_id) = store::message_gmail_ref(&state.db.conn(), message_id)?;
    let gmail = state.gmail_for(account)?.interactive();
    Ok(gmail.message_raw(&gmail_id).await?)
}

/// An email's original: its source and a summary of its headers.
#[tauri::command]
#[specta::specta]
pub async fn message_original(
    state: State<'_, AppState>,
    message_id: MessageId,
) -> CmdResult<mail::original::Original> {
    Ok(mail::original::read(
        &raw_message(&state, message_id).await?,
    ))
}

/// Saves an email's original to Downloads as an `.eml` file named after
/// its subject, and returns the file name it got.
#[tauri::command]
#[specta::specta]
pub async fn message_original_save(
    state: State<'_, AppState>,
    message_id: MessageId,
) -> CmdResult<String> {
    let downloads = state
        .downloads_dir
        .clone()
        .ok_or_else(|| CoreError::Config("couldn't find the Downloads folder".into()))?;
    let raw = raw_message(&state, message_id).await?;
    let subject = mail::original::read(&raw).subject;
    let filename = attachments::safe_filename(&mail::original::file_name(subject.as_deref()));
    let target = attachments::unique_path(&downloads, &filename);
    std::fs::write(&target, &raw)
        .map_err(|e| CoreError::Other(format!("could not save to Downloads: {e}")))?;
    files::quarantine(&target);
    Ok(target
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or(filename))
}

/// Shows a file saved to Downloads (by `email_image_save`) in Finder.
#[tauri::command]
#[specta::specta]
pub fn download_reveal(state: State<'_, AppState>, file_name: String) -> CmdResult<()> {
    let downloads = state
        .downloads_dir
        .clone()
        .ok_or_else(|| CoreError::Config("couldn't find the Downloads folder".into()))?;
    // Only a name in Downloads, never a path elsewhere.
    let path = downloads.join(attachments::safe_filename(&file_name));
    Ok(files::reveal(&path)?)
}

/// Puts an image from an email on the clipboard.
#[tauri::command]
#[specta::specta]
pub async fn email_image_copy(state: State<'_, AppState>, src: String) -> CmdResult<()> {
    let image = mail_core::mail::saved_image::load(&state.http, &src).await?;
    Ok(crate::email_menu::copy_image(&image.bytes).map_err(CoreError::Other)?)
}

/// Opens a link from an email (its `email-link:` address, as the email
/// shows it), as clicking it would.
#[tauri::command]
#[specta::specta]
pub fn email_link_open(app: AppHandle, link: String) -> CmdResult<()> {
    let url = mail_core::mail::links::unwrap(&link)
        .ok_or_else(|| CoreError::Invalid(format!("not a link {} can open", brand::NAME)))?;
    crate::links::open(&app, &url)
        .map_err(|e| CoreError::Other(format!("could not open the link: {e}")))?;
    Ok(())
}

/// Puts the real address of a link from an email on the clipboard.
#[tauri::command]
#[specta::specta]
pub fn email_link_copy(link: String) -> CmdResult<()> {
    let url = mail_core::mail::links::unwrap(&link)
        .ok_or_else(|| CoreError::Invalid(format!("not a link {} can copy", brand::NAME)))?;
    Ok(crate::email_menu::copy_text(&url).map_err(CoreError::Other)?)
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
    let files = compose::carried_parts(
        &state.db,
        |account| Ok(state.gmail_for(account)?.interactive()),
        &message,
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
                &format!(
                    "sent, but its draft wasn't deleted ({}): {}",
                    e.kind(),
                    e.for_log()
                ),
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
    let files = compose::carried_parts(
        &state.db,
        |account| state.gmail_for(account),
        &message,
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

/// Deletes a saved draft (discarded), from Gmail too, and lists refresh
/// (it leaves its conversation and Drafts at once).
#[tauri::command]
#[specta::specta]
pub async fn draft_delete(
    app: AppHandle,
    state: State<'_, AppState>,
    draft: DraftId,
) -> CmdResult<()> {
    let account =
        compose::delete_draft(&state.db, &|account| state.gmail_for(account), draft).await?;
    if let Some(account_id) = account {
        let _ = MailChangedEvent { account_id }.emit(&app);
    }
    Ok(())
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

/// About the app, for Settings: its version and the colours an account can
/// be marked with.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub account_colors: Vec<String>,
    /// The app icons Settings offers, by name (see `app_icon`).
    pub icon_choices: Vec<String>,
}

#[tauri::command]
#[specta::specta]
pub fn app_info() -> AppInfo {
    AppInfo {
        version: mail_core::brand::VERSION.to_string(),
        account_colors: accounts::ACCOUNT_COLORS
            .iter()
            .map(|c| (*c).to_string())
            .collect(),
        icon_choices: crate::app_icon::names(),
    }
}

#[tauri::command]
#[specta::specta]
pub fn settings_get(state: State<'_, AppState>) -> CmdResult<AppSettings> {
    Ok(settings::load(&state.db.conn())?)
}

#[tauri::command]
#[specta::specta]
pub fn settings_set(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: AppSettings,
) -> CmdResult<()> {
    settings::save(&state.db.conn(), &settings)?;
    // A smaller image cache takes effect now, not at the next download.
    prefetch::evict(
        &state.db.conn(),
        &state.images_dir,
        u64::from(settings.image_cache_mb) * 1024 * 1024,
    )?;
    crate::theme::apply(&app, settings.theme);
    crate::dock::set_icon(&app, crate::app_icon::png(settings.app_icon.as_deref()));
    Ok(())
}

/// What the settings would be with every one back at its default (AI
/// connections kept); the window saves them with `settings_set`.
#[tauri::command]
#[specta::specta]
pub fn settings_defaults(state: State<'_, AppState>) -> CmdResult<AppSettings> {
    let current = settings::load(&state.db.conn())?;
    Ok(settings::defaults_from(&current))
}

/// Marks an account's rows with another colour from `AppInfo::account_colors`.
#[tauri::command]
#[specta::specta]
pub fn account_set_color(
    state: State<'_, AppState>,
    account_id: AccountId,
    color: String,
) -> CmdResult<Account> {
    Ok(accounts::set_color(&state.db.conn(), account_id, &color)?)
}

/// Opens the app's page in System Settings → Notifications, where macOS
/// keeps whether notifications may show and in what style.
#[tauri::command]
#[specta::specta]
pub fn notification_settings_open(app: AppHandle) -> CmdResult<()> {
    let id = &app.config().identifier;
    open::that_detached(format!(
        "x-apple.systempreferences:com.apple.Notifications-Settings.extension?id={id}"
    ))
    .map_err(|e| CoreError::Other(format!("could not open System Settings: {e}")))?;
    Ok(())
}

/// The meeting invitation in a message, if any, with what Google Calendar
/// says about it (your answer, clashes). Calendar problems are part of
/// the card, not an error.
#[tauri::command]
#[specta::specta]
pub async fn invite_card(
    state: State<'_, AppState>,
    message_id: MessageId,
) -> CmdResult<Option<InviteCard>> {
    let (account, _) = store::message_gmail_ref(&state.db.conn(), message_id)?;
    let gmail = state.gmail_for(account)?.interactive();
    Ok(calendar::card_for(&state.db, &gmail, message_id).await?)
}

/// Yes / No / Maybe on a message's invitation, with the owning account's
/// sign-in. Google Calendar then tells the organizer.
#[tauri::command]
#[specta::specta]
pub async fn invite_answer(
    state: State<'_, AppState>,
    message_id: MessageId,
    answer: Answer,
) -> CmdResult<InviteCard> {
    let (account, _) = store::message_gmail_ref(&state.db.conn(), message_id)?;
    let gmail = state.gmail_for(account)?.interactive();
    Ok(calendar::answer(&state.db, &gmail, message_id, answer).await?)
}

/// Removes a cancelled invitation's event from the account's calendar.
#[tauri::command]
#[specta::specta]
pub async fn invite_remove(
    state: State<'_, AppState>,
    message_id: MessageId,
) -> CmdResult<InviteCard> {
    let (account, _) = store::message_gmail_ref(&state.db.conn(), message_id)?;
    let gmail = state.gmail_for(account)?.interactive();
    Ok(calendar::remove(&state.db, &gmail, message_id).await?)
}

/// Every account's rules (Gmail filters), or why an account's can't be
/// shown. Accounts are asked one after another; one failing doesn't stop
/// the others.
#[tauri::command]
#[specta::specta]
pub async fn rules_list(state: State<'_, AppState>) -> CmdResult<Vec<AccountRules>> {
    let accounts = accounts::list(&state.db.conn())?;
    let mut out = Vec::new();
    for account in accounts {
        let listed = match state.gmail_for(account.id) {
            Ok(gmail) => rules::list(&state.db, &gmail.interactive(), account.id).await,
            Err(e) => Err(e),
        };
        out.push(listed.unwrap_or_else(|e| AccountRules {
            account_id: account.id,
            state: RulesState::Unavailable {
                message: e.to_string(),
            },
        }));
    }
    Ok(out)
}

/// Creates a rule in one account. Applying it to existing mail changes
/// labels in Gmail, so that account syncs straight after.
#[tauri::command]
#[specta::specta]
pub async fn rule_create(
    state: State<'_, AppState>,
    account_id: AccountId,
    criteria: RuleCriteria,
    actions: RuleActions,
    apply_to_existing: bool,
) -> CmdResult<SavedRule> {
    let gmail = state.gmail_for(account_id)?.interactive();
    let saved = rules::create(
        &state.db,
        &gmail,
        account_id,
        &criteria,
        &actions,
        apply_to_existing,
    )
    .await?;
    if saved.applied.is_some_and(|a| a.messages > 0) {
        state.supervisor.sync_now(Some(&[account_id]));
    }
    Ok(saved)
}

/// Replaces a rule with an edited version (Gmail can't edit in place).
#[tauri::command]
#[specta::specta]
pub async fn rule_update(
    state: State<'_, AppState>,
    account_id: AccountId,
    filter_id: String,
    criteria: RuleCriteria,
    actions: RuleActions,
    apply_to_existing: bool,
) -> CmdResult<SavedRule> {
    let gmail = state.gmail_for(account_id)?.interactive();
    let saved = rules::update(
        &state.db,
        &gmail,
        account_id,
        &filter_id,
        &criteria,
        &actions,
        apply_to_existing,
    )
    .await?;
    if saved.applied.is_some_and(|a| a.messages > 0) {
        state.supervisor.sync_now(Some(&[account_id]));
    }
    Ok(saved)
}

/// Deletes a rule; mail it already sorted stays as it is.
#[tauri::command]
#[specta::specta]
pub async fn rule_delete(
    state: State<'_, AppState>,
    account_id: AccountId,
    filter_id: String,
) -> CmdResult<()> {
    let gmail = state.gmail_for(account_id)?.interactive();
    rules::delete(&gmail, &filter_id).await?;
    Ok(())
}

/// How many conversations in the account match a rule's criteria now
/// (`None` until something is filled in).
#[tauri::command]
#[specta::specta]
pub async fn rule_match_count(
    state: State<'_, AppState>,
    account_id: AccountId,
    criteria: RuleCriteria,
) -> CmdResult<Option<MatchCount>> {
    let gmail = state.gmail_for(account_id)?.interactive();
    Ok(rules::match_count(&gmail, &criteria).await?)
}

/// Changes one of an account's addresses' signature in Gmail ("" removes
/// it). Compose picks the new one up straight away.
#[tauri::command]
#[specta::specta]
pub async fn signature_set(
    app: AppHandle,
    state: State<'_, AppState>,
    account_id: AccountId,
    email: String,
    html: String,
) -> CmdResult<Option<String>> {
    let gmail = state.gmail_for(account_id)?.interactive();
    let kept = identities::set_signature(&state.db, &gmail, account_id, &email, &html).await?;
    let _ = IdentitiesChangedEvent { account_id }.emit(&app);
    Ok(kept)
}

/// Every account's vacation responder, or why an account's can't be shown.
#[tauri::command]
#[specta::specta]
pub async fn vacation_list(state: State<'_, AppState>) -> CmdResult<Vec<AccountVacation>> {
    let accounts = accounts::list(&state.db.conn())?;
    let mut out = Vec::new();
    for account in accounts {
        let got = match state.gmail_for(account.id) {
            Ok(gmail) => vacation::get(&state.db, &gmail.interactive(), account.id).await,
            Err(e) => Err(e),
        };
        out.push(got.unwrap_or_else(|e| AccountVacation {
            account_id: account.id,
            state: VacationState::Unavailable {
                message: e.to_string(),
            },
        }));
    }
    Ok(out)
}

/// Saves an account's vacation responder.
#[tauri::command]
#[specta::specta]
pub async fn vacation_set(
    state: State<'_, AppState>,
    account_id: AccountId,
    settings: VacationSettings,
) -> CmdResult<AccountVacation> {
    let gmail = state.gmail_for(account_id)?.interactive();
    Ok(vacation::set(&state.db, &gmail, account_id, &settings).await?)
}

/// `mailto:` links waiting to become new messages (see `mail_handler`).
#[tauri::command]
#[specta::specta]
pub fn mailto_take(queue: State<'_, crate::mail_handler::MailtoQueue>) -> Vec<Mailto> {
    queue.take()
}

/// Which app opens `mailto:` links (Settings → General).
#[tauri::command]
#[specta::specta]
pub fn mail_app_default() -> crate::mail_handler::DefaultMailApp {
    crate::mail_handler::default_app()
}

/// Asks macOS to make this copy of the app the default email reader; macOS
/// asks the user to confirm.
#[tauri::command]
#[specta::specta]
pub async fn mail_app_make_default(app: tauri::AppHandle) -> CmdResult<()> {
    crate::mail_handler::make_default(&app)
        .await
        .map_err(|message| AppError {
            kind: "platform".into(),
            message,
        })
}

/// Puts the window's commands in the menu bar (see `menu.rs`).
#[tauri::command]
#[specta::specta]
pub fn menu_bar_set(app: AppHandle, menus: Vec<crate::menu::MenuSpec>) -> CmdResult<()> {
    crate::menu::set(&app, &menus).map_err(|e| AppError {
        kind: "platform".into(),
        message: e.to_string(),
    })
}

/// New names and on/off states for the menu bar's commands.
#[tauri::command]
#[specta::specta]
pub fn menu_bar_update(app: AppHandle, items: Vec<crate::menu::MenuItemState>) -> CmdResult<()> {
    crate::menu::update(&app, &items).map_err(|e| AppError {
        kind: "platform".into(),
        message: e.to_string(),
    })
}

/// How much the downloaded-images cache holds (Settings → Viewing).
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ImageCacheSize {
    /// Whole kilobytes (a float would reach TypeScript as `number | null`).
    pub kilobytes: u32,
    pub images: u32,
}

#[tauri::command]
#[specta::specta]
pub fn image_cache_size(state: State<'_, AppState>) -> CmdResult<ImageCacheSize> {
    let (bytes, images) = prefetch::size(&state.db.conn())?;
    Ok(ImageCacheSize {
        kilobytes: u32::try_from(bytes / 1024).unwrap_or(u32::MAX),
        images,
    })
}

/// What the app keeps on this Mac, for Settings → Advanced.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CacheSize {
    /// The database: cached mail, its search index, and settings. Whole
    /// kilobytes, as `ImageCacheSize`.
    pub mail_kilobytes: u32,
    /// Opened attachments and downloaded images.
    pub files_kilobytes: u32,
}

#[tauri::command]
#[specta::specta]
pub fn cache_size(state: State<'_, AppState>) -> CmdResult<CacheSize> {
    let db_bytes: i64 = state
        .db
        .conn()
        .query_row(
            "SELECT page_count * page_size FROM pragma_page_count(), pragma_page_size()",
            [],
            |r| r.get(0),
        )
        .map_err(CoreError::from)?;
    let files = files::dir_size(&state.attachments_dir) + files::dir_size(&state.images_dir);
    let kb = |bytes: u64| u32::try_from(bytes / 1024).unwrap_or(u32::MAX);
    Ok(CacheSize {
        mail_kilobytes: kb(db_bytes.max(0) as u64),
        files_kilobytes: kb(files),
    })
}

/// Forgets all cached mail and downloaded files, then syncs every account
/// again from scratch, as when it was added. Accounts, settings, rules and
/// per-sender choices stay; nothing changes in Gmail.
#[tauri::command]
#[specta::specta]
pub async fn cache_clear(app: AppHandle, state: State<'_, AppState>) -> CmdResult<()> {
    let all = accounts::list(&state.db.conn())?;
    for account in &all {
        // A sync in flight mustn't write into what's being cleared.
        state.supervisor.stop_and_wait(account.id).await;
        state.forget_account(account.id);
        store::clear_mail(&mut state.db.conn(), account.id)?;
    }
    prefetch::clear(&state.db.conn(), &state.images_dir)?;
    // Hand the freed space back to the disk.
    state
        .db
        .conn()
        .execute_batch("VACUUM")
        .map_err(CoreError::from)?;
    state.resume_all_accounts()?;
    for account in &all {
        let _ = MailChangedEvent {
            account_id: account.id,
        }
        .emit(&app);
    }
    Ok(())
}

/// Empties Spam into Trash for the accounts in the view (all, or some),
/// each with its own credentials; see `actions::empty_spam`.
#[tauri::command]
#[specta::specta]
pub async fn spam_empty(
    app: AppHandle,
    state: State<'_, AppState>,
    accounts: AccountFilter,
) -> CmdResult<mail_core::actions::EmptiedSpam> {
    let ids: Vec<AccountId> = match accounts {
        AccountFilter::All => accounts::list(&state.db.conn())?
            .into_iter()
            .map(|a| a.id)
            .collect(),
        AccountFilter::Only(ids) => ids,
    };
    let done =
        mail_core::actions::empty_spam(&state.db, |account| state.gmail_for(account), &ids).await?;
    for account_id in ids {
        let _ = MailChangedEvent { account_id }.emit(&app);
    }
    Ok(done)
}

/// Shows the sync log in Finder.
#[tauri::command]
#[specta::specta]
pub fn sync_log_reveal(state: State<'_, AppState>) -> CmdResult<()> {
    Ok(files::reveal(state.sync_log.path())?)
}

/// Deletes every downloaded image; emails load theirs live until new mail
/// fills the cache again.
#[tauri::command]
#[specta::specta]
pub fn image_cache_clear(state: State<'_, AppState>) -> CmdResult<()> {
    Ok(prefetch::clear(&state.db.conn(), &state.images_dir)?)
}
