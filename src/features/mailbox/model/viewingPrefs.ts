import type { AfterRemoval } from "./threadActions";

/** When opening a conversation marks it read. */
export type MarkRead = "open" | "delay" | "never";

/** Messages in a conversation: oldest at the top (as Gmail), or newest. */
export type MessageOrder = "oldestFirst" | "newestFirst";

/** Settings → Viewing; window-only, kept in the web view's storage. */
export type ViewingPrefs = {
  afterRemoval: AfterRemoval;
  markRead: MarkRead;
  order: MessageOrder;
};

export const VIEWING_PREFS_KEY = "mailboat.viewing";

/** With "delay": read once it has stayed open this long. */
export const MARK_READ_DELAY_MS = 3000;

export const DEFAULT_VIEWING_PREFS: ViewingPrefs = {
  afterRemoval: "below",
  markRead: "open",
  order: "oldestFirst",
};

function oneOf<T extends string>(choices: readonly T[], value: unknown, fallback: T): T {
  return choices.find((c) => c === value) ?? fallback;
}

/** What was saved, with anything missing or unknown at its default. */
export function parseViewingPrefs(raw: string | null): ViewingPrefs {
  let saved: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === "object") saved = parsed as Record<string, unknown>;
  } catch {
    // Fall through to the defaults.
  }
  const d = DEFAULT_VIEWING_PREFS;
  return {
    afterRemoval: oneOf(["below", "above", "none"], saved.afterRemoval, d.afterRemoval),
    markRead: oneOf(["open", "delay", "never"], saved.markRead, d.markRead),
    order: oneOf(["oldestFirst", "newestFirst"], saved.order, d.order),
  };
}

/** A conversation's messages (oldest first, as they come) in the chosen order. */
export function inOrder<T>(messages: readonly T[], order: MessageOrder): T[] {
  return order === "newestFirst" ? messages.toReversed() : [...messages];
}
