import type { AuthCheck, MessageMeta, Original } from "../../../platform/tauri/bindings";
import { formatFullDate } from "../../mailbox/model/format";

/**
 * Which email "Show original" starts on: the newest sent or received one
 * (drafts last), as Gmail's menu offers it on each email and the newest
 * is the one usually wanted.
 */
export function startingEmail(messages: MessageMeta[]): MessageMeta | null {
  const real = messages.filter((m) => !m.draft);
  const from = real.length > 0 ? real : messages;
  return from.reduce<MessageMeta | null>(
    (newest, m) => (newest === null || m.internalDate >= newest.internalDate ? m : newest),
    null,
  );
}

/** "PASS with domain example.com", as Gmail's summary reads. */
export function checkText(check: AuthCheck): string {
  const result = check.result.toUpperCase();
  return check.detail ? `${result} with domain ${check.detail}` : result;
}

/** The summary above the source, in Gmail's order; empty rows left out. */
export function summaryRows(o: Original, locale?: string): [string, string][] {
  const rows: [string, string | null][] = [
    ["Message ID", o.messageId],
    ["Created at", o.date === null ? null : formatFullDate(o.date, locale)],
    ["From", o.from],
    ["To", o.to],
    ["Cc", o.cc],
    ["Subject", o.subject],
    ...o.checks.map((c): [string, string] => [c.method, checkText(c)]),
  ];
  return rows.filter((r): r is [string, string] => r[1] !== null && r[1] !== "");
}

/** Gmail's checks that didn't pass, so the summary can mark them. */
export function failed(check: AuthCheck): boolean {
  return check.result !== "pass";
}
