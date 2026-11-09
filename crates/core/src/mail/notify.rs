//! What a "new mail" notification says. Shown by macOS, so the sender and
//! subject appear on screen; nothing is logged.

use rusqlite::{params, Connection};

use crate::error::Result;
use crate::model::{AccountId, MessageId, SyncStatus, ThreadId};

/// One notification to show.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Notice {
    pub title: String,
    pub body: String,
    /// The conversation it's about, which clicking it opens; `None` for
    /// the "N new messages" summary.
    pub thread: Option<ThreadId>,
}

/// Beyond this many at once, one summary instead of one each.
pub const MAX_SEPARATE: usize = 3;

/// Which of the messages to notify about show at once and which wait for
/// their body (`waiting`: it may hold a sign-in code the banner should lead
/// with). A batch big enough to collapse into one summary shows as one, now:
/// splitting it would make two summaries, or separate banners where there
/// should be one, and a summary never leads with a code.
pub fn split_for_body(
    wanted: &[MessageId],
    waiting: &[MessageId],
) -> (Vec<MessageId>, Vec<MessageId>) {
    if wanted.len() > MAX_SEPARATE {
        return (wanted.to_vec(), Vec::new());
    }
    wanted.iter().partition(|m| !waiting.contains(m))
}

/// The notifications for new mail in one account. `account_label` (its
/// address) is added when there's more than one account.
pub fn notices(
    conn: &Connection,
    account: AccountId,
    messages: &[MessageId],
    account_label: Option<&str>,
) -> Result<Vec<Notice>> {
    let suffix = account_label.map(|a| format!(" · {a}")).unwrap_or_default();
    if messages.len() > MAX_SEPARATE {
        return Ok(vec![Notice {
            title: format!("{} new messages", messages.len()),
            body: account_label.unwrap_or("Inbox").to_string(),
            thread: None,
        }]);
    }
    let mut out = Vec::new();
    for &m in messages {
        let row: Option<(Option<String>, String, String, String, ThreadId)> = conn
            .query_row(
                "SELECT from_name, from_email, subject, snippet, thread_id FROM messages WHERE id = ?1 AND account_id = ?2",
                params![m, account],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .ok();
        if let Some((name, email, subject, snippet, thread)) = row {
            let who = name.filter(|n| !n.trim().is_empty()).unwrap_or(email);
            let subject = if subject.trim().is_empty() {
                "(no subject)".to_string()
            } else {
                subject
            };
            // A sign-in code leads, so it can be read off the banner. From the
            // body too, when it has been downloaded, since the snippet is short.
            let notice = match super::codes::find_cached(conn, &subject, &snippet, m) {
                Some(code) => Notice {
                    title: format!("{code} · {who}"),
                    body: format!("Sign-in code · {subject}{suffix}"),
                    thread: Some(thread),
                },
                None => Notice {
                    title: who,
                    body: format!("{subject}{suffix}"),
                    thread: Some(thread),
                },
            };
            out.push(notice);
        }
    }
    Ok(out)
}

/// Remembers which accounts Google has signed out, so each sign-out is
/// told once (the sync worker reports the state again at every launch and
/// after every manual retry, and a person shouldn't be notified each time).
#[derive(Debug, Default)]
pub struct SignOuts(std::collections::HashSet<AccountId>);

impl SignOuts {
    /// Feeds an account's new sync status. True when it has just been
    /// signed out (it wasn't, as far as this knows). Only `Idle` (a whole
    /// pass worked) forgets it: every retry reports `Syncing` first and
    /// `AuthError` again after, and that is the same sign-out, as is a
    /// retry that fails some other way.
    pub fn is_new(&mut self, account: AccountId, status: SyncStatus) -> bool {
        match status {
            SyncStatus::AuthError => self.0.insert(account),
            SyncStatus::Idle => {
                self.0.remove(&account);
                false
            }
            _ => false,
        }
    }

    /// Takes it back: the notification couldn't be made, so the next report
    /// of the sign-out should try again.
    pub fn forget(&mut self, account: AccountId) {
        self.0.remove(&account);
    }
}

/// The notification for a sign-out. Clicking it only brings the app
/// forward, where the notice has the Sign in again button.
pub fn signed_out_notice(email: &str) -> Notice {
    Notice {
        title: "Google signed you out".into(),
        body: format!("{email} needs to sign in again"),
        thread: None,
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn a_few_messages_split_into_those_to_show_now_and_those_waiting_for_a_body() {
        let ids = |v: &[i64]| v.iter().map(|&n| MessageId(n)).collect::<Vec<_>>();
        let (now, later) = split_for_body(&ids(&[1, 2, 3]), &ids(&[2]));
        assert_eq!((now, later), (ids(&[1, 3]), ids(&[2])));
        // None waiting: everything now.
        let (now, later) = split_for_body(&ids(&[1, 2]), &[]);
        assert_eq!((now, later), (ids(&[1, 2]), vec![]));
        // A waiting message that isn't to be notified about is no one's concern.
        let (now, later) = split_for_body(&ids(&[1]), &ids(&[9]));
        assert_eq!((now, later), (ids(&[1]), vec![]));
    }

    #[test]
    fn a_batch_that_collapses_into_one_summary_is_never_split() {
        let ids: Vec<MessageId> = (1..=(MAX_SEPARATE as i64 + 1)).map(MessageId).collect();
        let (now, later) = split_for_body(&ids, &ids[..1]);
        assert_eq!(now, ids);
        assert!(later.is_empty());
    }

    use super::*;
    use crate::db::store::{upsert_thread, IncomingMessage, IncomingThread};
    use crate::db::{accounts, Db};
    use crate::model::Address;

    fn setup(n: usize) -> (Db, AccountId, Vec<MessageId>) {
        let db = Db::open_in_memory().unwrap();
        let a = accounts::upsert(
            &db.conn(),
            &accounts::NewAccount {
                google_sub: "a",
                email: "a@x.example",
                display_name: None,
                avatar_url: None,
                oauth_client: "default",
            },
        )
        .unwrap()
        .id;
        for i in 0..n {
            upsert_thread(
                &mut db.conn(),
                a,
                &IncomingThread {
                    gmail_thread_id: format!("t{i}"),
                    messages: vec![IncomingMessage {
                        gmail_message_id: format!("m{i}"),
                        subject: if i == 0 {
                            String::new()
                        } else {
                            format!("Hello {i}")
                        },
                        from: Some(Address {
                            name: (i == 1).then(|| "Jane Doe".to_string()),
                            email: format!("p{i}@y.example"),
                        }),
                        ..Default::default()
                    }],
                },
            )
            .unwrap();
        }
        let ids = db
            .conn()
            .prepare("SELECT id FROM messages ORDER BY id")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<MessageId>>>()
            .unwrap();
        (db, a, ids)
    }

    #[test]
    fn a_few_messages_get_one_notice_each() {
        let (db, a, ids) = setup(2);
        let n = notices(&db.conn(), a, &ids, Some("a@x.example")).unwrap();
        let thread_of = |m: MessageId| -> ThreadId {
            db.conn()
                .query_row("SELECT thread_id FROM messages WHERE id = ?1", [m], |r| {
                    r.get(0)
                })
                .unwrap()
        };
        assert_eq!(
            n,
            vec![
                Notice {
                    title: "p0@y.example".into(),
                    body: "(no subject) · a@x.example".into(),
                    thread: Some(thread_of(ids[0])),
                },
                Notice {
                    title: "Jane Doe".into(),
                    body: "Hello 1 · a@x.example".into(),
                    thread: Some(thread_of(ids[1])),
                },
            ]
        );
    }

    #[test]
    fn many_become_one_summary() {
        let (db, a, ids) = setup(5);
        let n = notices(&db.conn(), a, &ids, None).unwrap();
        assert_eq!(
            n,
            vec![Notice {
                title: "5 new messages".into(),
                body: "Inbox".into(),
                thread: None,
            }]
        );
    }

    #[test]
    fn a_sign_in_code_leads_the_notice_and_arrives_for_the_window() {
        let (db, a, _) = setup(0);
        let thread = upsert_thread(
            &mut db.conn(),
            a,
            &IncomingThread {
                gmail_thread_id: "c".into(),
                messages: vec![IncomingMessage {
                    gmail_message_id: "c1".into(),
                    subject: "Your Spotify login code".into(),
                    snippet: "Your login code is 346625. It expires in 15 minutes.".into(),
                    from: Some(Address {
                        name: Some("Spotify".into()),
                        email: "no-reply@spotify.example".into(),
                    }),
                    ..Default::default()
                }],
            },
        )
        .unwrap();
        let id: MessageId = db
            .conn()
            .query_row("SELECT id FROM messages", [], |r| r.get(0))
            .unwrap();
        let n = notices(&db.conn(), a, &[id], None).unwrap();
        assert_eq!(n[0].title, "346625 · Spotify");
        assert_eq!(n[0].body, "Sign-in code · Your Spotify login code");
        assert_eq!(n[0].thread, Some(thread));
        let (found, needs_body) = super::super::codes::in_messages(&db.conn(), &[id]).unwrap();
        assert!(needs_body.is_empty());
        assert_eq!(found[0].code, "346625");
        assert_eq!(found[0].thread_id, thread);
        assert_eq!(found[0].sender, "Spotify");
    }

    #[test]
    fn a_sign_out_is_new_once_until_the_account_signs_in_again() {
        let mut outs = SignOuts::default();
        let a = AccountId(1);
        assert!(!outs.is_new(a, SyncStatus::Syncing));
        assert!(outs.is_new(a, SyncStatus::AuthError));
        // A retry: Syncing, then AuthError again. The same sign-out.
        assert!(!outs.is_new(a, SyncStatus::Syncing));
        assert!(!outs.is_new(a, SyncStatus::AuthError));
        assert!(!outs.is_new(a, SyncStatus::Backoff));
        assert!(!outs.is_new(a, SyncStatus::AuthError));
        // Another account is its own.
        assert!(outs.is_new(AccountId(2), SyncStatus::AuthError));
        // Signed in again (a pass worked), then out again: new.
        assert!(!outs.is_new(a, SyncStatus::Idle));
        assert!(outs.is_new(a, SyncStatus::AuthError));
        // A notification that couldn't be made is tried again.
        outs.forget(a);
        assert!(outs.is_new(a, SyncStatus::AuthError));
    }
}
