//! "Delete all data": the database ends up empty but for its own
//! bookkeeping, whatever was in it.

use mail_core::ai::summaries::{self, SummaryKind};
use mail_core::ai::AiProvider;
use mail_core::db::store::{self, IncomingMessage, IncomingThread, StoredBody};
use mail_core::db::{accounts, erase, Db};
use mail_core::model::{Address, MessageId, ThreadId};
use mail_core::settings::{self, AppSettings, Theme};

fn add_account(db: &Db, sub: &str) -> mail_core::model::AccountId {
    accounts::upsert(
        &db.conn(),
        &accounts::NewAccount {
            google_sub: sub,
            email: &format!("{sub}@x.example"),
            display_name: None,
            avatar_url: None,
            oauth_client: "default",
        },
    )
    .unwrap()
    .id
}

fn count(db: &Db, table: &str) -> i64 {
    db.conn()
        .query_row(&format!("SELECT COUNT(*) FROM \"{table}\""), [], |r| {
            r.get(0)
        })
        .unwrap()
}

/// Every table a person's data can be in (the search index too), found in
/// the database so one added later is held to the same test.
fn data_tables(db: &Db) -> Vec<String> {
    let conn = db.conn();
    let mut stmt = conn
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .unwrap();
    let names: Vec<String> = stmt
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    names
        .into_iter()
        .filter(|n| !["schema_migrations", "account_id_seq"].contains(&n.as_str()))
        // The search index's own tables are emptied through it.
        .filter(|n| {
            !["data", "idx", "content", "docsize", "config"]
                .iter()
                .any(|part| *n == format!("messages_fts_{part}"))
        })
        .collect()
}

#[test]
fn erasing_empties_every_table_but_the_databases_own_bookkeeping() {
    let db = Db::open_in_memory().unwrap();
    // Two accounts, with the same Gmail IDs (only unique per account).
    for sub in ["sub-a", "sub-b"] {
        let account = add_account(&db, sub);
        let mut conn = db.conn();
        store::upsert_thread(
            &mut conn,
            account,
            &IncomingThread {
                gmail_thread_id: "t1".into(),
                messages: vec![IncomingMessage {
                    gmail_message_id: "m1".into(),
                    label_ids: vec!["INBOX".into()],
                    internal_date: 1_700_000_000_000,
                    subject: "A made-up subject".into(),
                    snippet: "A made-up snippet".into(),
                    from: Some(Address {
                        name: Some("Maya Chen".into()),
                        email: "maya@x.example".into(),
                    }),
                    ..Default::default()
                }],
            },
        )
        .unwrap();
        let message: MessageId = conn
            .query_row(
                "SELECT id FROM messages WHERE account_id = ?1",
                [account],
                |r| r.get(0),
            )
            .unwrap();
        let thread: ThreadId = conn
            .query_row(
                "SELECT thread_id FROM messages WHERE id = ?1",
                [message],
                |r| r.get(0),
            )
            .unwrap();
        store::set_body(
            &mut conn,
            message,
            &StoredBody {
                html: Some("<p>Made-up body</p>".into()),
                text: None,
            },
            &[],
        )
        .unwrap();
        summaries::store(
            &conn,
            thread,
            SummaryKind::Line,
            AiProvider::Apple,
            message,
            "A summary",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO google_contacts (account_id, email, name, kind) VALUES (?1, 'p@x.example', 'P', 'saved')",
            [account],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO image_cache (account_id, url, mime, size, fetched_at, used_at)
             VALUES (?1, 'https://x.example/a.png', 'image/png', 1, 0, 0)",
            [account],
        )
        .unwrap();
    }
    {
        let conn = db.conn();
        let s = AppSettings {
            theme: Theme::Dark,
            ..AppSettings::default()
        };
        settings::save(&conn, &s).unwrap();
        store::set_sender_allows_images(&conn, "maya@x.example", true).unwrap();
        store::set_sender_original_colors(&conn, "maya@x.example", true).unwrap();
        conn.execute(
            "INSERT INTO ai_usage (at, provider, purpose, ok, input_tokens, output_tokens, cost_usd)
             VALUES (0, 'apple', 'summary', 1, 1, 1, NULL)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO mcp_log (at, client, tool, account_id, thread_id, detail, ok)
             VALUES (0, 'a client', 'search_mail', NULL, NULL, 'made up', 1)",
            [],
        )
        .unwrap();
    }
    // A table whose name only looks like the search index's shadow tables is
    // data like any other.
    db.conn()
        .execute_batch(
            "CREATE TABLE messages_fts_archive (note TEXT);
             INSERT INTO messages_fts_archive VALUES ('made up');",
        )
        .unwrap();
    // The test only means something if the data was there.
    let tables = data_tables(&db);
    for table in [
        "accounts",
        "threads",
        "messages",
        "message_bodies",
        "app_settings",
        "sender_image_prefs",
        "sender_color_prefs",
        "ai_summaries",
        "ai_usage",
        "mcp_log",
        "google_contacts",
        "image_cache",
        "messages_fts",
        "messages_fts_archive",
    ] {
        assert!(tables.iter().any(|t| t == table), "{table} is a table");
        assert!(count(&db, table) > 0, "{table} was seeded");
    }
    let migrations = count(&db, "schema_migrations");
    let last_id: i64 = db
        .conn()
        .query_row("SELECT last FROM account_id_seq", [], |r| r.get(0))
        .unwrap();

    erase::erase_all(&mut db.conn()).unwrap();

    for table in &tables {
        assert_eq!(count(&db, table), 0, "{table} is empty");
    }
    assert_eq!(settings::load(&db.conn()).unwrap(), AppSettings::default());
    assert_eq!(
        count(&db, "schema_migrations"),
        migrations,
        "the migrations are kept"
    );
    let after: i64 = db
        .conn()
        .query_row("SELECT last FROM account_id_seq", [], |r| r.get(0))
        .unwrap();
    assert_eq!(
        after, last_id,
        "an erased account's ID isn't given out again"
    );

    // And it works afterwards: a new account gets a new ID, and the search
    // index finds what is added.
    let again = add_account(&db, "sub-c");
    assert!(again.0 > last_id);
    store::upsert_thread(
        &mut db.conn(),
        again,
        &IncomingThread {
            gmail_thread_id: "t9".into(),
            messages: vec![IncomingMessage {
                gmail_message_id: "m9".into(),
                label_ids: vec!["INBOX".into()],
                internal_date: 1_700_000_000_000,
                subject: "A fresh made-up subject".into(),
                ..Default::default()
            }],
        },
    )
    .unwrap();
    let found: i64 = db
        .conn()
        .query_row(
            "SELECT COUNT(*) FROM messages_fts WHERE messages_fts MATCH 'fresh'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(found, 1);
}

#[test]
fn erasing_an_empty_database_is_fine() {
    let db = Db::open_in_memory().unwrap();
    erase::erase_all(&mut db.conn()).unwrap();
    erase::erase_all(&mut db.conn()).unwrap();
}
