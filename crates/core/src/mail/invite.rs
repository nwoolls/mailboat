//! Meeting invitations, read from the calendar part of an email (the
//! `text/calendar` part Google Calendar, Outlook and Apple Calendar send).
//!
//! Groundwork for answering invitations in the reader (Milestone 5). The
//! card itself goes through Google Calendar's API, which needs the event's
//! `uid` to find it; when an invitation isn't on the calendar, it's added
//! from what's read here, or answered by email. Parsing uses the
//! `icalendar` crate; times with a time zone are resolved with `chrono-tz`.

use std::str::FromStr;

use chrono::{NaiveDateTime, TimeZone};
use icalendar::{
    Calendar, CalendarDateTime, Component, DatePerhapsTime, EventLike, EventStatus, PartStat,
};
use serde::{Deserialize, Serialize};
use specta::Type;

/// What the calendar part asks for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum InviteKind {
    /// A new invitation, or an update to one (a higher `sequence`).
    Request,
    /// The organizer cancelled the event.
    Cancel,
    /// Someone answered an invitation you sent.
    Reply,
}

/// How someone answered.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum Answer {
    NeedsAction,
    Yes,
    No,
    Maybe,
}

/// A moment in the event: a whole day, an exact time, or a time whose zone
/// couldn't be worked out (shown as written, with the zone's name).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Moment {
    /// `YYYY-MM-DD`.
    AllDay { date: String },
    /// Milliseconds since 1970 (UTC).
    At { ms: i64 },
    /// `YYYY-MM-DDTHH:MM:SS` in a zone not in the time zone database
    /// (e.g. Outlook's "Eastern Standard Time"), or none (floating).
    Local { time: String, zone: Option<String> },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    pub email: String,
    pub name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Invite {
    pub kind: InviteKind,
    /// The event's id across calendars (iCalendar `UID`).
    pub uid: String,
    /// Higher means a newer version of the same event.
    pub sequence: u32,
    pub title: Option<String>,
    pub location: Option<String>,
    pub start: Moment,
    pub end: Option<Moment>,
    pub organizer: Option<Person>,
    /// This account's answer, as the calendar part says, if it lists you.
    pub your_answer: Option<Answer>,
    /// Which of your addresses the invitation lists (maybe an alias).
    pub you: Option<String>,
    /// Cancelled (by a CANCEL, or the event's status).
    pub cancelled: bool,
    /// For a reply: who answered, and how.
    pub replied: Option<Replied>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Replied {
    pub who: Person,
    pub answer: Answer,
}

/// Reads the first event of a calendar part. `mine` are this account's
/// addresses (its own and its aliases), to find your answer among the
/// attendees. `None` if it isn't a calendar or has no usable event.
pub fn parse(ics: &str, mine: &[&str]) -> Option<Invite> {
    let calendar = Calendar::from_str(ics).ok()?;
    let kind = match calendar
        .property_value("METHOD")
        .map(|m| m.trim().to_ascii_uppercase())
        .as_deref()
    {
        Some("CANCEL") => InviteKind::Cancel,
        Some("REPLY") => InviteKind::Reply,
        // PUBLISH and no method are shown as invitations too: the app only
        // looks at calendar parts that came by email.
        _ => InviteKind::Request,
    };
    let event = calendar.events().next()?;
    let uid = event.get_uid()?.trim().to_string();
    let start = moment(event.get_start()?)?;
    let organizer = event.properties().get("ORGANIZER").and_then(|p| {
        Some(Person {
            email: address(p.value())?,
            name: p.get_param_as("CN", non_empty),
        })
    });
    let attendees = event.get_attendees();
    // A reply lists only the person answering.
    let replied = (kind == InviteKind::Reply)
        .then(|| attendees.first())
        .flatten()
        .and_then(|a| {
            Some(Replied {
                who: Person {
                    email: address(&a.cal_address)?,
                    name: a.cn.as_deref().and_then(non_empty),
                },
                answer: answer_of(a.part_stat),
            })
        });
    let yours = attendees.iter().find(|a| {
        address(&a.cal_address).is_some_and(|e| mine.iter().any(|m| m.eq_ignore_ascii_case(&e)))
    });
    let your_answer = yours.map(|a| answer_of(a.part_stat));
    let you = yours.and_then(|a| address(&a.cal_address));
    Some(Invite {
        kind,
        uid,
        sequence: event.get_sequence().unwrap_or(0),
        title: event.get_summary().and_then(non_empty),
        location: event.get_location().and_then(non_empty),
        start,
        end: event.get_end().and_then(moment),
        organizer,
        your_answer,
        you,
        cancelled: kind == InviteKind::Cancel || event.get_status() == Some(EventStatus::Cancelled),
        replied,
    })
}

/// The standard calendar reply (RFC 5546 `METHOD:REPLY`) answering
/// `invite` as `you`: what Apple Mail and Outlook send, and what Google
/// Calendar and Outlook read to update the organizer's event. Used when
/// Google Calendar can't take the answer itself.
pub fn reply_ics(invite: &Invite, you: &str, answer: Answer) -> String {
    use icalendar::{Event, Property};
    let partstat = match answer {
        Answer::Yes => "ACCEPTED",
        Answer::No => "DECLINED",
        Answer::Maybe => "TENTATIVE",
        Answer::NeedsAction => "NEEDS-ACTION",
    };
    let mut event = Event::new();
    event
        .uid(&invite.uid)
        .sequence(invite.sequence)
        .timestamp(chrono::Utc::now())
        .append_multi_property(
            Property::new("ATTENDEE", format!("mailto:{you}"))
                .add_parameter("PARTSTAT", partstat)
                .done(),
        );
    if let Some(title) = &invite.title {
        event.summary(title);
    }
    event.append_property(start_property(&invite.start));
    if let Some(organizer) = &invite.organizer {
        event.append_property(Property::new(
            "ORGANIZER",
            format!("mailto:{}", organizer.email),
        ));
    }
    let mut calendar = Calendar::new();
    calendar.append_property(Property::new("METHOD", "REPLY"));
    calendar.push(event.done());
    calendar.done().to_string()
}

/// DTSTART for the reply, as the invitation had it.
fn start_property(start: &Moment) -> icalendar::Property {
    use icalendar::Property;
    match start {
        Moment::AllDay { date } => Property::new("DTSTART", date.replace('-', ""))
            .add_parameter("VALUE", "DATE")
            .done(),
        Moment::At { ms } => Property::new(
            "DTSTART",
            chrono::DateTime::from_timestamp_millis(*ms)
                .unwrap_or_default()
                .format("%Y%m%dT%H%M%SZ")
                .to_string(),
        ),
        Moment::Local { time, zone } => {
            let mut p = Property::new("DTSTART", time.replace(['-', ':'], ""));
            if let Some(zone) = zone {
                p.add_parameter("TZID", zone);
            }
            p.done()
        }
    }
}

fn answer_of(status: Option<PartStat>) -> Answer {
    match status {
        Some(PartStat::Accepted) => Answer::Yes,
        Some(PartStat::Declined) => Answer::No,
        Some(PartStat::Tentative) => Answer::Maybe,
        _ => Answer::NeedsAction,
    }
}

fn moment(value: DatePerhapsTime) -> Option<Moment> {
    Some(match value {
        DatePerhapsTime::Date(date) => Moment::AllDay {
            date: date.format("%Y-%m-%d").to_string(),
        },
        DatePerhapsTime::DateTime(CalendarDateTime::Utc(at)) => Moment::At {
            ms: at.timestamp_millis(),
        },
        DatePerhapsTime::DateTime(CalendarDateTime::Floating(time)) => local(time, None),
        DatePerhapsTime::DateTime(CalendarDateTime::WithTimezone { date_time, tzid }) => {
            match tzid.parse::<chrono_tz::Tz>() {
                // A time that doesn't exist (in a spring-forward gap) has
                // no answer; ambiguous ones (fall back) take the earlier.
                Ok(zone) => match zone.from_local_datetime(&date_time).earliest() {
                    Some(at) => Moment::At {
                        ms: at.timestamp_millis(),
                    },
                    None => local(date_time, Some(tzid)),
                },
                Err(_) => local(date_time, Some(tzid)),
            }
        }
    })
}

fn local(time: NaiveDateTime, zone: Option<String>) -> Moment {
    Moment::Local {
        time: time.format("%Y-%m-%dT%H:%M:%S").to_string(),
        zone,
    }
}

/// `mailto:Someone@Example.com` → `someone@example.com`.
fn address(cal_address: &str) -> Option<String> {
    let value = cal_address.trim();
    let email = value
        .get(..7)
        .filter(|p| p.eq_ignore_ascii_case("mailto:"))
        .map_or(value, |_| &value[7..])
        .trim();
    email.contains('@').then(|| email.to_ascii_lowercase())
}

fn non_empty(s: &str) -> Option<String> {
    let s = s.trim();
    (!s.is_empty()).then(|| s.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// As Google Calendar sends it (trimmed): a time zone, folded lines,
    /// and the invited account among the attendees.
    const GOOGLE: &str = "BEGIN:VCALENDAR\r
PRODID:-//Google Inc//Google Calendar 70.9054//EN\r
VERSION:2.0\r
CALSCALE:GREGORIAN\r
METHOD:REQUEST\r
BEGIN:VTIMEZONE\r
TZID:America/New_York\r
END:VTIMEZONE\r
BEGIN:VEVENT\r
DTSTART;TZID=America/New_York:20261020T140000\r
DTEND;TZID=America/New_York:20261020T143000\r
DTSTAMP:20261017T180000Z\r
ORGANIZER;CN=Pat Organizer:mailto:pat@example.com\r
UID:abc123@google.com\r
ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=\r
 TRUE;CN=Me;X-NUM-GUESTS=0:mailto:Me@Example.com\r
ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;CN=Pat Or\r
 ganizer:mailto:pat@example.com\r
SEQUENCE:2\r
STATUS:CONFIRMED\r
SUMMARY:Design review\r
LOCATION:Room 4\r
END:VEVENT\r
END:VCALENDAR\r
";

    #[test]
    fn reads_a_google_invitation() {
        let invite = parse(GOOGLE, &["me@example.com"]).unwrap();
        assert_eq!(invite.kind, InviteKind::Request);
        assert_eq!(invite.uid, "abc123@google.com");
        assert_eq!(invite.sequence, 2);
        assert_eq!(invite.title.as_deref(), Some("Design review"));
        assert_eq!(invite.location.as_deref(), Some("Room 4"));
        // 2pm in New York on 20 Oct 2026 is 18:00 UTC (daylight time).
        assert_eq!(
            invite.start,
            Moment::At {
                ms: 1_792_519_200_000
            }
        );
        assert_eq!(
            invite.end,
            Some(Moment::At {
                ms: 1_792_521_000_000
            })
        );
        assert_eq!(
            invite.organizer,
            Some(Person {
                email: "pat@example.com".into(),
                name: Some("Pat Organizer".into()),
            })
        );
        assert_eq!(invite.your_answer, Some(Answer::NeedsAction));
        assert!(!invite.cancelled);
    }

    #[test]
    fn finds_your_answer_by_any_of_your_addresses() {
        let invite = parse(GOOGLE, &["alias@example.com", "pat@example.com"]).unwrap();
        assert_eq!(invite.your_answer, Some(Answer::Yes));
        assert_eq!(
            parse(GOOGLE, &["nobody@example.com"]).unwrap().your_answer,
            None
        );
    }

    #[test]
    fn cancellations_all_day_events_and_unknown_zones() {
        let ics = "BEGIN:VCALENDAR\r
VERSION:2.0\r
METHOD:CANCEL\r
BEGIN:VEVENT\r
UID:day-1\r
DTSTART;VALUE=DATE:20261101\r
DTEND;VALUE=DATE:20261102\r
END:VEVENT\r
END:VCALENDAR\r
";
        let invite = parse(ics, &[]).unwrap();
        assert_eq!(invite.kind, InviteKind::Cancel);
        assert!(invite.cancelled);
        assert_eq!(
            invite.start,
            Moment::AllDay {
                date: "2026-11-01".into()
            }
        );
        assert_eq!(invite.title, None);

        let outlook = GOOGLE.replace(
            "TZID=America/New_York:20261020T140000",
            "TZID=Eastern Standard Time:20261020T140000",
        );
        assert_eq!(
            parse(&outlook, &[]).unwrap().start,
            Moment::Local {
                time: "2026-10-20T14:00:00".into(),
                zone: Some("Eastern Standard Time".into()),
            }
        );
    }

    #[test]
    fn a_reply_says_who_answered() {
        let ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nMETHOD:REPLY\r\nBEGIN:VEVENT\r\n\
UID:abc\r\nDTSTART:20261020T180000Z\r\n\
ATTENDEE;PARTSTAT=ACCEPTED;CN=Sam Lee:mailto:sam@example.com\r\n\
END:VEVENT\r\nEND:VCALENDAR\r\n";
        let invite = parse(ics, &[]).unwrap();
        assert_eq!(invite.kind, InviteKind::Reply);
        assert_eq!(
            invite.replied,
            Some(Replied {
                who: Person {
                    email: "sam@example.com".into(),
                    name: Some("Sam Lee".into()),
                },
                answer: Answer::Yes,
            })
        );
        assert_eq!(parse(GOOGLE, &[]).unwrap().replied, None);
    }

    #[test]
    fn a_reply_answers_the_same_event_as_you() {
        let invite = parse(GOOGLE, &["me@example.com"]).unwrap();
        assert_eq!(invite.you.as_deref(), Some("me@example.com"));
        let ics = reply_ics(&invite, "me@example.com", Answer::Maybe);
        // Read back: a reply for the same event, from you, with your answer.
        let reply = parse(&ics, &[]).unwrap();
        assert_eq!(reply.kind, InviteKind::Reply);
        assert_eq!(reply.uid, "abc123@google.com");
        assert_eq!(reply.sequence, 2);
        assert_eq!(reply.start, invite.start);
        assert_eq!(reply.organizer.unwrap().email, "pat@example.com");
        let replied = reply.replied.unwrap();
        assert_eq!(replied.who.email, "me@example.com");
        assert_eq!(replied.answer, Answer::Maybe);
    }

    #[test]
    fn not_an_invitation() {
        assert_eq!(parse("hello", &[]), None);
        // An event with no UID can't be found on a calendar.
        let no_uid = GOOGLE.replace("UID:abc123@google.com\r\n", "");
        assert_eq!(parse(&no_uid, &[]), None);
    }
}
