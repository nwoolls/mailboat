import type { VacationSettings } from "../../../platform/tauri/bindings";

/**
 * The vacation responder's form. Dates are whole days in your time zone
 * ("2026-10-25"), as in Gmail's form; Gmail stores times. The first day
 * starts at its midnight; the last day ends at the next midnight (Gmail's
 * end time is exclusive).
 */
export type VacationForm = {
  enabled: boolean;
  firstDay: string;
  /** "" means no last day: on until turned off. */
  lastDay: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  contactsOnly: boolean;
  domainOnly: boolean;
};

const pad = (n: number) => String(n).padStart(2, "0");

/** A day ("YYYY-MM-DD") from a moment, in your time zone. */
export function dayOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The local midnight starting a day, in ms; null for a blank or bad day. */
export function startOfDay(day: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}

/** The local midnight after a day: when a last day ends. */
export function endOfDay(day: string): number | null {
  const start = startOfDay(day);
  if (start === null) return null;
  const d = new Date(start);
  // By date, not +24h, so days when the clocks change still end at midnight.
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
}

export function formFromSettings(s: VacationSettings, today: number): VacationForm {
  return {
    enabled: s.enabled,
    // Gmail's form always has a first day; today when none is set.
    firstDay: dayOf(s.start ?? today),
    // The end is exclusive, so the last day is the one before it.
    lastDay: s.end === null ? "" : dayOf(s.end - 1),
    subject: s.subject,
    bodyHtml: s.bodyHtml,
    bodyText: s.bodyText,
    contactsOnly: s.contactsOnly,
    domainOnly: s.domainOnly,
  };
}

export function toSettings(f: VacationForm): VacationSettings {
  return {
    enabled: f.enabled,
    subject: f.subject.trim(),
    bodyHtml: f.bodyText.trim() ? f.bodyHtml : "",
    bodyText: f.bodyText.trim(),
    contactsOnly: f.contactsOnly,
    domainOnly: f.domainOnly,
    start: startOfDay(f.firstDay),
    end: endOfDay(f.lastDay),
  };
}

/** Why it can't be saved yet, or null. Mirrors the checks in Rust. */
export function vacationProblem(f: VacationForm): string | null {
  const start = startOfDay(f.firstDay);
  const end = endOfDay(f.lastDay);
  if (f.enabled && start === null) return "Choose the first day.";
  if (start !== null && end !== null && end <= start)
    return "The last day needs to be on or after the first day.";
  if (f.enabled && !f.subject.trim() && !f.bodyText.trim())
    return "Write the reply (a subject or a message) before turning it on.";
  return null;
}

const day = (ms: number) =>
  new Date(ms).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

/** "On until Fri, Oct 25", "Starts Mon, Oct 21", for the banner and Settings. */
export function vacationStatus(s: VacationSettings, now: number): string {
  if (!s.enabled) return "Off";
  if (s.start !== null && s.start > now) return `Starts ${day(s.start)}`;
  if (s.end !== null && s.end <= now) return "Ended";
  return s.end === null ? "On" : `On until the end of ${day(s.end - 1)}`;
}

/** The mail view's banner while a responder replies: "Vacation responder is on until …". */
export function bannerText(s: VacationSettings, email: string | null): string {
  const until = s.end === null ? "" : ` until the end of ${day(s.end - 1)}`;
  return `Vacation responder is on${email ? ` for ${email}` : ""}${until}`;
}
