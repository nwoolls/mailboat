//! Signatures and the vacation responder go to the owning account's Gmail
//! settings and keep the cache in step.

mod common;

use common::*;
use mail_core::auth::oauth::GMAIL_SETTINGS_SCOPE;
use mail_core::compose::identities;
use mail_core::db::{accounts, Db};
use mail_core::gmail::types::SendAs;
use mail_core::model::*;
use mail_core::vacation::{self, VacationSettings, VacationState};
use mail_core::CoreError;
use serde_json::json;
use wiremock::matchers::{body_json, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn setup(email: &str) -> (Db, AccountId) {
    let db = Db::open_in_memory().unwrap();
    let a = accounts::upsert(
        &db.conn(),
        &accounts::NewAccount {
            google_sub: "a",
            email,
            display_name: None,
            avatar_url: None,
            oauth_client: "default",
        },
    )
    .unwrap()
    .id;
    accounts::set_granted_scopes(&db.conn(), a, &[GMAIL_SETTINGS_SCOPE.to_string()]).unwrap();
    (db, a)
}

fn send_as(email: &str, primary: bool) -> SendAs {
    serde_json::from_value(json!({
        "sendAsEmail": email, "isPrimary": primary, "isDefault": primary,
        "signature": "<b>Old</b>"
    }))
    .unwrap()
}

#[tokio::test]
async fn changing_a_signature_stores_what_gmail_kept() {
    let server = MockServer::start().await;
    Mock::given(method("PATCH"))
        .and(path("/gmail/v1/users/me/settings/sendAs/alias+work@x.com"))
        .and(body_json(json!({ "signature": "<p>Jordan</p>" })))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "sendAsEmail": "alias+work@x.com", "signature": "<div>Jordan</div>"
        })))
        .expect(1)
        .mount(&server)
        .await;
    let (db, a) = setup("a@x.com");
    identities::store(
        &mut db.conn(),
        a,
        &[send_as("a@x.com", true), send_as("alias+work@x.com", false)],
    )
    .unwrap();
    let (gmail, _) = client(&server.uri());

    let kept = identities::set_signature(&db, &gmail, a, "Alias+Work@x.com", "  <p>Jordan</p> ")
        .await
        .unwrap();
    assert_eq!(kept.as_deref(), Some("<div>Jordan</div>"));
    let list = identities::list(&db.conn()).unwrap();
    let alias = list.iter().find(|i| i.email == "alias+work@x.com").unwrap();
    assert_eq!(alias.signature.as_deref(), Some("<div>Jordan</div>"));
    let main = list.iter().find(|i| i.email == "a@x.com").unwrap();
    assert_eq!(
        main.signature.as_deref(),
        Some("<b>Old</b>"),
        "others untouched"
    );
}

#[tokio::test]
async fn signatures_only_for_your_own_addresses_and_within_gmails_limit() {
    let server = MockServer::start().await;
    let (db, a) = setup("a@x.com");
    let (gmail, _) = client(&server.uri());
    let err = identities::set_signature(&db, &gmail, a, "someone@else.com", "hi")
        .await
        .unwrap_err();
    assert!(matches!(err, CoreError::NotFound(_)), "{err:?}");
    let long = "x".repeat(identities::SIGNATURE_MAX + 1);
    let err = identities::set_signature(&db, &gmail, a, "a@x.com", &long)
        .await
        .unwrap_err();
    assert!(matches!(err, CoreError::Invalid(_)), "{err:?}");
    assert!(server.received_requests().await.unwrap().is_empty());
}

#[tokio::test]
async fn reads_and_saves_the_vacation_responder() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/gmail/v1/users/me/settings/vacation"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "enableAutoReply": false, "responseSubject": "Away",
            "responseBodyPlainText": "Back soon"
        })))
        .mount(&server)
        .await;
    Mock::given(method("PUT"))
        .and(path("/gmail/v1/users/me/settings/vacation"))
        .and(body_json(json!({
            "enableAutoReply": true,
            "responseSubject": "Away",
            "responseBodyPlainText": "Back Monday",
            "responseBodyHtml": "<p>Back Monday</p>",
            "restrictToContacts": true,
            "restrictToDomain": false,
            "startTime": "1000"
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "enableAutoReply": true, "responseSubject": "Away",
            "responseBodyPlainText": "Back Monday", "responseBodyHtml": "<p>Back Monday</p>",
            "restrictToContacts": true, "startTime": "1000"
        })))
        .expect(1)
        .mount(&server)
        .await;
    let (db, a) = setup("me@gmail.com");
    let (gmail, _) = client(&server.uri());

    let got = vacation::get(&db, &gmail, a).await.unwrap();
    let VacationState::Ready {
        settings,
        can_limit_to_domain,
        active,
    } = got.state
    else {
        panic!("{got:?}");
    };
    assert!(!active);
    assert!(!can_limit_to_domain, "@gmail.com has no organization");
    assert_eq!(settings.body_html, "Back soon");

    let next = VacationSettings {
        enabled: true,
        body_html: "<p>Back Monday</p>".into(),
        body_text: "Back Monday".into(),
        contacts_only: true,
        // Not offered for @gmail.com, so not sent as on.
        domain_only: true,
        start: Some(1000),
        ..settings
    };
    let saved = vacation::set(&db, &gmail, a, &next).await.unwrap();
    let VacationState::Ready {
        settings, active, ..
    } = saved.state
    else {
        panic!("{saved:?}");
    };
    assert!(settings.enabled);
    assert!(active, "started long ago, no end");
}

#[tokio::test]
async fn vacation_without_the_permission_asks_to_sign_in_again() {
    let server = MockServer::start().await;
    let (db, a) = setup("a@x.com");
    accounts::set_granted_scopes(&db.conn(), a, &["openid".to_string()]).unwrap();
    let (gmail, _) = client(&server.uri());
    let got = vacation::get(&db, &gmail, a).await.unwrap();
    assert_eq!(got.state, VacationState::NeedsSignIn);
    assert!(server.received_requests().await.unwrap().is_empty());
}
