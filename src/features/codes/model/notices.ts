import type { ArrivedCode } from "../../../platform/tauri/bindings";

/** A sign-in code shown in the top-right notice. */
export type CodeNotice = ArrivedCode & { arrivedAt: number };

/** Codes expire in minutes; the notice goes after this long. */
export const NOTICE_LIFETIME_MS = 10 * 60_000;
/** More than this at once and the oldest goes. */
export const MAX_NOTICES = 3;

/** Adds a code (newest first), dropping repeats and the oldest past the limit. */
export function withCode(list: CodeNotice[], code: ArrivedCode, now: number): CodeNotice[] {
  const rest = list.filter((n) => n.messageId !== code.messageId);
  return [{ ...code, arrivedAt: now }, ...rest].slice(0, MAX_NOTICES);
}

/** The codes still worth showing at `now`. */
export function current(list: CodeNotice[], now: number): CodeNotice[] {
  return list.filter((n) => now - n.arrivedAt < NOTICE_LIFETIME_MS);
}
