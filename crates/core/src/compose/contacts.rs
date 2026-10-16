//! The people compose suggests in To/Cc/Bcc, from mail already cached
//! (every account, as local search does). People you've written to rank
//! first; within that, how often and how recently you exchanged mail.
//!
//! The whole ranked list goes to the UI once and is filtered there as you
//! type: a query per keystroke (plus the trip over IPC) made suggestions
//! lag behind typing.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::db::now_millis;
use crate::error::Result;

/// A month: a message this old counts half as much as one from today.
const HALF_WEIGHT_AGE_MS: f64 = 30.0 * 24.0 * 3600.0 * 1000.0;

/// Someone compose can suggest, best first in [`all`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Contact {
    pub name: Option<String>,
    pub email: String,
    /// You've sent them mail (they rank above people who only wrote to you).
    pub wrote: bool,
}

/// Everyone worth suggesting, best first: one entry per address.
pub fn all(conn: &Connection) -> Result<Vec<Contact>> {
    // Candidates: everyone on To/Cc of mail you sent (weight 3), and the
    // senders of mail you received (weight 1), leaving out Spam and Trash.
    // Automated senders only count if you've written to them. The name
    // shown is the newest non-empty one seen for the address.
    let mut stmt = conn.prepare(
        "WITH sent AS (
           SELECT m.* FROM messages m
           JOIN message_labels ml ON ml.message_id = m.id
           JOIN labels l ON l.id = ml.label_id AND l.gmail_label_id = 'SENT'
         ),
         junk AS (
           SELECT ml.message_id FROM message_labels ml
           JOIN labels l ON l.id = ml.label_id AND l.gmail_label_id IN ('SPAM', 'TRASH')
         ),
         cand (email, name, at, w) AS MATERIALIZED (
           SELECT json_extract(j.value, '$.email'), json_extract(j.value, '$.name'), s.internal_date, 3
             FROM sent s, json_each(s.to_json) j
           UNION ALL
           SELECT json_extract(j.value, '$.email'), json_extract(j.value, '$.name'), s.internal_date, 3
             FROM sent s, json_each(s.cc_json) j
           UNION ALL
           SELECT from_email, from_name, internal_date, 1 FROM messages
             WHERE from_email != '' AND id NOT IN (SELECT message_id FROM junk)
         ),
         -- Newest non-empty name per address (SQLite takes the bare
         -- column from the row holding MAX).
         names AS (
           SELECT lower(email) AS key, name, MAX(at) FROM cand
           WHERE name IS NOT NULL AND name != '' GROUP BY key
         ),
         ranked AS (
           SELECT lower(email) AS key, email,
                  MAX(w) AS wrote,
                  SUM(w / (1.0 + MAX(0, ?1 - at) / ?2)) AS score,
                  MAX(at) AS last_at
           FROM cand
           WHERE email IS NOT NULL AND email LIKE '%@%'
           GROUP BY key
         )
         SELECT r.email, n.name, r.wrote, r.score, r.last_at, r.key
         FROM ranked r LEFT JOIN names n ON n.key = r.key
         WHERE r.wrote = 3 OR NOT (
           r.key LIKE '%noreply%' OR r.key LIKE '%no-reply%' OR r.key LIKE '%donotreply%'
           OR r.key LIKE '%do-not-reply%' OR r.key LIKE 'notifications@%'
           OR r.key LIKE 'mailer-daemon@%' OR r.key LIKE '%bounce%')
         ORDER BY r.wrote DESC, r.score DESC, r.last_at DESC",
    )?;
    let rows = stmt.query_map(params![now_millis(), HALF_WEIGHT_AGE_MS], |r| {
        Ok(Contact {
            email: r.get(0)?,
            name: r.get(1)?,
            wrote: r.get::<_, i64>(2)? == 3,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::store::{upsert_thread, IncomingMessage, IncomingThread};
    use crate::db::{accounts, Db};
    use crate::model::{AccountId, Address};

    fn addr(name: &str, email: &str) -> Address {
        Address {
            name: (!name.is_empty()).then(|| name.to_string()),
            email: email.to_string(),
        }
    }

    fn account(db: &Db, sub: &str) -> AccountId {
        accounts::upsert(
            &db.conn(),
            &accounts::NewAccount {
                google_sub: sub,
                email: &format!("{sub}@me.com"),
                display_name: None,
                avatar_url: None,
                oauth_client: "default",
            },
        )
        .unwrap()
        .id
    }

    fn message(
        id: &str,
        labels: &[&str],
        from: Address,
        to: Vec<Address>,
        at: i64,
    ) -> IncomingThread {
        IncomingThread {
            gmail_thread_id: format!("t-{id}"),
            messages: vec![IncomingMessage {
                gmail_message_id: id.into(),
                label_ids: labels.iter().map(|l| l.to_string()).collect(),
                internal_date: at,
                from: Some(from),
                to,
                ..Default::default()
            }],
        }
    }

    #[test]
    fn people_you_wrote_to_rank_first_across_accounts() {
        let db = Db::open_in_memory().unwrap();
        let a = account(&db, "a");
        let b = account(&db, "b");
        let now = now_millis();
        let mut conn = db.conn();
        // Account A received from Sam often and recently; account B wrote
        // to Sally once, long ago. Writing to someone still wins.
        for i in 0..5 {
            upsert_thread(
                &mut conn,
                a,
                &message(
                    &format!("r{i}"),
                    &["INBOX"],
                    addr("Sam Smith", "sam@x.com"),
                    vec![],
                    now,
                ),
            )
            .unwrap();
        }
        upsert_thread(
            &mut conn,
            b,
            &message(
                "s1",
                &["SENT"],
                addr("", "b@me.com"),
                vec![addr("Sally Jones", "sally@y.com")],
                now - 400 * 24 * 3600 * 1000,
            ),
        )
        .unwrap();
        let found = all(&conn).unwrap();
        let emails: Vec<&str> = found.iter().map(|c| c.email.as_str()).collect();
        assert_eq!(&emails[..2], &["sally@y.com", "sam@x.com"]);
        assert!(found[0].wrote && !found[1].wrote);
        assert_eq!(found[1].name.as_deref(), Some("Sam Smith"));
    }

    #[test]
    fn automated_senders_and_spam_are_left_out_and_case_is_merged() {
        let db = Db::open_in_memory().unwrap();
        let a = account(&db, "a");
        let mut conn = db.conn();
        for (id, labels, from) in [
            ("m1", ["INBOX"], addr("", "noreply@shop.com")),
            ("m2", ["SPAM"], addr("", "nigel@spam.com")),
            ("m3", ["INBOX"], addr("Kim", "Kim@x.com")),
            ("m4", ["INBOX"], addr("", "kim@x.com")),
            ("m5", ["INBOX"], addr("", "bounce+123@lists.x.com")),
        ] {
            upsert_thread(&mut conn, a, &message(id, &labels, from, vec![], 1)).unwrap();
        }
        let found = all(&conn).unwrap();
        assert_eq!(found.len(), 1, "{found:?}");
        assert_eq!(found[0].name.as_deref(), Some("Kim"));
    }
}
