//! What a "new mail" notification says. Shown by macOS, so the sender and
//! subject appear on screen; nothing is logged.

use rusqlite::{params, Connection};

use crate::error::Result;
use crate::model::{AccountId, MessageId};

/// One notification to show.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Notice {
    pub title: String,
    pub body: String,
}

/// Beyond this many at once, one summary instead of one each.
pub const MAX_SEPARATE: usize = 3;

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
        }]);
    }
    let mut out = Vec::new();
    for &m in messages {
        let row: Option<(Option<String>, String, String)> = conn
            .query_row(
                "SELECT from_name, from_email, subject FROM messages WHERE id = ?1 AND account_id = ?2",
                params![m, account],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .ok();
        if let Some((name, email, subject)) = row {
            let who = name.filter(|n| !n.trim().is_empty()).unwrap_or(email);
            let subject = if subject.trim().is_empty() {
                "(no subject)".to_string()
            } else {
                subject
            };
            out.push(Notice {
                title: who,
                body: format!("{subject}{suffix}"),
            });
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
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
                email: "a@x.com",
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
                            email: format!("p{i}@y.com"),
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
        let n = notices(&db.conn(), a, &ids, Some("a@x.com")).unwrap();
        assert_eq!(
            n,
            vec![
                Notice {
                    title: "p0@y.com".into(),
                    body: "(no subject) · a@x.com".into()
                },
                Notice {
                    title: "Jane Doe".into(),
                    body: "Hello 1 · a@x.com".into()
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
                body: "Inbox".into()
            }]
        );
    }
}
