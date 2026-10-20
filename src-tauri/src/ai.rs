//! AI commands and the background queue that writes the list's one-line
//! summaries. The logic lives in `mailboat_core::ai`; this is the glue:
//! which provider each feature uses (Settings → AI), signing in to Claude
//! and ChatGPT, streaming answers to the window, and cancelling.

use std::collections::{HashMap, HashSet, VecDeque};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use mailboat_core::ai::codex::CodexModel;
use mailboat_core::ai::summaries::{self, Summary, SummaryKind};
use mailboat_core::ai::tasks::{self, Summarized, SummaryRequest, WriteAnswer, WriteRequest};
use mailboat_core::ai::usage::{self, ProviderUsage};
use mailboat_core::ai::{
    self, AiProvider, Answer, PlanLimit, Programs, ProviderState, ProviderStatus,
};
use mailboat_core::db::store;
use mailboat_core::model::ThreadId;
use mailboat_core::settings::{self, AppSettings};
use mailboat_core::CoreError;
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Manager, State};
use tauri_specta::Event;

use crate::error::{AppError, CmdResult};
use crate::state::AppState;

/// Part of an answer as it's written: the whole text so far.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct AiTextEvent {
    pub request_id: u32,
    pub text: String,
}

/// A conversation's one-line summary for the list is ready.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct AiLineSummaryEvent(pub Summary);

pub struct AiState {
    /// `mailboat-ai`, next to the app's binary (Tauri puts sidecars there).
    helper: Option<PathBuf>,
    programs: Mutex<Programs>,
    /// Requests that can be cancelled, by the window's request ID.
    jobs: Mutex<HashMap<u32, tauri::async_runtime::JoinHandle<()>>>,
    /// Signalled by `ai_connect_cancel` to stop waiting for a sign-in.
    connect_cancel: tokio::sync::Notify,
    /// Claude's subscription limits, as of its latest answer.
    limits: Mutex<Vec<PlanLimit>>,
    /// Codex's model catalog, read once (`codex debug models`).
    codex_catalog: Mutex<Option<Vec<CodexModel>>>,
    queue: LineQueue,
}

impl AiState {
    pub fn new() -> Self {
        let helper = std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(|d| d.join("mailboat-ai")));
        Self {
            programs: Mutex::new(Programs::find(helper.clone())),
            helper,
            jobs: Mutex::new(HashMap::new()),
            connect_cancel: tokio::sync::Notify::new(),
            limits: Mutex::new(Vec::new()),
            codex_catalog: Mutex::new(None),
            queue: LineQueue::default(),
        }
    }

    /// Looks for the programs again (one may have been installed since).
    fn refresh(&self) -> Programs {
        let found = Programs::find(self.helper.clone());
        *self.programs.lock().unwrap() = found.clone();
        found
    }

    /// The programs, with the Codex models to use: the catalog's fast one
    /// for quick requests, the owner's choice (Settings → AI) for writing.
    async fn programs_for(&self, saved: &AppSettings) -> Programs {
        let mut programs = self.programs.lock().unwrap().clone();
        let catalog = self.codex_catalog(&programs, false).await;
        programs.codex_models = ai::codex::Models {
            fast: ai::codex::fast_model(&catalog),
            writing: saved.ai.chatgpt_model.clone(),
        };
        programs
    }

    /// Codex's models, read once (or again when `fresh`). Empty if Codex
    /// isn't installed or can't say: it then uses its own default model.
    async fn codex_catalog(&self, programs: &Programs, fresh: bool) -> Vec<CodexModel> {
        let cached = self.codex_catalog.lock().unwrap().clone();
        if let (Some(list), false) = (cached, fresh) {
            return list;
        }
        let Some(codex) = programs.codex.clone() else {
            return Vec::new();
        };
        let list = ai::codex::models(&codex).await.unwrap_or_default();
        *self.codex_catalog.lock().unwrap() = Some(list.clone());
        list
    }

    fn note(&self, answer: &Answer) {
        if !answer.limits.is_empty() {
            *self.limits.lock().unwrap() = answer.limits.clone();
        }
    }
}

fn load_settings(state: &AppState) -> CmdResult<AppSettings> {
    let conn = state.db.conn();
    Ok(settings::load(&conn)?)
}

/// The provider is one the owner set up: Apple needs nothing; Claude and
/// ChatGPT must have been connected in Settings → AI.
fn check_usable(settings: &AppSettings, provider: AiProvider) -> CmdResult<()> {
    if provider == AiProvider::Apple || settings.ai.connected.contains(&provider) {
        return Ok(());
    }
    Err(AppError {
        kind: "ai".into(),
        message: format!(
            "Connect {} in Settings → AI first.",
            ai::display_name(provider)
        ),
    })
}

/// Runs `work` as a request the window can cancel by its ID.
async fn cancellable<T: Send + 'static>(
    ai: &AiState,
    request_id: u32,
    work: impl std::future::Future<Output = mailboat_core::Result<T>> + Send + 'static,
) -> CmdResult<T> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let handle = tauri::async_runtime::spawn(async move {
        let _ = tx.send(work.await);
    });
    ai.jobs.lock().unwrap().insert(request_id, handle);
    let result = rx.await;
    ai.jobs.lock().unwrap().remove(&request_id);
    match result {
        Ok(r) => Ok(r?),
        // Dropped without answering: cancelled.
        Err(_) => Err(CoreError::Cancelled.into()),
    }
}

/// Whether each provider can be used now.
#[tauri::command]
#[specta::specta]
pub async fn ai_status(ai: State<'_, AiState>) -> CmdResult<Vec<ProviderStatus>> {
    let programs = ai.refresh();
    let (apple, chatgpt, claude) = tokio::join!(
        ai::status(&programs, AiProvider::Apple),
        ai::status(&programs, AiProvider::ChatGpt),
        ai::status(&programs, AiProvider::Claude),
    );
    Ok(vec![apple, chatgpt, claude])
}

/// Connects Claude or ChatGPT: if its tool isn't signed in, starts its
/// sign-in (which opens the browser) and waits for it, then remembers the
/// provider as connected. Returns the settings with it added.
#[tauri::command]
#[specta::specta]
pub async fn ai_connect(
    state: State<'_, AppState>,
    ai: State<'_, AiState>,
    provider: AiProvider,
) -> CmdResult<AppSettings> {
    let programs = ai.refresh();
    let status = ai::status(&programs, provider).await;
    match status.state {
        ProviderState::Ready { .. } => {}
        ProviderState::NotInstalled => {
            return Err(AppError {
                kind: "ai_not_installed".into(),
                message: format!("{} isn't installed.", tool_name(provider)),
            })
        }
        ProviderState::Unavailable { reason } => {
            return Err(AppError {
                kind: "ai".into(),
                message: reason,
            })
        }
        ProviderState::SignedOut => sign_in(&ai, &programs, provider).await?,
    }
    let mut saved = load_settings(&state)?;
    if !saved.ai.connected.contains(&provider) && provider != AiProvider::Apple {
        saved.ai.connected.push(provider);
    }
    settings::save(&state.db.conn(), &saved)?;
    Ok(saved)
}

fn tool_name(provider: AiProvider) -> &'static str {
    match provider {
        AiProvider::Apple => "Apple Intelligence",
        AiProvider::Claude => "Claude Code",
        AiProvider::ChatGpt => "Codex",
    }
}

/// Starts the tool's own sign-in and waits until it says it's signed in
/// (or the sign-in ends, is cancelled, or 5 minutes pass).
async fn sign_in(ai: &AiState, programs: &Programs, provider: AiProvider) -> CmdResult<()> {
    let program = programs
        .path(provider)
        .cloned()
        .ok_or_else(|| AppError::from(CoreError::Ai("not installed".into())))?;
    let args = match provider {
        AiProvider::Claude => ai::claude::LOGIN_ARGS,
        AiProvider::ChatGpt => ai::codex::LOGIN_ARGS,
        AiProvider::Apple => return Ok(()),
    };
    let mut child = ai::process::spawn_login(&program, args)?;
    let deadline = Instant::now() + Duration::from_secs(300);
    loop {
        tokio::select! {
            _ = child.wait() => break,
            _ = ai.connect_cancel.notified() => return Err(CoreError::Cancelled.into()),
            _ = tokio::time::sleep(Duration::from_secs(2)) => {
                if matches!(ai::status(programs, provider).await.state, ProviderState::Ready { .. }) {
                    break;
                }
                if Instant::now() > deadline {
                    return Err(CoreError::Ai("Sign-in timed out.".into()).into());
                }
            }
        }
    }
    match ai::status(programs, provider).await.state {
        ProviderState::Ready { .. } => Ok(()),
        _ => Err(AppError {
            kind: "ai".into(),
            message: format!(
                "Sign-in didn't finish. You can also sign in from Terminal: {}",
                match provider {
                    AiProvider::Claude => "claude auth login",
                    _ => "codex login",
                }
            ),
        }),
    }
}

#[tauri::command]
#[specta::specta]
pub fn ai_connect_cancel(ai: State<'_, AiState>) {
    ai.connect_cancel.notify_waiters();
}

/// Stops using a provider in Mailboat. Its tool stays signed in (Claude Code
/// and Codex have other uses). Features that used it go back to Apple.
#[tauri::command]
#[specta::specta]
pub fn ai_disconnect(state: State<'_, AppState>, provider: AiProvider) -> CmdResult<AppSettings> {
    let mut saved = load_settings(&state)?;
    saved.ai.connected.retain(|p| *p != provider);
    let fallback = |p: AiProvider| if p == provider { AiProvider::Apple } else { p };
    saved.ai.list_summaries = saved.ai.list_summaries.map(fallback);
    saved.ai.reader_provider = fallback(saved.ai.reader_provider);
    saved.ai.writing_provider = fallback(saved.ai.writing_provider);
    settings::save(&state.db.conn(), &saved)?;
    Ok(saved)
}

/// The summary above an opened conversation, from the cache or written
/// now (streamed as `AiTextEvent`s). `automatic` is the reader asking by
/// itself: short conversations, Spam and Trash get none (`None`).
#[tauri::command]
#[specta::specta]
pub async fn ai_thread_summary(
    app: AppHandle,
    state: State<'_, AppState>,
    ai: State<'_, AiState>,
    thread_id: ThreadId,
    automatic: bool,
    fresh: bool,
    request_id: u32,
) -> CmdResult<Option<Summary>> {
    let saved = load_settings(&state)?;
    let provider = saved.ai.reader_provider;
    check_usable(&saved, provider)?;
    let (account, _) = store::thread_gmail_ref(&state.db.conn(), thread_id)?;
    let gmail = state.gmail_for(account).ok().map(|g| g.interactive());
    let db = state.db.clone();
    let programs = ai.programs_for(&saved).await;
    let request = SummaryRequest {
        thread: thread_id,
        kind: SummaryKind::Full,
        automatic,
        fresh,
    };
    let emit = app.clone();
    let result = cancellable(&ai, request_id, async move {
        let on_text = move |text: &str| {
            let _ = AiTextEvent {
                request_id,
                text: text.to_string(),
            }
            .emit(&emit);
        };
        tasks::summarize(&db, gmail.as_ref(), &programs, provider, request, &on_text).await
    })
    .await;
    match result {
        Ok(Summarized::Done(summary, answer)) => {
            ai.note(&answer);
            Ok(Some(summary))
        }
        Ok(Summarized::NotNeeded) => Ok(None),
        Err(e) => {
            state
                .sync_log
                .write(account, &format!("AI summary failed: {}", e.message));
            Err(e)
        }
    }
}

/// The current one-line summaries for these conversations (the ones on
/// screen). Those without one are queued and arrive as
/// `AiLineSummaryEvent`s. Empty when list summaries are off.
#[tauri::command]
#[specta::specta]
pub fn ai_list_summaries(
    state: State<'_, AppState>,
    ai: State<'_, AiState>,
    thread_ids: Vec<ThreadId>,
) -> CmdResult<Vec<Summary>> {
    let saved = load_settings(&state)?;
    let Some(provider) = saved.ai.list_summaries else {
        return Ok(Vec::new());
    };
    if check_usable(&saved, provider).is_err() {
        return Ok(Vec::new());
    }
    let current = summaries::current_lines(&state.db.conn(), &thread_ids)?;
    let have: HashSet<ThreadId> = current.iter().map(|s| s.thread_id).collect();
    let missing: Vec<ThreadId> = thread_ids
        .into_iter()
        .filter(|t| !have.contains(t))
        .collect();
    ai.queue.push(&missing);
    Ok(current)
}

/// Writes (or rewrites) an email from the owner's request, the
/// conversation and the draft; streamed as `AiTextEvent`s.
#[tauri::command]
#[specta::specta]
pub async fn ai_write(
    app: AppHandle,
    state: State<'_, AppState>,
    ai: State<'_, AiState>,
    request: WriteRequest,
    request_id: u32,
) -> CmdResult<WriteAnswer> {
    let saved = load_settings(&state)?;
    let provider = saved.ai.writing_provider;
    let quality = saved.ai.writing_quality;
    check_usable(&saved, provider)?;
    let gmail = match request.thread_id {
        Some(t) => {
            let (account, _) = store::thread_gmail_ref(&state.db.conn(), t)?;
            state.gmail_for(account).ok().map(|g| g.interactive())
        }
        None => None,
    };
    let db = state.db.clone();
    let programs = ai.programs_for(&saved).await;
    let emit = app.clone();
    let (answer, raw) = cancellable(&ai, request_id, async move {
        let on_text = move |text: &str| {
            let _ = AiTextEvent {
                request_id,
                text: text.to_string(),
            }
            .emit(&emit);
        };
        tasks::write(
            &db,
            gmail.as_ref(),
            &programs,
            provider,
            quality,
            &request,
            &on_text,
        )
        .await
    })
    .await?;
    ai.note(&raw);
    Ok(answer)
}

/// Suggestions for the writing assistant's chips, from the conversation
/// being answered or forwarded (with the writing provider).
#[tauri::command]
#[specta::specta]
pub async fn ai_reply_ideas(
    state: State<'_, AppState>,
    ai: State<'_, AiState>,
    thread_id: ThreadId,
    forward: bool,
    request_id: u32,
) -> CmdResult<Vec<String>> {
    let saved = load_settings(&state)?;
    let provider = saved.ai.writing_provider;
    check_usable(&saved, provider)?;
    let (account, _) = store::thread_gmail_ref(&state.db.conn(), thread_id)?;
    let gmail = state.gmail_for(account).ok().map(|g| g.interactive());
    let db = state.db.clone();
    let programs = ai.programs_for(&saved).await;
    let (ideas, raw) = cancellable(&ai, request_id, async move {
        tasks::reply_ideas(&db, gmail.as_ref(), &programs, provider, thread_id, forward).await
    })
    .await?;
    ai.note(&raw);
    Ok(ideas)
}

#[tauri::command]
#[specta::specta]
pub fn ai_cancel(ai: State<'_, AiState>, request_id: u32) {
    let job = ai.jobs.lock().unwrap().remove(&request_id);
    if let Some(job) = job {
        // Drops the request, which stops the provider's program.
        job.abort();
    }
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AiUsageReport {
    pub providers: Vec<ProviderUsage>,
    /// Claude's subscription limits, as of its latest answer this session.
    pub limits: Vec<PlanLimit>,
}

/// Requests, tokens and cost per provider. `today_start` is local
/// midnight in Unix ms (the window knows the time zone).
#[tauri::command]
#[specta::specta]
pub fn ai_usage(
    state: State<'_, AppState>,
    ai: State<'_, AiState>,
    today_start: f64,
) -> CmdResult<AiUsageReport> {
    let providers = usage::report(&state.db.conn(), today_start as i64)?;
    Ok(AiUsageReport {
        providers,
        limits: ai.limits.lock().unwrap().clone(),
    })
}

/// The ChatGPT models Codex offers, for Settings → AI (read afresh).
#[tauri::command]
#[specta::specta]
pub async fn ai_chatgpt_models(ai: State<'_, AiState>) -> CmdResult<Vec<CodexModel>> {
    let programs = ai.refresh();
    Ok(ai.codex_catalog(&programs, true).await)
}

/// Opens System Settings → Apple Intelligence & Siri, where it's turned on.
#[tauri::command]
#[specta::specta]
pub fn ai_apple_settings_open() -> CmdResult<()> {
    open::that_detached("x-apple.systempreferences:com.apple.Siri-Settings.extension")
        .map_err(|e| CoreError::Other(format!("could not open System Settings: {e}")))?;
    Ok(())
}

/// Forgets every summary (they're written again as needed).
#[tauri::command]
#[specta::specta]
pub fn ai_summaries_clear(state: State<'_, AppState>, ai: State<'_, AiState>) -> CmdResult<()> {
    summaries::clear(&state.db.conn())?;
    ai.queue.reset();
    Ok(())
}

/// Conversations waiting for a one-line summary. The newest asked for go
/// first (they're the ones on screen); a long scroll drops the oldest.
#[derive(Default)]
struct LineQueue {
    inner: Mutex<QueueState>,
    wake: tokio::sync::Notify,
}

#[derive(Default)]
struct QueueState {
    pending: VecDeque<ThreadId>,
    /// Tried and failed this session: not asked again until a reset.
    failed: HashSet<ThreadId>,
    /// After several failures in a row (provider off, signed out), the
    /// queue rests instead of failing on every row.
    paused_until: Option<Instant>,
}

const QUEUE_MAX: usize = 60;
const FAILURES_BEFORE_PAUSE: u32 = 3;
const PAUSE: Duration = Duration::from_secs(600);

impl LineQueue {
    fn push(&self, threads: &[ThreadId]) {
        if threads.is_empty() {
            return;
        }
        let mut q = self.inner.lock().unwrap();
        if q.paused_until.is_some_and(|t| Instant::now() < t) {
            return;
        }
        for &t in threads.iter().rev() {
            if q.failed.contains(&t) {
                continue;
            }
            q.pending.retain(|x| *x != t);
            q.pending.push_back(t);
        }
        while q.pending.len() > QUEUE_MAX {
            q.pending.pop_front();
        }
        drop(q);
        self.wake.notify_one();
    }

    fn pop(&self) -> Option<ThreadId> {
        self.inner.lock().unwrap().pending.pop_back()
    }

    fn reset(&self) {
        *self.inner.lock().unwrap() = QueueState::default();
    }
}

/// Writes queued one-line summaries, one at a time, in the background.
pub fn run_line_queue(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut failures = 0;
        loop {
            let ai = app.state::<AiState>();
            let Some(thread) = ai.queue.pop() else {
                ai.queue.wake.notified().await;
                continue;
            };
            let state = app.state::<AppState>();
            let Ok(saved) = load_settings(&state) else {
                continue;
            };
            let Some(provider) = saved.ai.list_summaries else {
                ai.queue.reset();
                continue;
            };
            if check_usable(&saved, provider).is_err() {
                ai.queue.reset();
                continue;
            }
            let Ok((account, _)) = store::thread_gmail_ref(&state.db.conn(), thread) else {
                continue;
            };
            // Background: behind anything the owner is waiting for.
            let gmail = state.gmail_for(account).ok();
            let request = SummaryRequest {
                thread,
                kind: SummaryKind::Line,
                automatic: true,
                fresh: false,
            };
            let programs = ai.programs_for(&saved).await;
            let result = tasks::summarize(
                &state.db,
                gmail.as_ref(),
                &programs,
                provider,
                request,
                &|_| {},
            )
            .await;
            match result {
                Ok(Summarized::Done(summary, answer)) => {
                    failures = 0;
                    ai.note(&answer);
                    let _ = AiLineSummaryEvent(summary).emit(&app);
                }
                Ok(Summarized::NotNeeded) => {}
                Err(e) => {
                    // A refusal is about that email; the provider still works.
                    if !is_refusal(&e) {
                        failures += 1;
                    }
                    state.sync_log.write(
                        account,
                        &format!("AI list summary failed ({}): {e}", provider.as_str()),
                    );
                    let mut q = ai.queue.inner.lock().unwrap();
                    q.failed.insert(thread);
                    if failures >= FAILURES_BEFORE_PAUSE {
                        failures = 0;
                        q.pending.clear();
                        q.paused_until = Some(Instant::now() + PAUSE);
                    }
                }
            }
        }
    });
}

/// The model declined this email (Apple's guardrails), rather than the
/// provider being off or signed out.
fn is_refusal(e: &CoreError) -> bool {
    let m = e.to_string().to_lowercase();
    m.contains("guardrail") || m.contains("declined")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refusals_are_told_apart_from_a_provider_being_down() {
        assert!(is_refusal(&CoreError::Ai(
            "The model's safety guardrails were triggered.".into()
        )));
        assert!(!is_refusal(&CoreError::Ai(
            "Turn on Apple Intelligence in System Settings.".into()
        )));
    }

    #[test]
    fn the_newest_requests_go_first_and_failures_are_skipped() {
        let q = LineQueue::default();
        q.push(&[ThreadId(1), ThreadId(2)]);
        q.push(&[ThreadId(3), ThreadId(1)]);
        // The latest screen's rows, top row first.
        assert_eq!(q.pop(), Some(ThreadId(3)));
        assert_eq!(q.pop(), Some(ThreadId(1)));
        assert_eq!(q.pop(), Some(ThreadId(2)));
        assert_eq!(q.pop(), None);
        q.inner.lock().unwrap().failed.insert(ThreadId(9));
        q.push(&[ThreadId(9)]);
        assert_eq!(q.pop(), None);
        q.reset();
        q.push(&[ThreadId(9)]);
        assert_eq!(q.pop(), Some(ThreadId(9)));
    }

    #[test]
    fn the_queue_stays_short() {
        let q = LineQueue::default();
        let many: Vec<ThreadId> = (0..200).map(ThreadId).collect();
        q.push(&many);
        assert_eq!(q.inner.lock().unwrap().pending.len(), QUEUE_MAX);
        assert_eq!(q.pop(), Some(ThreadId(0)), "the first asked for is on top");
    }

    #[test]
    fn only_connected_providers_are_used() {
        let mut s = AppSettings::default();
        assert!(check_usable(&s, AiProvider::Apple).is_ok());
        assert!(check_usable(&s, AiProvider::Claude).is_err());
        s.ai.connected.push(AiProvider::Claude);
        assert!(check_usable(&s, AiProvider::Claude).is_ok());
    }
}
