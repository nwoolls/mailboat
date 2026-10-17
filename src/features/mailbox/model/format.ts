import type { Address, ThreadSender } from "../../../platform/tauri/bindings";

/** Short list-row date: time today, "Oct 9" this year, "10/9/24" before. */
export function formatListDate(ms: number, now: Date = new Date(), locale?: string): string {
  const d = new Date(ms);
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  if (d.getFullYear() === now.getFullYear())
    return d.toLocaleDateString(locale, { month: "short", day: "numeric" });
  return d.toLocaleDateString(locale, { year: "2-digit", month: "numeric", day: "numeric" });
}

/** Full date for the reader header. */
export function formatFullDate(ms: number, locale?: string): string {
  return new Date(ms).toLocaleString(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function displayName(a: Address, selfEmails: string[] = []): string {
  if (selfEmails.some((e) => e.toLowerCase() === a.email.toLowerCase())) return "me";
  if (a.name) return a.name;
  return a.email.split("@")[0] ?? a.email;
}

/** One name in a row's sender line; `unread` ones show in bold, as in Gmail. */
export type SenderPart = { key: string; text: string; unread: boolean };

/**
 * A row's sender line, as Gmail shows it: first names when several people
 * wrote ("Jane, me"), "me" for you, and with more than three, the first,
 * "…" and the last two. Each part says whether that person has unread
 * mail in the conversation. The message count is shown separately.
 */
export function senderParts(senders: ThreadSender[], selfEmails: string[] = []): SenderPart[] {
  if (senders.length === 0) return [{ key: "none", text: "(no sender)", unread: false }];
  const parts = senders.map((s) => {
    const name = displayName(s, selfEmails);
    // Use first names when several people are listed.
    const text =
      senders.length > 1 && name !== "me" && !name.includes(",")
        ? (name.split(/\s+/)[0] ?? name)
        : name;
    return { key: s.email.toLowerCase(), text, unread: s.unread ?? false };
  });
  return parts.length > 3
    ? [parts[0]!, { key: "…", text: "…", unread: false }, ...parts.slice(-2)]
    : parts;
}
