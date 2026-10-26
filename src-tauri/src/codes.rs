//! Sign-in codes in new mail, for the window's top-right notice
//! (`mail_core::mail::codes` finds them).

use std::sync::Arc;

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

/// Tells the window about codes in these new messages: at once for those
/// whose subject or snippet shows one, and after downloading the body for
/// those whose subject says there's a code but the snippet doesn't show it.
pub fn arrived(app: &AppHandle, db: &Arc<Db>, messages: &[MessageId]) {
    let found = codes::in_messages(&db.conn(), messages);
    let Ok((found, needs_body)) = found else {
        return;
    };
    for code in found {
        let _ = SignInCodeEvent(code).emit(app);
    }
    if needs_body.is_empty() {
        return;
    }
    let app = app.clone();
    let db = db.clone();
    tauri::async_runtime::spawn(async move {
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
            if mail_core::sync::fetch_body(&db, &gmail.interactive(), m)
                .await
                .is_err()
            {
                continue;
            }
            let again = codes::in_messages(&db.conn(), &[m]);
            if let Ok((found, _)) = again {
                for code in found {
                    let _ = SignInCodeEvent(code).emit(&app);
                }
            }
        }
    });
}
