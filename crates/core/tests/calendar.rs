//! Meeting invitations: the calendar part kept with a fetched body, then
//! Google Calendar (stood in for by wiremock) for your answer, clashes,
//! answering and adding invitations that aren't on the calendar.

mod common;

use common::*;
use mail_core::auth::oauth::{CALENDAR_SCOPE, LEGACY_CALENDAR_SCOPE, SCOPES};
use mail_core::calendar::{self, CalendarState};
use mail_core::db::{accounts, store, Db};
use mail_core::gmail::parse;
use mail_core::gmail::types::Thread;
use mail_core::mail::invite::{Answer, InviteKind, Moment};
use mail_core::model::*;
use mail_core::sync::fetch_body;
use wiremock::matchers::{body_json, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

const ICS: &str = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\n\
DTSTART:20261020T180000Z\r\nDTEND:20261020T183000Z\r\n\
ORGANIZER;CN=Pat:mailto:pat@example.com\r\nUID:abc123@invite.example\r\n\
ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:a@x.example\r\nSEQUENCE:0\r\n\
SUMMARY:Design review\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

/// One account (a@x.example) with thread t1; returns its message m2.
fn setup(granted: &[&str]) -> (Db, MessageId) {
    let db = Db::open_in_memory().unwrap();
    let account = accounts::upsert(
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
    let granted: Vec<String> = granted.iter().map(|s| s.to_string()).collect();
    accounts::set_granted_scopes(&db.conn(), account, &granted).unwrap();
    let t: Thread = serde_json::from_str(&fixture("thread_t1.json")).unwrap();
    store::upsert_thread(&mut db.conn(), account, &parse::thread_to_incoming(&t)).unwrap();
    let m2: MessageId = db
        .conn()
        .query_row(
            "SELECT id FROM messages WHERE gmail_message_id = 'm2'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    (db, m2)
}

/// m2 as an invitation: text and HTML, plus the inline calendar part.
async fn serve_invitation(server: &MockServer) {
    let b64 = |s: &str| parse::encode_base64url(s.as_bytes());
    let message = serde_json::json!({
        "id": "m2", "threadId": "t1", "labelIds": ["INBOX"], "internalDate": "1760000500000",
        "payload": { "mimeType": "multipart/mixed", "headers": [], "parts": [
            { "mimeType": "multipart/alternative", "parts": [
                { "mimeType": "text/plain", "body": { "data": b64("You're invited") } },
                { "mimeType": "text/calendar", "body": { "data": b64(ICS) } }
            ]},
            { "partId": "2", "mimeType": "application/ics", "filename": "invite.ics",
              "body": { "attachmentId": "ICS1", "size": 400 } }
        ]}
    });
    Mock::given(method("GET"))
        .and(path("/gmail/v1/users/me/messages/m2"))
        .and(query_param("format", "full"))
        .respond_with(ResponseTemplate::new(200).set_body_json(message))
        .expect(1)
        .mount(server)
        .await;
}

fn event(answer: &str) -> serde_json::Value {
    serde_json::json!({
        "id": "ev1", "status": "confirmed", "summary": "Design review",
        "htmlLink": "https://calendar.google.com/event?eid=ev1",
        "start": { "dateTime": "2026-10-20T14:00:00-04:00" },
        "end": { "dateTime": "2026-10-20T14:30:00-04:00" },
        "attendees": [
            { "email": "pat@example.com", "organizer": true, "responseStatus": "accepted" },
            { "email": "a@x.example", "self": true, "responseStatus": answer }
        ]
    })
}

async fn serve_lookup(server: &MockServer, items: Vec<serde_json::Value>) {
    Mock::given(method("GET"))
        .and(path("/calendar/v3/calendars/primary/events"))
        .and(query_param("iCalUID", "abc123@invite.example"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(serde_json::json!({ "items": items })),
        )
        .mount(server)
        .await;
}

async fn serve_range(server: &MockServer) {
    Mock::given(method("GET"))
        .and(path("/calendar/v3/calendars/primary/events"))
        .and(query_param("singleEvents", "true"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({ "items": [
            event("needsAction"),
            { "id": "busy", "summary": "1:1 with Sam",
              "start": { "dateTime": "2026-10-20T14:15:00-04:00" },
              "end": { "dateTime": "2026-10-20T15:00:00-04:00" } },
            { "id": "free", "summary": "Focus", "transparency": "transparent",
              "start": { "dateTime": "2026-10-20T14:00:00-04:00" },
              "end": { "dateTime": "2026-10-20T16:00:00-04:00" } },
            { "id": "said-no", "summary": "Standup",
              "start": { "dateTime": "2026-10-20T14:00:00-04:00" },
              "end": { "dateTime": "2026-10-20T14:15:00-04:00" },
              "attendees": [{ "email": "a@x.example", "self": true, "responseStatus": "declined" }] },
            { "id": "day", "summary": "Offsite", "start": { "date": "2026-10-20" }, "end": { "date": "2026-10-21" } }
        ]})))
        .mount(server)
        .await;
}

#[tokio::test]
async fn shows_the_invitation_your_answer_and_clashes_then_answers() {
    let (db, m2) = setup(&SCOPES);
    let server = MockServer::start().await;
    serve_invitation(&server).await;
    serve_lookup(&server, vec![event("needsAction")]).await;
    serve_range(&server).await;
    let (gmail, _) = client(&server.uri());

    // Opening the message keeps its calendar part (one Gmail fetch only).
    fetch_body(&db, &gmail, m2).await.unwrap();
    let card = calendar::card_for(&db, &gmail, m2).await.unwrap().unwrap();
    assert_eq!(card.invite.kind, InviteKind::Request);
    assert_eq!(card.invite.title.as_deref(), Some("Design review"));
    assert_eq!(
        card.invite.start,
        Moment::At {
            ms: 1_792_519_200_000
        }
    );
    let CalendarState::OnCalendar {
        event_id,
        your_answer,
        clashes,
        cancelled,
        ..
    } = card.calendar
    else {
        panic!(
            "expected the event on the calendar, got {:?}",
            card.calendar
        );
    };
    assert_eq!(event_id, "ev1");
    assert_eq!(your_answer, Some(Answer::NeedsAction));
    assert!(!cancelled);
    // Only the 1:1: not the event itself, "free" time, a declined
    // meeting or an all-day event.
    let titles: Vec<_> = clashes.iter().filter_map(|c| c.title.as_deref()).collect();
    assert_eq!(titles, ["1:1 with Sam"]);

    Mock::given(method("PATCH"))
        .and(path("/calendar/v3/calendars/primary/events/ev1"))
        .and(query_param("sendUpdates", "all"))
        .and(body_json(serde_json::json!({
            "attendeesOmitted": true,
            "attendees": [{ "email": "a@x.example", "responseStatus": "accepted" }]
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(event("accepted")))
        .expect(1)
        .mount(&server)
        .await;
    calendar::answer(&db, &gmail, m2, Answer::Yes)
        .await
        .unwrap();
}

#[tokio::test]
async fn an_account_that_granted_the_old_calendar_scope_still_reads_the_calendar() {
    // Signed in before the app asked only for calendars you own.
    let granted: Vec<&str> = SCOPES
        .iter()
        .map(|s| {
            if *s == CALENDAR_SCOPE {
                LEGACY_CALENDAR_SCOPE
            } else {
                s
            }
        })
        .collect();
    let (db, m2) = setup(&granted);
    let server = MockServer::start().await;
    serve_invitation(&server).await;
    serve_lookup(&server, vec![event("needsAction")]).await;
    serve_range(&server).await;
    let (gmail, _) = client(&server.uri());
    fetch_body(&db, &gmail, m2).await.unwrap();
    let card = calendar::card_for(&db, &gmail, m2).await.unwrap().unwrap();
    assert!(
        matches!(card.calendar, CalendarState::OnCalendar { .. }),
        "expected the event on the calendar, got {:?}",
        card.calendar
    );
}

#[tokio::test]
async fn an_account_without_the_calendar_permission_is_asked_to_sign_in_again() {
    let granted: Vec<&str> = SCOPES
        .iter()
        .copied()
        .filter(|s| *s != CALENDAR_SCOPE)
        .collect();
    let (db, m2) = setup(&granted);
    let server = MockServer::start().await;
    serve_invitation(&server).await;
    // Calendar isn't asked at all.
    Mock::given(method("GET"))
        .and(path("/calendar/v3/calendars/primary/events"))
        .respond_with(ResponseTemplate::new(500))
        .expect(0)
        .mount(&server)
        .await;
    let (gmail, _) = client(&server.uri());
    fetch_body(&db, &gmail, m2).await.unwrap();
    let card = calendar::card_for(&db, &gmail, m2).await.unwrap().unwrap();
    assert_eq!(card.calendar, CalendarState::NeedsSignIn);
    assert_eq!(card.invite.your_answer, Some(Answer::NeedsAction));
}

#[tokio::test]
async fn an_invitation_not_on_the_calendar_is_added_then_answered() {
    let (db, m2) = setup(&SCOPES);
    let server = MockServer::start().await;
    serve_invitation(&server).await;
    serve_lookup(&server, vec![]).await;
    let (gmail, _) = client(&server.uri());
    fetch_body(&db, &gmail, m2).await.unwrap();
    let card = calendar::card_for(&db, &gmail, m2).await.unwrap().unwrap();
    assert_eq!(card.calendar, CalendarState::NotOnCalendar);

    Mock::given(method("POST"))
        .and(path("/calendar/v3/calendars/primary/events/import"))
        .and(body_json(serde_json::json!({
            "iCalUID": "abc123@invite.example",
            "sequence": 0,
            "summary": "Design review",
            "location": null,
            "start": { "dateTime": "2026-10-20T18:00:00Z" },
            "end": { "dateTime": "2026-10-20T18:30:00Z" },
            "organizer": { "email": "pat@example.com", "displayName": "Pat" },
            "attendees": [{ "email": "a@x.example", "responseStatus": "needsAction" }]
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(event("needsAction")))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("PATCH"))
        .and(path("/calendar/v3/calendars/primary/events/ev1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(event("tentative")))
        .expect(1)
        .mount(&server)
        .await;
    calendar::answer(&db, &gmail, m2, Answer::Maybe)
        .await
        .unwrap();
}

#[tokio::test]
async fn a_message_without_a_calendar_part_has_no_card_and_costs_nothing_more() {
    let (db, m2) = setup(&SCOPES);
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/gmail/v1/users/me/messages/m2"))
        .respond_with(ResponseTemplate::new(200).set_body_raw(
            fixture("message_m3_full.json").replace("\"m3\"", "\"m2\""),
            "application/json",
        ))
        .expect(1)
        .mount(&server)
        .await;
    let (gmail, _) = client(&server.uri());
    fetch_body(&db, &gmail, m2).await.unwrap();
    assert_eq!(calendar::card_for(&db, &gmail, m2).await.unwrap(), None);
    assert_eq!(calendar::card_for(&db, &gmail, m2).await.unwrap(), None);
}

#[tokio::test]
async fn when_calendar_refuses_the_event_the_answer_goes_by_email() {
    let (db, m2) = setup(&SCOPES);
    let server = MockServer::start().await;
    serve_invitation(&server).await;
    serve_lookup(&server, vec![]).await;
    Mock::given(method("POST"))
        .and(path("/calendar/v3/calendars/primary/events/import"))
        .respond_with(ResponseTemplate::new(400).set_body_json(serde_json::json!({
            "error": { "code": 400, "message": "Invalid time zone definition", "errors": [] }
        })))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/upload/gmail/v1/users/me/messages/send"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(serde_json::json!({ "id": "s1", "threadId": "t9" })),
        )
        .expect(1)
        .mount(&server)
        .await;
    let (gmail, _) = client(&server.uri());
    fetch_body(&db, &gmail, m2).await.unwrap();

    let card = calendar::answer(&db, &gmail, m2, Answer::No).await.unwrap();
    assert_eq!(
        card.calendar,
        CalendarState::RepliedByEmail {
            your_answer: Answer::No
        }
    );
    // To the organizer, from the invited address, with the calendar reply.
    let requests = server.received_requests().await.unwrap();
    let sent = requests
        .iter()
        .find(|r| r.url.path().ends_with("/messages/send"))
        .unwrap();
    let raw = String::from_utf8_lossy(&sent.body);
    assert!(
        raw.contains("To: \"Pat\" <pat@example.com>") || raw.contains("To: Pat <pat@example.com>"),
        "{raw}"
    );
    assert!(raw.contains("Subject: Declined: Design review"), "{raw}");
    assert!(
        raw.contains("method=REPLY") || raw.contains("method=\"REPLY\""),
        "{raw}"
    );
    assert!(raw.contains("METHOD:REPLY"), "{raw}");
    assert!(raw.contains("PARTSTAT=DECLINED"), "{raw}");
}
