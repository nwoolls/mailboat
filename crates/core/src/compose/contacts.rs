//! Address suggestions while typing To/Cc/Bcc, from mail already cached
//! (every account, as local search does). People you've written to rank
//! first; within that, how often and how recently you exchanged mail.

use rusqlite::{params, Connection};

use crate::db::now_millis;
use crate::error::Result;
use crate::model::Address;

/// A month: a message this old counts half as much as one from today.
const HALF_WEIGHT_AGE_MS: f64 = 30.0 * 24.0 * 3600.0 * 1000.0;

/// Up to `limit` people matching what was typed: the start of their
/// address, of any word of their name, or of their domain.
pub fn suggest(conn: &Connection, text: &str, limit: u32) -> Result<Vec<Address>> {
    let text = text.trim().to_lowercase();
    if text.is_empty() {
        return Ok(Vec::new());
    }
    let like = escape_like(&text);
    // Candidates: everyone on To/Cc of mail you sent (weight 3), and the
    // senders of mail you received (weight 1), leaving out Spam and Trash.
    // Automated senders only count if you've written to them.
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
         cand (email, name, at, w) AS (
           SELECT json_extract(j.value, '$.email'), json_extract(j.value, '$.name'), s.internal_date, 3
             FROM sent s, json_each(s.to_json) j
           UNION ALL
           SELECT json_extract(j.value, '$.email'), json_extract(j.value, '$.name'), s.internal_date, 3
             FROM sent s, json_each(s.cc_json) j
           UNION ALL
           SELECT from_email, from_name, internal_date, 1 FROM messages
             WHERE from_email != '' AND id NOT IN (SELECT message_id FROM junk)
         ),
         matched AS (
           SELECT lower(email) AS key, email, name, at, w FROM cand
           WHERE lower(email) LIKE ?1 || '%' ESCAPE '\\'
              OR lower(email) LIKE '%@' || ?1 || '%' ESCAPE '\\'
              OR lower(name) LIKE ?1 || '%' ESCAPE '\\'
              OR lower(name) LIKE '% ' || ?1 || '%' ESCAPE '\\'
         )
         SELECT email, name, MAX(at) AS last_at, MAX(w) AS wrote,
                SUM(w / (1.0 + MAX(0, ?2 - at) / ?3)) AS score
         FROM matched
         GROUP BY key
         HAVING wrote = 3 OR NOT (
           key LIKE '%noreply%' OR key LIKE '%no-reply%' OR key LIKE '%donotreply%'
           OR key LIKE '%do-not-reply%' OR key LIKE 'notifications@%' OR key LIKE 'mailer-daemon@%')
         ORDER BY wrote DESC, score DESC, last_at DESC
         LIMIT ?4",
    )?;
    let rows = stmt.query_map(
        params![like, now_millis(), HALF_WEIGHT_AGE_MS, limit],
        |r| {
            Ok(Address {
                email: r.get(0)?,
                name: r.get(1)?,
            })
        },
    )?;
    let mut out: Vec<Address> = rows.collect::<rusqlite::Result<_>>()?;
    // The name shown is from the newest matching message; fall back to any
    // name seen for that address.
    for a in out
        .iter_mut()
        .filter(|a| a.name.as_deref().is_none_or(str::is_empty))
    {
        a.name = conn
            .query_row(
                "SELECT from_name FROM messages WHERE from_email = ?1 COLLATE NOCASE
                   AND from_name IS NOT NULL AND from_name != ''
                 ORDER BY internal_date DESC LIMIT 1",
                [&a.email],
                |r| r.get(0),
            )
            .ok();
    }
    Ok(out)
}

fn escape_like(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::store::{upsert_thread, IncomingMessage, IncomingThread};
    use crate::db::{accounts, Db};
    use crate::model::AccountId;

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

    fn emails(list: &[Address]) -> Vec<&str> {
        list.iter().map(|a| a.email.as_str()).collect()
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
        let found = suggest(&conn, "s", 10).unwrap();
        assert_eq!(emails(&found), vec!["sally@y.com", "sam@x.com"]);
        assert_eq!(found[1].name.as_deref(), Some("Sam Smith"));
    }

    #[test]
    fn matches_name_words_and_domains_but_not_the_middle_of_words() {
        let db = Db::open_in_memory().unwrap();
        let a = account(&db, "a");
        let mut conn = db.conn();
        upsert_thread(
            &mut conn,
            a,
            &message("m1", &["INBOX"], addr("Jane Doe", "jd@acme.com"), vec![], 1),
        )
        .unwrap();
        assert_eq!(
            emails(&suggest(&conn, "doe", 5).unwrap()),
            vec!["jd@acme.com"]
        );
        assert_eq!(
            emails(&suggest(&conn, "acme", 5).unwrap()),
            vec!["jd@acme.com"]
        );
        assert_eq!(
            emails(&suggest(&conn, "JD", 5).unwrap()),
            vec!["jd@acme.com"]
        );
        assert!(suggest(&conn, "oe", 5).unwrap().is_empty());
        assert!(
            suggest(&conn, "%", 5).unwrap().is_empty(),
            "wildcards are literal"
        );
        assert!(suggest(&conn, "  ", 5).unwrap().is_empty());
    }

    #[test]
    fn automated_senders_and_spam_are_left_out() {
        let db = Db::open_in_memory().unwrap();
        let a = account(&db, "a");
        let mut conn = db.conn();
        upsert_thread(
            &mut conn,
            a,
            &message("m1", &["INBOX"], addr("", "noreply@shop.com"), vec![], 1),
        )
        .unwrap();
        upsert_thread(
            &mut conn,
            a,
            &message("m2", &["SPAM"], addr("", "nigel@spam.com"), vec![], 1),
        )
        .unwrap();
        assert!(suggest(&conn, "no", 5).unwrap().is_empty());
        assert!(suggest(&conn, "nigel", 5).unwrap().is_empty());
    }

    #[test]
    fn one_entry_per_address_whatever_its_case() {
        let db = Db::open_in_memory().unwrap();
        let a = account(&db, "a");
        let mut conn = db.conn();
        upsert_thread(
            &mut conn,
            a,
            &message("m1", &["INBOX"], addr("Kim", "Kim@x.com"), vec![], 1),
        )
        .unwrap();
        upsert_thread(
            &mut conn,
            a,
            &message("m2", &["INBOX"], addr("Kim", "kim@x.com"), vec![], 2),
        )
        .unwrap();
        assert_eq!(suggest(&conn, "kim", 5).unwrap().len(), 1);
    }
}
