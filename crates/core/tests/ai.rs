//! AI summaries against the cache, with a stand-in for Apple's helper (a
//! shell script). Guards the multi-account rules for summaries: two
//! accounts with the same Gmail IDs keep their own.
#![cfg(unix)]

use mail_core::ai::summaries::{self, SummaryKind};
use mail_core::ai::tasks::{self, Summarized, SummaryRequest};
use mail_core::ai::usage;
use mail_core::ai::{AiProvider, Programs};
use mail_core::db::store::{self, IncomingLabel, IncomingMessage, IncomingThread, StoredBody};
use mail_core::db::{accounts, Db};
use mail_core::model::*;

fn add_account(db: &Db, sub: &str, email: &str) -> AccountId {
    let id = accounts::upsert(
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
    .id;
    let labels: Vec<IncomingLabel> = ["INBOX", "SPAM", "DRAFT"]
        .iter()
        .map(|l| IncomingLabel {
            gmail_label_id: l.to_string(),
            name: l.to_string(),
            kind: LabelKind::System,
            color_bg: None,
            color_fg: None,
        })
        .collect();
    store::sync_labels(&mut db.conn(), id, &labels).unwrap();
    id
}

fn message(id: &str, date: i64, labels: &[&str]) -> IncomingMessage {
    IncomingMessage {
        gmail_message_id: id.into(),
        label_ids: labels.iter().map(|l| l.to_string()).collect(),
        internal_date: date,
        snippet: "snippet".into(),
        subject: "Plans".into(),
        from: Some(Address {
            name: Some("Sam".into()),
            email: "sam@example.com".into(),
        }),
        ..Default::default()
    }
}

/// Stores thread "t1" with the given messages; gives each a body.
fn put_thread(db: &Db, account: AccountId, messages: Vec<IncomingMessage>, body: &str) -> ThreadId {
    put_thread_named(db, account, "t1", messages, body)
}

fn put_thread_named(
    db: &Db,
    account: AccountId,
    gmail_thread_id: &str,
    messages: Vec<IncomingMessage>,
    body: &str,
) -> ThreadId {
    let thread = store::upsert_thread(
        &mut db.conn(),
        account,
        &IncomingThread {
            gmail_thread_id: gmail_thread_id.into(),
            messages,
        },
    )
    .unwrap();
    let ids: Vec<MessageId> = db
        .conn()
        .prepare("SELECT id FROM messages WHERE thread_id = ?1")
        .unwrap()
        .query_map([thread], |r| r.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    for id in ids {
        store::set_body(
            &mut db.conn(),
            id,
            &StoredBody {
                html: None,
                text: Some(body.into()),
            },
            &[],
        )
        .unwrap();
    }
    thread
}

/// Answers "Alpha summary" or "Beta summary" depending on the email it's given.
fn fake_apple() -> (Programs, std::path::PathBuf) {
    let dir = std::env::temp_dir().join(format!("ai-helper-test-{}", fastrand::u64(..)));
    std::fs::create_dir_all(&dir).unwrap();
    let helper = dir.join("ai-helper");
    std::fs::write(
        &helper,
        "#!/bin/sh\nif grep -q alpha; then w=Alpha; else w=Beta; fi\n\
         echo \"{\\\"type\\\":\\\"done\\\",\\\"text\\\":\\\"$w summary\\\"}\"\n",
    )
    .unwrap();
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&helper, std::fs::Permissions::from_mode(0o755)).unwrap();
    (
        Programs {
            apple: Some(helper),
            ..Default::default()
        },
        dir,
    )
}

fn line(thread: ThreadId) -> SummaryRequest {
    SummaryRequest {
        thread,
        kind: SummaryKind::Line,
        automatic: true,
        fresh: false,
    }
}

#[tokio::test]
async fn summaries_stay_with_their_account_and_go_stale_on_new_mail() {
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db, "a", "a@x.example");
    let b = add_account(&db, "b", "b@x.example");
    // Same Gmail thread and message IDs in both accounts.
    let ta = put_thread(
        &db,
        a,
        vec![message("m1", 1_000, &["INBOX"])],
        "alpha plans for Thursday",
    );
    let tb = put_thread(
        &db,
        b,
        vec![message("m1", 1_000, &["INBOX"])],
        "beta plans for Friday",
    );
    assert_ne!(ta, tb);
    let (programs, dir) = fake_apple();

    for t in [ta, tb] {
        let r = tasks::summarize(&db, None, &programs, AiProvider::Apple, line(t), &|_| {})
            .await
            .unwrap();
        assert!(matches!(r, Summarized::Done(..)));
    }
    let lines = summaries::current_lines(&db.conn(), &[ta, tb]).unwrap();
    let text = |t: ThreadId| {
        lines
            .iter()
            .find(|s| s.thread_id == t)
            .unwrap()
            .text
            .clone()
    };
    assert_eq!(text(ta), "Alpha summary");
    assert_eq!(text(tb), "Beta summary");

    // Asking again uses the cache: no new request.
    tasks::summarize(&db, None, &programs, AiProvider::Apple, line(ta), &|_| {})
        .await
        .unwrap();
    let used = usage::report(&db.conn(), 0).unwrap();
    let apple = used
        .iter()
        .find(|u| u.provider == AiProvider::Apple)
        .unwrap();
    assert_eq!(apple.today.requests, 2);

    // New mail in account A's conversation makes only its summary stale.
    put_thread(
        &db,
        a,
        vec![
            message("m1", 1_000, &["INBOX"]),
            message("m2", 2_000, &["INBOX"]),
        ],
        "alpha again",
    );
    assert!(summaries::current(&db.conn(), ta, SummaryKind::Line)
        .unwrap()
        .is_none());
    assert!(summaries::current(&db.conn(), tb, SummaryKind::Line)
        .unwrap()
        .is_some());
    // A draft reply doesn't count as new mail.
    put_thread(
        &db,
        b,
        vec![
            message("m1", 1_000, &["INBOX"]),
            message("d1", 3_000, &["DRAFT"]),
        ],
        "beta plans for Friday",
    );
    assert!(summaries::current(&db.conn(), tb, SummaryKind::Line)
        .unwrap()
        .is_some());

    // Removing an account removes its summaries with its mail.
    accounts::remove(&db.conn(), b).unwrap();
    assert!(summaries::current_lines(&db.conn(), &[tb])
        .unwrap()
        .is_empty());
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn automatic_summaries_skip_short_mail_and_spam() {
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db, "a", "a@x.example");
    let (programs, dir) = fake_apple();
    let short = put_thread(&db, a, vec![message("m1", 1_000, &["INBOX"])], "alpha: ok");
    let full = SummaryRequest {
        thread: short,
        kind: SummaryKind::Full,
        automatic: true,
        fresh: false,
    };
    let r = tasks::summarize(&db, None, &programs, AiProvider::Apple, full, &|_| {})
        .await
        .unwrap();
    assert!(matches!(r, Summarized::NotNeeded));
    // Asked for, it's summarized anyway.
    let asked = SummaryRequest {
        automatic: false,
        ..full
    };
    let r = tasks::summarize(&db, None, &programs, AiProvider::Apple, asked, &|_| {})
        .await
        .unwrap();
    assert!(matches!(r, Summarized::Done(s, _) if s.text == "Alpha summary"));

    let spam = put_thread(
        &db,
        a,
        vec![message("m1", 1_000, &["SPAM"])],
        &"alpha ".repeat(500),
    );
    let r = tasks::summarize(&db, None, &programs, AiProvider::Apple, line(spam), &|_| {})
        .await
        .unwrap();
    assert!(matches!(r, Summarized::NotNeeded));
    let _ = std::fs::remove_dir_all(dir);
}

/// The chips are saved per conversation, like summaries: asked once, then
/// instant until new mail arrives.
#[tokio::test]
async fn reply_ideas_are_saved_until_new_mail() {
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db, "a", "a@x.example");
    let b = add_account(&db, "b", "b@x.example");
    let t = put_thread(
        &db,
        a,
        vec![message("m1", 1_000, &["INBOX"])],
        "alpha plans",
    );
    let tb = put_thread(&db, b, vec![message("m1", 1_000, &["INBOX"])], "beta plans");
    let (programs, dir) = fake_apple();
    let ask = |thread| tasks::reply_ideas(&db, None, &programs, AiProvider::Apple, thread, false);
    assert_eq!(ask(t).await.unwrap().0, ["Alpha summary"]);
    assert_eq!(
        ask(tb).await.unwrap().0,
        ["Beta summary"],
        "per account, same Gmail IDs"
    );
    ask(t).await.unwrap();
    let requests = |db: &Db| {
        usage::report(&db.conn(), 0)
            .unwrap()
            .into_iter()
            .find(|u| u.provider == AiProvider::Apple)
            .unwrap()
            .today
            .requests
    };
    assert_eq!(requests(&db), 2, "the second time came from the saved copy");
    // A forward's chips are separate from a reply's.
    assert!(summaries::current_ideas(&db.conn(), t, true)
        .unwrap()
        .is_none());
    put_thread(
        &db,
        a,
        vec![
            message("m1", 1_000, &["INBOX"]),
            message("m2", 2_000, &["INBOX"]),
        ],
        "alpha again",
    );
    assert!(summaries::current_ideas(&db.conn(), t, false)
        .unwrap()
        .is_none());
    let _ = std::fs::remove_dir_all(dir);
}

/// A conversation that is a sign-in code gets a fixed line, with no request
/// to a model (models read such an email as already done).
#[tokio::test]
async fn a_sign_in_code_gets_a_fixed_line_and_asks_no_model() {
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db, "a", "a@x.example");
    let mut code = message("m1", 1_000, &["INBOX"]);
    code.subject = "Your login code".into();
    let thread = put_thread(
        &db,
        a,
        vec![code],
        "alpha Your login code is 482913. It expires in 10 minutes.",
    );
    let (programs, dir) = fake_apple();
    let r = tasks::summarize(
        &db,
        None,
        &programs,
        AiProvider::Apple,
        line(thread),
        &|_| {},
    )
    .await
    .unwrap();
    assert!(matches!(&r, Summarized::Done(s, answer)
        if s.text == tasks::SIGN_IN_LINE && answer.text.is_empty()));
    // No request was made, so nothing was counted.
    let used = usage::report(&db.conn(), 0).unwrap();
    assert!(
        used.iter().all(|p| p.last_30_days.requests == 0),
        "{used:?}"
    );
    let _ = std::fs::remove_dir_all(dir);
}

/// Only the newest email counts, read under its own subject and not when the
/// owner wrote it: a reply under a conversation titled with the code, or the
/// owner's own message with a number in it, is summarized as usual.
#[tokio::test]
async fn a_reply_or_the_owners_own_message_is_not_a_sign_in_code() {
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db, "a", "a@x.example");
    let (programs, dir) = fake_apple();
    // The conversation is titled by the first message, which holds a code;
    // the newest message is a plain reply under its own subject.
    let mut first = message("m1", 1_000, &["INBOX"]);
    first.subject = "Your login code is 482913".into();
    let mut reply = message("m2", 2_000, &["INBOX"]);
    reply.subject = "Thanks".into();
    let t1 = put_thread_named(
        &db,
        a,
        "r1",
        vec![first, reply],
        "alpha I'm signed in, thanks.",
    );
    // The owner's own message under a code-word subject, with a number in it.
    let mut mine = message("m3", 3_000, &["INBOX"]);
    mine.subject = "Your login code".into();
    mine.from = Some(Address {
        name: None,
        email: "a@x.example".into(),
    });
    let t2 = put_thread_named(&db, a, "r2", vec![mine], "alpha Room 12045 works for me.");
    for t in [t1, t2] {
        let r = tasks::summarize(&db, None, &programs, AiProvider::Apple, line(t), &|_| {})
            .await
            .unwrap();
        assert!(
            matches!(&r, Summarized::Done(s, _) if s.text == "Alpha summary"),
            "{t:?}"
        );
    }
    let _ = std::fs::remove_dir_all(dir);
}

/// In Spam a code is bait: no fixed line, even when the owner asks for a
/// summary; and a fixed line cached before the conversation moved there is
/// no longer shown.
#[tokio::test]
async fn a_sign_in_code_in_spam_gets_no_fixed_line() {
    let db = Db::open_in_memory().unwrap();
    let a = add_account(&db, "a", "a@x.example");
    let (programs, dir) = fake_apple();
    let mut bait = message("m1", 1_000, &["SPAM"]);
    bait.subject = "Your login code".into();
    let spam = put_thread_named(&db, a, "s1", vec![bait], "alpha Your login code is 482913.");
    let asked = SummaryRequest {
        automatic: false,
        ..line(spam)
    };
    let r = tasks::summarize(&db, None, &programs, AiProvider::Apple, asked, &|_| {})
        .await
        .unwrap();
    assert!(matches!(&r, Summarized::Done(s, _) if s.text == "Alpha summary"));
    // Automatic requests skip Spam altogether.
    let r = tasks::summarize(&db, None, &programs, AiProvider::Apple, line(spam), &|_| {})
        .await
        .unwrap();
    assert!(matches!(r, Summarized::Done(..) | Summarized::NotNeeded));

    // A conversation that was a code in the Inbox, then moved to Spam.
    let mut code = message("m2", 2_000, &["INBOX"]);
    code.subject = "Your login code".into();
    let moved = put_thread_named(&db, a, "s2", vec![code], "alpha Your login code is 482913.");
    tasks::summarize(
        &db,
        None,
        &programs,
        AiProvider::Apple,
        line(moved),
        &|_| {},
    )
    .await
    .unwrap();
    let shown = |thread: ThreadId| {
        summaries::current_lines(&db.conn(), &[thread])
            .unwrap()
            .first()
            .map(|s| s.text.clone())
    };
    assert_eq!(shown(moved).as_deref(), Some(tasks::SIGN_IN_LINE));
    db.conn()
        .execute(
            "INSERT INTO thread_labels (account_id, thread_id, label_id)
             SELECT ?2, ?1, id FROM labels WHERE account_id = ?2 AND gmail_label_id = 'SPAM'",
            rusqlite::params![moved, a],
        )
        .unwrap();
    assert_eq!(shown(moved), None);
    let _ = std::fs::remove_dir_all(dir);
}
