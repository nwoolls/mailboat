//! The vacation responder (Gmail's automatic reply), per account, through
//! `settings.getVacation` / `updateVacation`. Gmail sends the replies, so
//! they go out whether or not the app is open.

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::db::{accounts, Db};
use crate::error::{CoreError, Result};
use crate::gmail::parse::html_to_text;
use crate::gmail::types::Vacation;
use crate::gmail::GmailClient;
use crate::model::{AccountId, Permission};

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct VacationSettings {
    pub enabled: bool,
    pub subject: String,
    pub body_html: String,
    /// The same reply as plain text (Gmail sends it to mail apps that
    /// don't show HTML).
    pub body_text: String,
    /// Only reply to people in your contacts.
    pub contacts_only: bool,
    /// Only reply to people in your organization (Workspace accounts).
    pub domain_only: bool,
    /// When replies start and stop (Unix ms; the end is exclusive).
    pub start: Option<i64>,
    pub end: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum VacationState {
    #[serde(rename_all = "camelCase")]
    Ready {
        settings: VacationSettings,
        /// Gmail offers "only people in my organization" for Workspace
        /// accounts, not @gmail.com ones.
        can_limit_to_domain: bool,
        /// Replying right now (on, and within its dates).
        active: bool,
    },
    NeedsSignIn,
    Unavailable {
        message: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AccountVacation {
    pub account_id: AccountId,
    pub state: VacationState,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}

/// Whether Gmail is sending replies at `now`.
pub fn is_active(s: &VacationSettings, now: i64) -> bool {
    s.enabled && s.start.is_none_or(|t| t <= now) && s.end.is_none_or(|t| now < t)
}

fn can_limit_to_domain(email: &str) -> bool {
    let domain = email.rsplit('@').next().unwrap_or_default().to_lowercase();
    !matches!(domain.as_str(), "gmail.com" | "googlemail.com")
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn from_gmail(v: &Vacation) -> VacationSettings {
    // Gmail can return a reply saved as HTML with an empty plain-text part.
    // Keep a text version of it: the form treats an empty text as an emptied
    // message and would save the reply without it.
    let text = v
        .response_body_plain_text
        .clone()
        .filter(|t| !t.trim().is_empty())
        .or_else(|| v.response_body_html.as_deref().map(html_lines))
        .unwrap_or_default();
    let html = v
        .response_body_html
        .clone()
        .filter(|h| !h.trim().is_empty())
        .unwrap_or_else(|| text.lines().map(escape).collect::<Vec<_>>().join("<br>"));
    let time = |t: &Option<String>| t.as_deref().and_then(|t| t.parse::<i64>().ok());
    VacationSettings {
        enabled: v.enable_auto_reply,
        subject: v.response_subject.clone().unwrap_or_default(),
        body_html: html,
        body_text: text,
        contacts_only: v.restrict_to_contacts,
        domain_only: v.restrict_to_domain,
        start: time(&v.start_time),
        end: time(&v.end_time),
    }
}

/// The text of a reply's HTML, a line per line break or block.
fn html_lines(html: &str) -> String {
    let mut lines = Vec::new();
    let mut line = String::new();
    let mut rest = html;
    while let Some(open) = rest.find('<') {
        line.push_str(&rest[..open]);
        let tag = &rest[open..];
        let end = tag.find('>').map_or(tag.len(), |e| e + 1);
        let name = tag[1..end]
            .trim_start()
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '/')
            .collect::<String>()
            .to_ascii_lowercase();
        let breaks = matches!(
            name.as_str(),
            "br" | "/p" | "/div" | "/li" | "/tr" | "/blockquote"
        ) || (name.len() == 3
            && name.starts_with("/h")
            && name.ends_with(|c: char| c.is_ascii_digit()));
        if breaks {
            lines.push(html_to_text(&line));
            line.clear();
        } else {
            line.push_str(&tag[..end]);
        }
        rest = &tag[end..];
    }
    line.push_str(rest);
    lines.push(html_to_text(&line));
    lines.join("\n").trim().to_string()
}

fn to_gmail(s: &VacationSettings, can_limit_to_domain: bool) -> Result<Vacation> {
    if let (Some(start), Some(end)) = (s.start, s.end) {
        if end <= start {
            return Err(CoreError::Invalid(
                "The last day needs to be on or after the first day.".into(),
            ));
        }
    }
    if s.enabled && s.body_text.trim().is_empty() && s.subject.trim().is_empty() {
        return Err(CoreError::Invalid(
            "Write the reply (a subject or a message) before turning it on.".into(),
        ));
    }
    let some = |t: &str| (!t.trim().is_empty()).then(|| t.trim().to_string());
    Ok(Vacation {
        enable_auto_reply: s.enabled,
        response_subject: some(&s.subject),
        response_body_plain_text: some(&s.body_text),
        response_body_html: some(&s.body_html),
        restrict_to_contacts: s.contacts_only,
        restrict_to_domain: s.domain_only && can_limit_to_domain,
        start_time: s.start.map(|t| t.to_string()),
        end_time: s.end.map(|t| t.to_string()),
    })
}

fn friendly(e: CoreError) -> CoreError {
    if e.is_missing_scope() {
        CoreError::Invalid(
            concat!(
                "Sign in to this account again (Settings → Accounts) so ",
                env!("BRAND_NAME"),
                " can change its vacation responder."
            )
            .into(),
        )
    } else {
        e
    }
}

fn ready(settings: VacationSettings, email: &str) -> VacationState {
    VacationState::Ready {
        active: is_active(&settings, now_ms()),
        settings,
        can_limit_to_domain: can_limit_to_domain(email),
    }
}

/// An account's vacation responder, or why it can't be shown.
pub async fn get(db: &Db, gmail: &GmailClient, account: AccountId) -> Result<AccountVacation> {
    let info = accounts::get(&db.conn(), account)?;
    let state = if info
        .missing_permissions
        .contains(&Permission::GmailSettings)
    {
        VacationState::NeedsSignIn
    } else {
        match gmail.vacation().await {
            Ok(v) => ready(from_gmail(&v), &info.email),
            Err(e) if e.is_missing_scope() => VacationState::NeedsSignIn,
            Err(CoreError::Network(_)) => VacationState::Unavailable {
                message: "Couldn’t reach Gmail.".into(),
            },
            Err(e) => VacationState::Unavailable {
                message: e.to_string(),
            },
        }
    };
    Ok(AccountVacation {
        account_id: account,
        state,
    })
}

/// Saves an account's vacation responder and returns what Gmail kept.
pub async fn set(
    db: &Db,
    gmail: &GmailClient,
    account: AccountId,
    settings: &VacationSettings,
) -> Result<AccountVacation> {
    let email = accounts::get(&db.conn(), account)?.email;
    let vacation = to_gmail(settings, can_limit_to_domain(&email))?;
    let saved = gmail.set_vacation(&vacation).await.map_err(friendly)?;
    Ok(AccountVacation {
        account_id: account,
        state: ready(from_gmail(&saved), &email),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn on() -> VacationSettings {
        VacationSettings {
            enabled: true,
            subject: "Away".into(),
            body_html: "<p>Back Monday</p>".into(),
            body_text: "Back Monday".into(),
            ..Default::default()
        }
    }

    #[test]
    fn active_only_within_its_dates() {
        let s = VacationSettings {
            start: Some(100),
            end: Some(200),
            ..on()
        };
        assert!(!is_active(&s, 99));
        assert!(is_active(&s, 100));
        assert!(!is_active(&s, 200), "the end is exclusive");
        assert!(is_active(&on(), 5), "no dates: on until turned off");
        let off = VacationSettings {
            enabled: false,
            ..on()
        };
        assert!(!is_active(&off, 150));
    }

    #[test]
    fn html_only_replies_get_their_plain_text() {
        // Gmail can return a reply saved as HTML with an empty plain-text part.
        let v = Vacation {
            enable_auto_reply: true,
            response_body_html: Some(
                "<div>Away &amp; offline<br>Back <b>Monday</b></div><p></p><p>Maya</p>".into(),
            ),
            response_body_plain_text: Some(String::new()),
            ..Default::default()
        };
        let s = from_gmail(&v);
        assert_eq!(s.body_text, "Away & offline\nBack Monday\n\nMaya");
        assert_eq!(s.body_html, v.response_body_html.clone().unwrap());

        let off = VacationSettings {
            enabled: false,
            ..s.clone()
        };
        let sent = to_gmail(&off, false).unwrap();
        assert_eq!(sent.response_body_html, v.response_body_html);
        assert_eq!(
            sent.response_body_plain_text.as_deref(),
            Some("Away & offline\nBack Monday\n\nMaya")
        );
    }

    #[test]
    fn plain_text_replies_open_as_html() {
        let v = Vacation {
            enable_auto_reply: true,
            response_body_plain_text: Some("Away <until>\nMonday".into()),
            start_time: Some("1700000000000".into()),
            ..Default::default()
        };
        let s = from_gmail(&v);
        assert_eq!(s.body_html, "Away &lt;until&gt;<br>Monday");
        assert_eq!(s.start, Some(1_700_000_000_000));
        assert_eq!(s.end, None);
    }

    #[test]
    fn saving_checks_dates_and_text() {
        let backwards = VacationSettings {
            start: Some(200),
            end: Some(100),
            ..on()
        };
        assert!(matches!(
            to_gmail(&backwards, false),
            Err(CoreError::Invalid(_))
        ));
        let empty = VacationSettings {
            enabled: true,
            ..Default::default()
        };
        assert!(matches!(
            to_gmail(&empty, false),
            Err(CoreError::Invalid(_))
        ));
        // Off and empty is fine (turning it off).
        assert!(to_gmail(&VacationSettings::default(), false).is_ok());
    }

    #[test]
    fn organization_only_needs_a_workspace_account() {
        let s = VacationSettings {
            domain_only: true,
            ..on()
        };
        assert!(
            !to_gmail(&s, can_limit_to_domain("me@gmail.com"))
                .unwrap()
                .restrict_to_domain
        );
        assert!(
            to_gmail(&s, can_limit_to_domain("me@acme.example"))
                .unwrap()
                .restrict_to_domain
        );
        let v = to_gmail(&on(), true).unwrap();
        assert_eq!(v.response_subject.as_deref(), Some("Away"));
        assert_eq!(v.start_time, None);
    }
}
