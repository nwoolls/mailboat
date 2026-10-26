//! Demo mode's made-up Google, driven by the app's real Gmail client and
//! sync: the demo mail syncs, sending lands in Sent and gets an answer,
//! scheduled mail arrives, and searches, labels and drafts work.

use std::time::Duration;

use mail_core::compose::mime::{self, MimeMessage};
use mail_core::db::{accounts, query, Db};
use mail_core::demo::{self, DemoData, FakeGoogle, Timing};
use mail_core::gmail::GmailClient;
use mail_core::model::*;
use mail_core::sync::*;

fn quick() -> Timing {
    Timing {
        reply_after: Duration::from_millis(50),
        arrivals: 0.002,
    }
}

async fn start() -> (FakeGoogle, DemoData) {
    let data = DemoData::builtin();
    (
        FakeGoogle::start(data.clone(), quick()).await.unwrap(),
        data,
    )
}

fn add_account(db: &Db, email: &str) -> AccountId {
    accounts::upsert(
        &db.conn(),
        &accounts::NewAccount {
            google_sub: email,
            email,
            display_name: None,
            avatar_url: None,
            oauth_client: "demo",
        },
    )
    .unwrap()
    .id
}

async fn sync(db: &Db, gmail: &GmailClient, account: AccountId) -> SyncOutcome {
    let config = SyncConfig {
        body_prefetch: 5,
        ..SyncConfig::default()
    };
    let progress = |_: SyncProgress| {};
    SyncEngine {
        db,
        gmail,
        account,
        config: &config,
        progress: &progress,
    }
    .run()
    .await
    .unwrap()
}

fn view(db: &Db, view: MailView) -> Vec<ThreadSummary> {
    query::list_threads(
        &db.conn(),
        &ListQuery {
            accounts: AccountFilter::All,
            view,
            cursor: None,
            limit: 200,
        },
    )
    .unwrap()
    .threads
}

fn inbox(db: &Db) -> Vec<ThreadSummary> {
    view(
        db,
        MailView::System {
            label: SystemLabel::Inbox,
        },
    )
}

fn subject_in<'a>(threads: &'a [ThreadSummary], subject: &str) -> &'a ThreadSummary {
    threads
        .iter()
        .find(|t| t.subject == subject)
        .unwrap_or_else(|| panic!("no conversation \"{subject}\""))
}

#[tokio::test]
async fn both_demo_accounts_sync_into_a_unified_inbox() {
    let (google, data) = start().await;
    let db = Db::open_in_memory().unwrap();
    for account in &data.accounts {
        let id = add_account(&db, &account.email);
        let gmail = demo::client(reqwest::Client::new(), &google, &account.email);
        let outcome = sync(&db, &gmail, id).await;
        assert_eq!(outcome.kind, SyncKind::Full);
    }
    let inbox = inbox(&db);
    let accounts: std::collections::BTreeSet<_> = inbox.iter().map(|t| t.account_id).collect();
    assert_eq!(accounts.len(), 2, "mail from both accounts");

    let lisbon = subject_in(&inbox, "Lisbon in May?");
    assert_eq!(lisbon.message_count, 4);
    assert!(lisbon.unread && lisbon.starred && lisbon.has_attachments);
    assert_eq!(lisbon.label_ids.len(), 1, "Travel");
    let names: Vec<_> = lisbon.senders.iter().map(|s| s.name.clone()).collect();
    assert!(names.contains(&Some("Maya Chen".into())), "{names:?}");

    // Non-ASCII names come through decoded, as Gmail gives them.
    let casa = subject_in(&inbox, "Your stay at Casa Azul");
    assert_eq!(casa.senders[0].name.as_deref(), Some("Tomás Silva"));

    // Sent, drafts, spam and trash are where Gmail keeps them.
    let sent = view(
        &db,
        MailView::System {
            label: SystemLabel::Sent,
        },
    );
    subject_in(&sent, "That book I mentioned");
    let drafts = view(
        &db,
        MailView::System {
            label: SystemLabel::Draft,
        },
    );
    assert!(subject_in(&drafts, "Packing list").only_draft);
    let spam = view(
        &db,
        MailView::System {
            label: SystemLabel::Spam,
        },
    );
    assert!(subject_in(&spam, "You've been selected!!! Claim your prize now").in_spam);
    let trash = view(
        &db,
        MailView::System {
            label: SystemLabel::Trash,
        },
    );
    assert!(subject_in(&trash, "Autumn notebooks are here").in_trash);
    assert!(
        !inbox.iter().any(|t| t.subject.starts_with("You've been")),
        "spam stays out of the Inbox"
    );
}

#[tokio::test]
async fn bodies_attachments_and_the_original_come_from_the_real_message() {
    let (google, data) = start().await;
    let db = Db::open_in_memory().unwrap();
    let email = &data.accounts[0].email;
    let id = add_account(&db, email);
    let gmail = demo::client(reqwest::Client::new(), &google, email);
    sync(&db, &gmail, id).await;
    let lisbon = subject_in(&inbox(&db), "Lisbon in May?").id;
    let detail = query::thread_detail(&db.conn(), lisbon).unwrap();
    let newest = detail.messages.last().unwrap().id;
    let body = fetch_body(&db, &gmail, newest).await.unwrap();
    assert!(body.text.unwrap().contains("book by Friday"));
    let files = mail_core::db::store::attachments_for(&db.conn(), newest).unwrap();
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].filename, "Lisbon itinerary.pdf");

    let gmail_id = mail_core::db::store::message_gmail_ref(&db.conn(), newest)
        .unwrap()
        .1;
    let raw = gmail.message_raw(&gmail_id).await.unwrap();
    let raw = String::from_utf8_lossy(&raw);
    assert!(raw.contains("Message-ID:") && raw.contains("In-Reply-To:"));
}

#[tokio::test]
async fn sending_lands_in_sent_and_the_other_person_answers() {
    let data = DemoData::builtin();
    // No scheduled mail arriving meanwhile.
    let timing = Timing {
        arrivals: 1000.0,
        ..quick()
    };
    let google = FakeGoogle::start(data.clone(), timing).await.unwrap();
    let db = Db::open_in_memory().unwrap();
    let account = &data.accounts[0];
    let id = add_account(&db, &account.email);
    let gmail = demo::client(reqwest::Client::new(), &google, &account.email);
    sync(&db, &gmail, id).await;
    let lisbon = subject_in(&inbox(&db), "Lisbon in May?").clone();
    let thread_gmail_id = {
        let conn = db.conn();
        conn.query_row(
            "SELECT gmail_thread_id FROM threads WHERE id = ?1",
            [lisbon.id],
            |r| r.get::<_, String>(0),
        )
        .unwrap()
    };
    let raw = mime::build(&MimeMessage {
        from: Address {
            name: Some(account.name.clone()),
            email: account.email.clone(),
        },
        to: vec![Address {
            name: Some("Maya Chen".into()),
            email: "maya@chen.example".into(),
        }],
        subject: "Re: Lisbon in May?".into(),
        text: "Yes, book it!".into(),
        ..Default::default()
    })
    .unwrap();
    gmail
        .send_message(&raw, Some(&thread_gmail_id))
        .await
        .unwrap();

    let outcome = sync(&db, &gmail, id).await;
    assert_eq!(outcome.kind, SyncKind::Incremental);
    let after = subject_in(&inbox(&db), "Lisbon in May?").clone();
    assert_eq!(
        after.message_count, 5,
        "the sent reply joins the conversation"
    );

    tokio::time::sleep(Duration::from_millis(200)).await;
    let outcome = sync(&db, &gmail, id).await;
    assert_eq!(
        outcome.new_inbox.len(),
        1,
        "Maya's answer arrives as new mail"
    );
    let after = subject_in(&inbox(&db), "Lisbon in May?").clone();
    assert_eq!(after.message_count, 6);
    assert!(after.unread);
    let body = fetch_body(&db, &gmail, outcome.new_inbox[0]).await.unwrap();
    assert!(body.text.unwrap().contains("book the apartment tonight"));
}

#[tokio::test]
async fn scheduled_mail_arrives_later() {
    let (google, data) = start().await;
    let db = Db::open_in_memory().unwrap();
    let email = &data.accounts[0].email;
    let id = add_account(&db, email);
    let gmail = demo::client(reqwest::Client::new(), &google, email);
    // The sign-in code is due 45 s in, scaled to 90 ms here.
    let arrived = |db: &Db| {
        inbox(db)
            .iter()
            .any(|t| t.subject == "Your Harbor Bank sign-in code")
    };
    sync(&db, &gmail, id).await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    let outcome = sync(&db, &gmail, id).await;
    assert!(arrived(&db));
    let codes = mail_core::mail::codes::in_messages(&db.conn(), &outcome.new_inbox).unwrap();
    assert_eq!(codes.0.len(), 1, "the code shows as it arrives");
    assert_eq!(codes.0[0].code, "482913");
}

#[tokio::test]
async fn searches_labels_and_actions_work_like_gmail() {
    let (google, data) = start().await;
    let db = Db::open_in_memory().unwrap();
    let email = &data.accounts[1].email;
    let id = add_account(&db, email);
    let gmail = demo::client(reqwest::Client::new(), &google, email);
    sync(&db, &gmail, id).await;

    let found = gmail
        .search_threads(None, Some("from:lena has:attachment"), false, None, 50)
        .await
        .unwrap();
    assert_eq!(found.threads.len(), 1);
    let none = gmail
        .search_threads(None, Some("from:lena -fernhill"), false, None, 50)
        .await
        .unwrap();
    assert!(none.threads.is_empty());

    let label = gmail.create_label("Ideas").await.unwrap();
    let thread = &found.threads[0].id;
    gmail
        .modify_thread(thread, &[label.id.as_str()], &["INBOX"])
        .await
        .unwrap();
    sync(&db, &gmail, id).await;
    assert!(
        !inbox(&db)
            .iter()
            .any(|t| t.subject == "Fernhill rebrand: round 2 feedback"),
        "archived"
    );
    let labelled = gmail
        .search_threads(Some(&label.id), None, false, None, 50)
        .await
        .unwrap();
    assert_eq!(labelled.threads.len(), 1);

    let drafts = gmail.list_drafts().await.unwrap();
    assert!(drafts.drafts.is_empty(), "the work account has no drafts");
    let filters = gmail.filters().await.unwrap();
    assert!(filters.filter.is_empty());
    let send_as = gmail.send_as().await.unwrap();
    assert!(send_as.send_as[0]
        .signature
        .as_deref()
        .unwrap()
        .contains("Northwind"));
}

#[tokio::test]
async fn another_account_s_token_sees_only_its_own_mail() {
    let (google, data) = start().await;
    let personal = demo::client(reqwest::Client::new(), &google, &data.accounts[0].email);
    let work = demo::client(reqwest::Client::new(), &google, &data.accounts[1].email);
    let mine = personal
        .search_threads(None, Some("lisbon"), false, None, 50)
        .await
        .unwrap();
    assert!(!mine.threads.is_empty());
    let theirs = work
        .search_threads(None, Some("lisbon"), false, None, 50)
        .await
        .unwrap();
    assert!(theirs.threads.is_empty());
    let stranger = demo::client(reqwest::Client::new(), &google, "nobody@x.example");
    assert!(stranger.profile().await.is_err());
}

#[tokio::test]
async fn prepare_adds_the_accounts_synced_with_their_summaries() {
    let (google, data) = start().await;
    let db = Db::open_in_memory().unwrap();
    let added = demo::prepare(&db, &reqwest::Client::new(), &google, &data)
        .await
        .unwrap();
    assert_eq!(added.len(), data.accounts.len());
    let all = accounts::list(&db.conn()).unwrap();
    assert!(all.iter().all(|a| a.missing_permissions.is_empty()));
    assert_eq!(all[0].color, data.accounts[0].color.clone().unwrap());
    let inbox = inbox(&db);
    let lisbon = subject_in(&inbox, "Lisbon in May?").id;
    let lines = mail_core::ai::summaries::current_lines(&db.conn(), &[lisbon]).unwrap();
    assert_eq!(lines.len(), 1);
    assert!(lines[0].text.starts_with("Maya found flights"));
}
