//! Proves the multi-account rules in CLAUDE.md: two accounts whose Gmail
//! thread, message and label IDs collide must never bleed into each other,
//! and unified views must show both.

use mailboat_core::db::store::{self, IncomingLabel, IncomingMessage, IncomingThread};
use mailboat_core::db::{accounts, query, Db};
use mailboat_core::model::*;

fn add_account(db: &Db, sub: &str, email: &str) -> Account {
    accounts::upsert(
        &db.conn(),
        &accounts::NewAccount {
            google_sub: sub,
            email,
            display_name: None,
            avatar_url: None,
            oauth_client: "default",
        },
    )
    .unwrap()
}

fn thread(
    gmail_thread: &str,
    gmail_message: &str,
    from: &str,
    subject: &str,
    date: i64,
    labels: &[&str],
) -> IncomingThread {
    IncomingThread {
        gmail_thread_id: gmail_thread.into(),
        messages: vec![IncomingMessage {
            gmail_message_id: gmail_message.into(),
            label_ids: labels.iter().map(|l| l.to_string()).collect(),
            internal_date: date,
            snippet: format!("snippet for {subject}"),
            subject: subject.into(),
            from: Some(Address {
                name: None,
                email: from.into(),
            }),
            ..Default::default()
        }],
    }
}

fn work_label() -> Vec<IncomingLabel> {
    vec![
        IncomingLabel {
            gmail_label_id: "INBOX".into(),
            name: "INBOX".into(),
            kind: LabelKind::System,
            color_bg: None,
            color_fg: None,
        },
        IncomingLabel {
            gmail_label_id: "Label_1".into(),
            name: "Work".into(),
            kind: LabelKind::User,
            color_bg: None,
            color_fg: None,
        },
    ]
}

fn list(db: &Db, accounts: AccountFilter, view: MailView) -> Vec<ThreadSummary> {
    query::list_threads(
        &db.conn(),
        &ListQuery {
            accounts,
            view,
            cursor: None,
            limit: 50,
        },
    )
    .unwrap()
    .threads
}

const INBOX: MailView = MailView::System {
    label: SystemLabel::Inbox,
};

#[test]
fn two_accounts_with_overlapping_gmail_ids() {
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db, "sub-a", "me@gmail.com");
    let b = add_account(&db, "sub-b", "me@example.com");

    // Both accounts have a label "Label_1" named "Work", and a thread "t1"
    // containing message "m1". Only the IDs collide; the content differs.
    store::sync_labels(&mut db.conn(), a.id, &work_label()).unwrap();
    store::sync_labels(&mut db.conn(), b.id, &work_label()).unwrap();
    store::upsert_thread(
        &mut db.conn(),
        a.id,
        &thread(
            "t1",
            "m1",
            "alice@x.com",
            "Personal hello",
            1_000,
            &["INBOX", "Label_1"],
        ),
    )
    .unwrap();
    store::upsert_thread(
        &mut db.conn(),
        b.id,
        &thread("t1", "m1", "bob@y.com", "Work update", 2_000, &["INBOX"]),
    )
    .unwrap();
    // Only account B has t2; it is starred but archived (not in INBOX).
    store::upsert_thread(
        &mut db.conn(),
        b.id,
        &thread(
            "t2",
            "m2",
            "carol@z.com",
            "Starred thing",
            3_000,
            &["STARRED"],
        ),
    )
    .unwrap();

    // Unified inbox: both t1 threads, newest first, each tagged with its account.
    let unified = list(&db, AccountFilter::All, INBOX);
    assert_eq!(unified.len(), 2);
    assert_eq!(
        (unified[0].account_id, unified[0].subject.as_str()),
        (b.id, "Work update")
    );
    assert_eq!(
        (unified[1].account_id, unified[1].subject.as_str()),
        (a.id, "Personal hello")
    );
    assert_ne!(unified[0].id, unified[1].id, "local thread IDs must differ");

    // Selecting both accounts explicitly is the same as All.
    assert_eq!(
        list(&db, AccountFilter::Only(vec![a.id, b.id]), INBOX),
        unified
    );

    // Per-account inbox: exactly one thread each, with that account's content.
    let only_a = list(&db, AccountFilter::Only(vec![a.id]), INBOX);
    assert_eq!(only_a.len(), 1);
    assert_eq!(only_a[0].subject, "Personal hello");
    let only_b = list(&db, AccountFilter::Only(vec![b.id]), INBOX);
    assert_eq!(only_b.len(), 1);
    assert_eq!(only_b[0].subject, "Work update");

    // Starred is a system label, so it unifies, but only B has a starred thread.
    let starred = list(
        &db,
        AccountFilter::All,
        MailView::System {
            label: SystemLabel::Starred,
        },
    );
    assert_eq!(starred.len(), 1);
    assert_eq!(starred[0].account_id, b.id);
    assert!(starred[0].starred);
    assert!(list(
        &db,
        AccountFilter::Only(vec![a.id]),
        MailView::System {
            label: SystemLabel::Starred
        }
    )
    .is_empty());

    // User labels never unify: both accounts have "Work" (Label_1), but they
    // are two separate label rows, and only A's thread carries it.
    let labels = query::user_labels(&db.conn(), &AccountFilter::All).unwrap();
    assert_eq!(labels.len(), 2);
    assert_ne!(labels[0].id, labels[1].id);
    let a_work = labels.iter().find(|l| l.account_id == a.id).unwrap();
    let b_work = labels.iter().find(|l| l.account_id == b.id).unwrap();
    let a_work_threads = list(
        &db,
        AccountFilter::All,
        MailView::UserLabel {
            label_id: a_work.id,
        },
    );
    assert_eq!(a_work_threads.len(), 1);
    assert_eq!(a_work_threads[0].account_id, a.id);
    assert!(list(
        &db,
        AccountFilter::All,
        MailView::UserLabel {
            label_id: b_work.id
        }
    )
    .is_empty());

    // Local search covers all accounts, and respects the account filter.
    let search = |filter, text: &str| list(&db, filter, MailView::Search { text: text.into() });
    assert_eq!(search(AccountFilter::All, "snippet").len(), 3);
    assert_eq!(search(AccountFilter::All, "bob").len(), 1);
    assert_eq!(search(AccountFilter::Only(vec![a.id]), "bob").len(), 0);
    assert_eq!(search(AccountFilter::Only(vec![a.id]), "snippet").len(), 1);

    // Threads never merge: each t1 detail contains only its own account's message.
    for t in &unified {
        let detail = query::thread_detail(&db.conn(), t.id).unwrap();
        assert_eq!(detail.messages.len(), 1);
        assert!(detail.messages.iter().all(|m| m.account_id == t.account_id));
    }
    let a_detail = query::thread_detail(&db.conn(), unified[1].id).unwrap();
    assert_eq!(a_detail.messages[0].from.email, "alice@x.com");
    assert_eq!(a_detail.labels.len(), 1);
    assert_eq!(a_detail.labels[0].account_id, a.id);

    // Re-syncing B's t1 (e.g. B archived it) changes nothing for A.
    store::upsert_thread(
        &mut db.conn(),
        b.id,
        &thread("t1", "m1", "bob@y.com", "Work update", 2_000, &[]),
    )
    .unwrap();
    let unified = list(&db, AccountFilter::All, INBOX);
    assert_eq!(unified.len(), 1);
    assert_eq!(unified[0].account_id, a.id);

    // Deleting B's "m1" must not touch A's "m1".
    store::delete_messages(&mut db.conn(), b.id, &["m1".into()]).unwrap();
    assert_eq!(list(&db, AccountFilter::Only(vec![a.id]), INBOX).len(), 1);

    // Removing account B removes only B's data.
    accounts::remove(&db.conn(), b.id).unwrap();
    assert_eq!(
        list(
            &db,
            AccountFilter::All,
            MailView::Search {
                text: "snippet".into()
            }
        )
        .len(),
        1
    );
    assert_eq!(
        query::user_labels(&db.conn(), &AccountFilter::All)
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn label_from_another_account_is_rejected_by_the_schema() {
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db, "sub-a", "a@x.com");
    let b = add_account(&db, "sub-b", "b@x.com");
    store::sync_labels(&mut db.conn(), b.id, &work_label()).unwrap();
    store::upsert_thread(
        &mut db.conn(),
        a.id,
        &thread("t1", "m1", "x@x.com", "s", 1, &[]),
    )
    .unwrap();
    let conn = db.conn();
    let b_label: i64 = conn
        .query_row(
            "SELECT id FROM labels WHERE account_id = ?1 AND gmail_label_id = 'Label_1'",
            [b.id],
            |r| r.get(0),
        )
        .unwrap();
    let a_msg: i64 = conn
        .query_row(
            "SELECT id FROM messages WHERE account_id = ?1",
            [a.id],
            |r| r.get(0),
        )
        .unwrap();
    // Claiming the row is account A's while pointing at B's label fails the composite foreign key.
    let err = conn.execute(
        "INSERT INTO message_labels (account_id, message_id, label_id) VALUES (?1, ?2, ?3)",
        rusqlite::params![a.id, a_msg, b_label],
    );
    assert!(err.is_err());
}

#[test]
fn paging_walks_every_thread_once() {
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db, "sub-a", "a@x.com");
    let b = add_account(&db, "sub-b", "b@x.com");
    for i in 0..25 {
        let acct = if i % 2 == 0 { a.id } else { b.id };
        // Same timestamps for pairs, to exercise the tie-breaker.
        store::upsert_thread(
            &mut db.conn(),
            acct,
            &thread(
                &format!("t{i}"),
                &format!("m{i}"),
                "x@x.com",
                "s",
                (i / 2) as i64,
                &["INBOX"],
            ),
        )
        .unwrap();
    }
    let mut seen = Vec::new();
    let mut cursor = None;
    loop {
        let page = query::list_threads(
            &db.conn(),
            &ListQuery {
                accounts: AccountFilter::All,
                view: INBOX,
                cursor,
                limit: 7,
            },
        )
        .unwrap();
        seen.extend(page.threads.iter().map(|t| t.id));
        match page.next_cursor {
            Some(c) => cursor = Some(c),
            None => break,
        }
    }
    assert_eq!(seen.len(), 25);
    let mut dedup = seen.clone();
    dedup.sort();
    dedup.dedup();
    assert_eq!(dedup.len(), 25);
}

#[test]
fn all_mail_and_archive_views_across_accounts() {
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db, "sub-a", "a@x.com");
    let b = add_account(&db, "sub-b", "b@x.com");
    // Same Gmail IDs in both accounts, different states.
    store::upsert_thread(
        &mut db.conn(),
        a.id,
        &thread("t1", "m1", "x@x.com", "A inbox", 5, &["INBOX"]),
    )
    .unwrap();
    store::upsert_thread(
        &mut db.conn(),
        a.id,
        &thread("t2", "m2", "x@x.com", "A archived", 4, &["Label_1"]),
    )
    .unwrap();
    store::upsert_thread(
        &mut db.conn(),
        a.id,
        &thread("t3", "m3", "x@x.com", "A spam", 3, &["SPAM"]),
    )
    .unwrap();
    store::upsert_thread(
        &mut db.conn(),
        b.id,
        &thread("t1", "m1", "y@y.com", "B archived", 6, &[]),
    )
    .unwrap();
    store::upsert_thread(
        &mut db.conn(),
        b.id,
        &thread("t2", "m2", "y@y.com", "B trash", 2, &["TRASH"]),
    )
    .unwrap();
    store::upsert_thread(
        &mut db.conn(),
        b.id,
        &thread("t3", "m3", "y@y.com", "B sent", 1, &["SENT"]),
    )
    .unwrap();

    let subjects = |filter, view| -> Vec<String> {
        list(&db, filter, view)
            .into_iter()
            .map(|t| t.subject)
            .collect()
    };

    // All Mail: everything but Spam and Trash, unified and newest first.
    assert_eq!(
        subjects(AccountFilter::All, MailView::AllMail),
        vec!["B archived", "A inbox", "A archived", "B sent"]
    );
    // Archive: All Mail minus Inbox. Sent-only threads are archived too.
    assert_eq!(
        subjects(AccountFilter::All, MailView::Archive),
        vec!["B archived", "A archived", "B sent"]
    );
    assert_eq!(
        subjects(AccountFilter::Only(vec![a.id]), MailView::Archive),
        vec!["A archived"]
    );
    // Spam and Trash still have their own (system label) views.
    assert_eq!(
        subjects(
            AccountFilter::All,
            MailView::System {
                label: SystemLabel::Spam
            }
        ),
        vec!["A spam"]
    );
    assert_eq!(
        subjects(
            AccountFilter::All,
            MailView::System {
                label: SystemLabel::Trash
            }
        ),
        vec!["B trash"]
    );
    // Search skips Spam and Trash, like Gmail.
    assert_eq!(
        subjects(
            AccountFilter::All,
            MailView::Search {
                text: "spam".into()
            }
        ),
        Vec::<String>::new()
    );
    assert_eq!(
        subjects(
            AccountFilter::All,
            MailView::Search {
                text: "archived".into()
            }
        ),
        vec!["B archived", "A archived"]
    );
}
