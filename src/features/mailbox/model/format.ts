import type { Address } from "../../../platform/tauri/bindings";

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

/** Thread-row sender summary like Gmail: "Jane, Bob" with a count when longer. */
export function sendersLabel(
  senders: Address[],
  messageCount: number,
  selfEmails: string[] = [],
): string {
  if (senders.length === 0) return "(no sender)";
  const names = senders.map((s) => {
    const name = displayName(s, selfEmails);
    // Use first names when several people are listed.
    return senders.length > 1 && name !== "me" && !name.includes(",")
      ? (name.split(/\s+/)[0] ?? name)
      : name;
  });
  const shown = names.length > 3 ? [names[0], "…", ...names.slice(-2)] : names;
  const label = shown.join(", ");
  return messageCount > 1 ? `${label} (${messageCount})` : label;
}
