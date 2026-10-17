//! Answering meeting invitations through Google Calendar, as Gmail does
//! (decided by the owner, 2026-10-17). The email's calendar part
//! (`mail::invite`) says which event; Calendar finds it by its iCalendar
//! UID on the account's own calendar, says your answer and what it clashes
//! with, and takes Yes / No / Maybe (Google then tells the organizer).
//!
//! An invitation not on the calendar yet (some from outside Google) is
//! added first (`events.import`), then answered.

use chrono::{DateTime, NaiveDate};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::compose::identities;
use crate::db::{accounts, store, Db};
use crate::error::{CoreError, Result};
use crate::gmail::client::net_error;
use crate::gmail::parse::{self, CalendarPart};
use crate::gmail::GmailClient;
use crate::mail::invite::{self, Answer, Invite, InviteKind, Moment};
use crate::model::{MessageId, Permission};

// ---- Calendar API types (only the fields Mailboat uses) ----

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventTime {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date_time: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time_zone: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventPerson {
    pub email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(default, skip_serializing)]
    #[serde(rename = "self")]
    pub is_self: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_status: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEvent {
    pub id: String,
    pub status: Option<String>,
    pub summary: Option<String>,
    pub html_link: Option<String>,
    pub transparency: Option<String>,
    pub recurring_event_id: Option<String>,
    #[serde(default)]
    pub start: EventTime,
    #[serde(default)]
    pub end: EventTime,
    #[serde(default)]
    pub attendees: Vec<EventPerson>,
}

#[derive(Debug, Deserialize)]
struct EventList {
    #[serde(default)]
    items: Vec<CalendarEvent>,
}

impl CalendarEvent {
    fn cancelled(&self) -> bool {
        self.status.as_deref() == Some("cancelled")
    }

    /// Your entry among the attendees (Calendar marks it `self`).
    fn you(&self) -> Option<&EventPerson> {
        self.attendees.iter().find(|a| a.is_self)
    }

    fn your_answer(&self) -> Option<Answer> {
        self.you()
            .and_then(|a| a.response_status.as_deref())
            .map(answer_from)
    }
}

fn answer_from(status: &str) -> Answer {
    match status {
        "accepted" => Answer::Yes,
        "declined" => Answer::No,
        "tentative" => Answer::Maybe,
        _ => Answer::NeedsAction,
    }
}

fn status_for(answer: Answer) -> &'static str {
    match answer {
        Answer::Yes => "accepted",
        Answer::No => "declined",
        Answer::Maybe => "tentative",
        Answer::NeedsAction => "needsAction",
    }
}

fn moment_of(t: &EventTime) -> Option<Moment> {
    if let Some(dt) = &t.date_time {
        return DateTime::parse_from_rfc3339(dt).ok().map(|d| Moment::At {
            ms: d.timestamp_millis(),
        });
    }
    t.date
        .as_ref()
        .filter(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").is_ok())
        .map(|d| Moment::AllDay { date: d.clone() })
}

fn rfc3339(ms: i64) -> String {
    DateTime::from_timestamp_millis(ms)
        .unwrap_or_default()
        .to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// A Calendar `start`/`end` for a moment from the email.
fn event_time(m: &Moment) -> EventTime {
    match m {
        Moment::AllDay { date } => EventTime {
            date: Some(date.clone()),
            ..Default::default()
        },
        Moment::At { ms } => EventTime {
            date_time: Some(rfc3339(*ms)),
            ..Default::default()
        },
        Moment::Local { time, zone } => EventTime {
            date_time: Some(time.clone()),
            time_zone: zone.clone(),
            ..Default::default()
        },
    }
}

// ---- Calendar API calls, with the account's sign-in ----

impl GmailClient {
    fn calendar_url(&self, path: &str) -> String {
        format!(
            "{}/calendar/v3/calendars/primary/{path}",
            self.calendar_base_url
        )
    }

    /// `events.list?iCalUID=`: the event on your own calendar (cancelled
    /// ones too), if it's there.
    pub async fn calendar_event_by_uid(&self, uid: &str) -> Result<Option<CalendarEvent>> {
        let url = self.calendar_url("events");
        let query = [("iCalUID", uid), ("showDeleted", "true")];
        let response = self.send(|| self.http.get(&url).query(&query)).await?;
        let list: EventList = response.json().await.map_err(net_error)?;
        // A series comes with its changed occurrences; prefer one that
        // isn't cancelled, then the series itself.
        let mut items = list.items;
        items.sort_by_key(|e| (e.cancelled(), e.recurring_event_id.is_some()));
        Ok(items.into_iter().next())
    }

    /// `events.list` for a time range, occurrences expanded: what an
    /// invitation could clash with.
    pub async fn calendar_events_between(
        &self,
        from_ms: i64,
        to_ms: i64,
    ) -> Result<Vec<CalendarEvent>> {
        let url = self.calendar_url("events");
        let (min, max) = (rfc3339(from_ms), rfc3339(to_ms));
        let query = [
            ("timeMin", min.as_str()),
            ("timeMax", max.as_str()),
            ("singleEvents", "true"),
            ("orderBy", "startTime"),
            ("maxResults", "20"),
        ];
        let response = self.send(|| self.http.get(&url).query(&query)).await?;
        let list: EventList = response.json().await.map_err(net_error)?;
        Ok(list.items)
    }

    /// Sets your answer, sending only your own attendee entry
    /// (`attendeesOmitted`), as Calendar allows for exactly this. Google
    /// tells the organizer.
    pub async fn calendar_respond(
        &self,
        event_id: &str,
        email: &str,
        answer: Answer,
    ) -> Result<()> {
        let url = self.calendar_url(&format!("events/{}", path_segment(event_id)));
        let body = serde_json::json!({
            "attendeesOmitted": true,
            "attendees": [{ "email": email, "responseStatus": status_for(answer) }],
        });
        self.send(|| {
            self.http
                .request(Method::PATCH, &url)
                .query(&[("sendUpdates", "all")])
                .json(&body)
        })
        .await?;
        Ok(())
    }

    /// `events.import`: puts an invitation that isn't on your calendar yet
    /// there (a private copy with the same UID, as Gmail does for
    /// invitations from outside Google).
    pub async fn calendar_import(&self, invite: &Invite, email: &str) -> Result<CalendarEvent> {
        let url = self.calendar_url("events/import");
        let start = event_time(&invite.start);
        let end = invite
            .end
            .as_ref()
            .map(event_time)
            .unwrap_or_else(|| start.clone());
        let organizer = invite.organizer.as_ref().map(|o| EventPerson {
            email: Some(o.email.clone()),
            display_name: o.name.clone(),
            ..Default::default()
        });
        let body = serde_json::json!({
            "iCalUID": invite.uid,
            "sequence": invite.sequence,
            "summary": invite.title,
            "location": invite.location,
            "start": start,
            "end": end,
            "organizer": organizer,
            "attendees": [{ "email": email, "responseStatus": "needsAction" }],
        });
        let response = self.send(|| self.http.post(&url).json(&body)).await?;
        response.json().await.map_err(net_error)
    }

    /// Removes a cancelled event from your calendar.
    pub async fn calendar_remove(&self, event_id: &str) -> Result<()> {
        let url = self.calendar_url(&format!("events/{}", path_segment(event_id)));
        self.send(|| {
            self.http
                .request(Method::DELETE, &url)
                .query(&[("sendUpdates", "none")])
        })
        .await?;
        Ok(())
    }
}

/// Event IDs are base32hex (plus `_` for occurrences), but don't trust it.
fn path_segment(id: &str) -> String {
    url::form_urlencoded::byte_serialize(id.as_bytes()).collect()
}

// ---- What the reader's card shows ----

/// Something on your calendar at the same time.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Clash {
    pub title: Option<String>,
    pub start: Moment,
    pub end: Option<Moment>,
}

/// What Calendar says about the invitation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum CalendarState {
    /// The account signed in before Mailboat asked for Calendar.
    NeedsSignIn,
    /// Someone's answer to your invitation: nothing to look up.
    NotNeeded,
    NotOnCalendar,
    #[serde(rename_all = "camelCase")]
    OnCalendar {
        event_id: String,
        your_answer: Option<Answer>,
        cancelled: bool,
        clashes: Vec<Clash>,
        /// The event in Google Calendar on the web.
        link: Option<String>,
    },
    /// Calendar couldn't be asked (offline, API turned off, …).
    Unavailable {
        message: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InviteCard {
    pub invite: Invite,
    pub calendar: CalendarState,
}

/// The invitation in a message, if it has one. Reads the calendar part
/// kept with the body; a body cached before those were kept is fetched
/// again, but only if it has an `.ics` file attached.
pub async fn invite_for(
    db: &Db,
    gmail: &GmailClient,
    message: MessageId,
) -> Result<Option<Invite>> {
    let (account, gmail_id) = store::message_gmail_ref(&db.conn(), message)?;
    let kept = store::calendar(&db.conn(), message)?;
    let ics = match kept {
        Some(ics) => ics,
        None => {
            let worth_fetching = store::has_calendar_attachment(&db.conn(), message)?
                || store::get_body(&db.conn(), message)?.is_none();
            if !worth_fetching {
                return Ok(None);
            }
            let full = gmail.message_full(&gmail_id).await?;
            let ics = match full.payload.as_ref().and_then(parse::calendar_part) {
                Some(CalendarPart::Inline(ics)) => Some(ics),
                Some(CalendarPart::Attachment { attachment_id }) => {
                    let bytes = gmail.attachment(&gmail_id, &attachment_id).await?;
                    Some(String::from_utf8_lossy(&bytes).into_owned())
                }
                None => None,
            };
            // Only recorded once the body is stored (opening it does that).
            store::set_calendar(&db.conn(), message, ics.as_deref())?;
            ics
        }
    };
    let Some(ics) = ics else {
        return Ok(None);
    };
    let mine = your_addresses(db, account)?;
    let mine: Vec<&str> = mine.iter().map(String::as_str).collect();
    Ok(invite::parse(&ics, &mine))
}

fn your_addresses(db: &Db, account: crate::model::AccountId) -> Result<Vec<String>> {
    let all = identities::list(&db.conn())?;
    Ok(all
        .into_iter()
        .filter(|i| i.account_id == account)
        .map(|i| i.email)
        .collect())
}

/// The card for a message's invitation: the invitation, and what Calendar
/// says about it. Calendar problems don't hide the invitation.
pub async fn card_for(
    db: &Db,
    gmail: &GmailClient,
    message: MessageId,
) -> Result<Option<InviteCard>> {
    let Some(invite) = invite_for(db, gmail, message).await? else {
        return Ok(None);
    };
    let (account, _) = store::message_gmail_ref(&db.conn(), message)?;
    let missing = accounts::get(&db.conn(), account)?.missing_permissions;
    let calendar = if invite.kind == InviteKind::Reply {
        CalendarState::NotNeeded
    } else if missing.contains(&Permission::Calendar) {
        CalendarState::NeedsSignIn
    } else {
        match calendar_state(gmail, &invite).await {
            Ok(state) => state,
            Err(e) => unavailable(e),
        }
    };
    Ok(Some(InviteCard { invite, calendar }))
}

async fn calendar_state(gmail: &GmailClient, invite: &Invite) -> Result<CalendarState> {
    let Some(event) = gmail.calendar_event_by_uid(&invite.uid).await? else {
        return Ok(CalendarState::NotOnCalendar);
    };
    let clashes = if event.cancelled() || invite.cancelled {
        Vec::new()
    } else {
        clashes_with(gmail, &event).await.unwrap_or_default()
    };
    Ok(CalendarState::OnCalendar {
        your_answer: event.your_answer(),
        cancelled: event.cancelled(),
        clashes,
        link: event.html_link.clone(),
        event_id: event.id,
    })
}

/// Other events you haven't declined that overlap this one (timed events
/// only, as Gmail; all-day events and ones marked "free" don't clash).
async fn clashes_with(gmail: &GmailClient, event: &CalendarEvent) -> Result<Vec<Clash>> {
    let (Some(Moment::At { ms: start }), Some(Moment::At { ms: end })) =
        (moment_of(&event.start), moment_of(&event.end))
    else {
        return Ok(Vec::new());
    };
    let around = gmail.calendar_events_between(start, end).await?;
    Ok(around
        .iter()
        .filter(|e| e.id != event.id && e.recurring_event_id.as_deref() != Some(event.id.as_str()))
        .filter(|e| !e.cancelled() && e.transparency.as_deref() != Some("transparent"))
        .filter(|e| e.your_answer() != Some(Answer::No))
        .filter_map(|e| match (moment_of(&e.start), moment_of(&e.end)) {
            (Some(s @ Moment::At { .. }), end) => Some(Clash {
                title: e.summary.clone(),
                start: s,
                end,
            }),
            _ => None,
        })
        .collect())
}

fn unavailable(e: CoreError) -> CalendarState {
    let message = match &e {
        CoreError::Api {
            status: 403,
            message,
        } if message.contains("has not been used") || message.contains("disabled") => {
            "The Google Calendar API isn't turned on in Mailboat's Google Cloud project.".into()
        }
        CoreError::Api {
            status: 403,
            message,
        } if message.contains("insufficient") => return CalendarState::NeedsSignIn,
        CoreError::Network(_) => "Couldn’t reach Google Calendar.".into(),
        other => other.to_string(),
    };
    CalendarState::Unavailable { message }
}

/// Answers an invitation: on the calendar already, or added there first.
/// Returns the card as it now is.
pub async fn answer(
    db: &Db,
    gmail: &GmailClient,
    message: MessageId,
    answer: Answer,
) -> Result<InviteCard> {
    let invite = invite_for(db, gmail, message)
        .await?
        .ok_or_else(|| CoreError::NotFound("this message has no invitation".into()))?;
    let event = match gmail.calendar_event_by_uid(&invite.uid).await? {
        Some(event) => event,
        None => {
            let (account, _) = store::message_gmail_ref(&db.conn(), message)?;
            let email = accounts::get(&db.conn(), account)?.email;
            gmail.calendar_import(&invite, &email).await?
        }
    };
    // The address the invitation went to (maybe an alias), as Calendar
    // lists you; the account's own address if Calendar doesn't say.
    let email = match event.you().and_then(|p| p.email.clone()) {
        Some(email) => email,
        None => {
            let (account, _) = store::message_gmail_ref(&db.conn(), message)?;
            accounts::get(&db.conn(), account)?.email
        }
    };
    gmail.calendar_respond(&event.id, &email, answer).await?;
    let calendar = calendar_state(gmail, &invite)
        .await
        .unwrap_or_else(unavailable);
    Ok(InviteCard { invite, calendar })
}

/// Removes a cancelled invitation's event from your calendar.
pub async fn remove(db: &Db, gmail: &GmailClient, message: MessageId) -> Result<InviteCard> {
    let invite = invite_for(db, gmail, message)
        .await?
        .ok_or_else(|| CoreError::NotFound("this message has no invitation".into()))?;
    if let Some(event) = gmail.calendar_event_by_uid(&invite.uid).await? {
        if !event.cancelled() {
            gmail.calendar_remove(&event.id).await?;
        }
    }
    Ok(InviteCard {
        invite,
        calendar: CalendarState::NotOnCalendar,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn calendar_times_become_moments() {
        let timed = EventTime {
            date_time: Some("2026-10-20T14:00:00-04:00".into()),
            ..Default::default()
        };
        assert_eq!(
            moment_of(&timed),
            Some(Moment::At {
                ms: 1_792_519_200_000
            })
        );
        let day = EventTime {
            date: Some("2026-11-01".into()),
            ..Default::default()
        };
        assert_eq!(
            moment_of(&day),
            Some(Moment::AllDay {
                date: "2026-11-01".into()
            })
        );
        assert_eq!(rfc3339(1_792_519_200_000), "2026-10-20T18:00:00Z");
    }

    #[test]
    fn calendar_errors_say_what_to_do() {
        let off = CoreError::Api {
            status: 403,
            message: "Google Calendar API has not been used in project 1 before or it is disabled."
                .into(),
        };
        assert!(
            matches!(unavailable(off), CalendarState::Unavailable { message } if message.contains("turned on"))
        );
        let scope = CoreError::Api {
            status: 403,
            message: "Request had insufficient authentication scopes.".into(),
        };
        assert_eq!(unavailable(scope), CalendarState::NeedsSignIn);
    }
}
