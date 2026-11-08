import type {
  Answer,
  CalendarState,
  Clash,
  Invite,
  InviteCard,
  Moment,
} from "../../../platform/tauri/bindings";

const dayFormat: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" };
const timeFormat: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };

function sameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

/** A `YYYY-MM-DD` date, read as that day wherever you are. */
function localDate(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

/**
 * When the event is, in your time zone: "Tue, Oct 20 · 2:00 – 2:30 PM",
 * "Sun, Nov 1 · all day", or across days "Tue, Oct 20, 11:00 PM – Wed,
 * Oct 21, 1:00 AM". A time in a zone the app can't place is shown as written,
 * with the zone's name.
 */
export function whenText(start: Moment, end: Moment | null, locale?: string): string {
  if (start.kind === "allDay") {
    const first = localDate(start.date);
    // An all-day end is the day after the last day.
    const last = end?.kind === "allDay" ? localDate(end.date) : null;
    if (last) last.setDate(last.getDate() - 1);
    const day = (d: Date) => d.toLocaleDateString(locale, dayFormat);
    return last && !sameDay(first, last) && last > first
      ? `${day(first)} – ${day(last)} · all day`
      : `${day(first)} · all day`;
  }
  if (start.kind === "local") {
    const [date, time] = start.time.split("T");
    return `${date} ${time?.slice(0, 5)}${start.zone ? ` (${start.zone})` : ""}`;
  }
  const from = new Date(start.ms);
  const day = from.toLocaleDateString(locale, dayFormat);
  const time = (d: Date) => d.toLocaleTimeString(locale, timeFormat);
  if (end?.kind !== "at") return `${day} · ${time(from)}`;
  const to = new Date(end.ms);
  if (sameDay(from, to)) return `${day} · ${time(from)} – ${time(to)}`;
  return `${day}, ${time(from)} – ${to.toLocaleDateString(locale, dayFormat)}, ${time(to)}`;
}

const ANSWER_WORDS: Record<Answer, string> = {
  yes: "Going",
  maybe: "Maybe",
  no: "Not going",
  needsAction: "Not answered",
};

/** Your answer as the card says it. */
export function answerText(answer: Answer | null): string {
  return ANSWER_WORDS[answer ?? "needsAction"];
}

/** Your current answer: Calendar's if it has the event, else the email's. */
export function currentAnswer(card: InviteCard): Answer | null {
  const { calendar } = card;
  if (calendar.kind === "onCalendar" || calendar.kind === "repliedByEmail")
    return calendar.yourAnswer;
  return card.invite.yourAnswer;
}

/** The small heading above the event's title. */
export function headline(invite: Invite, calendar: CalendarState): string {
  if (invite.kind === "reply" && invite.replied) {
    const who = invite.replied.who.name ?? invite.replied.who.email;
    const verb = {
      yes: "accepted",
      no: "declined",
      maybe: "said maybe to",
      needsAction: "replied to",
    }[invite.replied.answer];
    return `${who} ${verb} your invitation`;
  }
  if (invite.kind === "reply") return "Reply to your invitation";
  const cancelled = invite.cancelled || (calendar.kind === "onCalendar" && calendar.cancelled);
  if (cancelled) return "Canceled";
  return invite.sequence > 0 ? "Updated invitation" : "Invitation";
}

/** Whether Yes / Maybe / No apply. */
export function canAnswer(card: InviteCard): boolean {
  const { invite, calendar } = card;
  if (invite.kind !== "request" || invite.cancelled) return false;
  if (calendar.kind === "onCalendar") return !calendar.cancelled;
  // Answered by email: answering again sends another reply.
  return calendar.kind === "notOnCalendar" || calendar.kind === "repliedByEmail";
}

/** Whether to offer "Remove from calendar" (a cancellation still on it). */
export function canRemove(card: InviteCard): boolean {
  const { invite, calendar } = card;
  return invite.cancelled && calendar.kind === "onCalendar" && !calendar.cancelled;
}

/** The line about clashes: "Clashes with 1:1 with Sam (2:15 PM)" or none. */
export function clashText(clashes: Clash[], locale?: string): string | null {
  if (clashes.length === 0) return null;
  const at = (c: Clash) =>
    c.start.kind === "at"
      ? ` (${new Date(c.start.ms).toLocaleTimeString(locale, timeFormat)})`
      : "";
  const first = `${clashes[0]!.title ?? "an event"}${at(clashes[0]!)}`;
  const more = clashes.length - 1;
  return `Clashes with ${first}${more > 0 ? ` and ${more} more` : ""}`;
}
