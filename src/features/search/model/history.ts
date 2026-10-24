/**
 * Recent searches, offered under the search box. Kept in this window's
 * storage only: searches can be private, so they never leave the Mac.
 */
export const HISTORY_KEY = "mailboat.searchHistory";

/** How many are kept (Mail and Gmail show about this many). */
export const MAX_HISTORY = 10;

/** What was saved, newest first; anything unreadable is dropped. */
export function parseHistory(raw: string | null): string[] {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed
          .filter((s): s is string => typeof s === "string" && s.trim() !== "")
          .slice(0, MAX_HISTORY)
      : [];
  } catch {
    return [];
  }
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** A search just used goes to the top (once, whatever its case). */
export function remember(history: string[], text: string): string[] {
  const search = text.trim().replace(/\s+/g, " ");
  if (!search) return history;
  return [search, ...history.filter((h) => !same(h, search))].slice(0, MAX_HISTORY);
}

export function forget(history: string[], text: string): string[] {
  return history.filter((h) => !same(h, text));
}

/**
 * What the dropdown offers for what's typed: everything when nothing is,
 * otherwise the searches containing it (not the one already typed).
 */
export function suggestions(history: string[], typed: string): string[] {
  const t = typed.trim().toLowerCase();
  if (!t) return history;
  return history.filter((h) => h.toLowerCase().includes(t) && h.toLowerCase() !== t);
}
