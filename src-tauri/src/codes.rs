//! Sign-in codes in new mail, for the window's top-right notice
//! (`mail_core::mail::codes` finds them).

use std::sync::Arc;
use std::time::Duration;

use mail_core::db::Db;
use mail_core::mail::codes::{self, ArrivedCode};
use mail_core::model::MessageId;
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Manager};
use tauri_specta::Event;

use crate::state::AppState;

/// A sign-in code arrived in new mail.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct SignInCodeEvent(pub ArrivedCode);

/// The longest to wait for the bodies of messages that may hold a code: a
/// banner waits that long for the code, and then goes without it.
const BODY_WAIT: Duration = Duration::from_secs(10);

/// Tells the window about codes in these new messages: at once for those
/// whose subject or snippet shows one, and after downloading the body for
/// those whose subject says there's a code but the snippet doesn't show it.
///
/// Returns the messages whose body is being downloaded to look for a code, and
/// calls `when_read` with them once that is done or has taken `BODY_WAIT`, so
/// a banner for them can show the code rather than the snippet's start.
pub fn arrived(
    app: &AppHandle,
    db: &Arc<Db>,
    messages: &[MessageId],
    when_read: impl FnOnce(&[MessageId]) + Send + 'static,
) -> Vec<MessageId> {
    let found = codes::in_messages(&db.conn(), messages);
    let Ok((found, needs_body)) = found else {
        return Vec::new();
    };
    for code in found {
        let _ = SignInCodeEvent(code).emit(app);
    }
    if needs_body.is_empty() {
        return Vec::new();
    }
    let waiting = needs_body.clone();
    let (done, finished) = tokio::sync::oneshot::channel();
    {
        let (app, db) = (app.clone(), db.clone());
        tauri::async_runtime::spawn(async move {
            read_bodies(&app, &db, needs_body).await;
            let _ = done.send(());
        });
    }
    // The download carries on past `BODY_WAIT` (the window's notice still
    // gets the code); only the banner stops waiting for it.
    let again = waiting.clone();
    tauri::async_runtime::spawn(async move {
        let _ = tokio::time::timeout(BODY_WAIT, finished).await;
        when_read(&again);
    });
    waiting
}

async fn read_bodies(app: &AppHandle, db: &Arc<Db>, needs_body: Vec<MessageId>) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    for m in needs_body {
        let account = mail_core::db::store::message_gmail_ref(&db.conn(), m);
        let Ok((account, _)) = account else { continue };
        let Ok(gmail) = state.gmail_for(account) else {
            continue;
        };
        // The owner is likely waiting on this code: ahead of sync.
        if mail_core::sync::fetch_body(db, &gmail.interactive(), m)
            .await
            .is_err()
        {
            continue;
        }
        let again = codes::in_messages(&db.conn(), &[m]);
        if let Ok((found, _)) = again {
            // The conversation's row can show the code now: have the lists look again.
            if !found.is_empty() {
                let _ = crate::events::MailChangedEvent::mail(account).emit(app);
            }
            for code in found {
                let _ = SignInCodeEvent(code).emit(app);
            }
        }
    }
}
