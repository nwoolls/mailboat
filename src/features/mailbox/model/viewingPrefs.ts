import type { AfterRemoval } from "./threadActions";

/** Settings → Viewing; window-only, kept in the web view's storage. */
export type ViewingPrefs = { afterRemoval: AfterRemoval };

export const VIEWING_PREFS_KEY = "mailboat.viewing";

export const DEFAULT_VIEWING_PREFS: ViewingPrefs = { afterRemoval: "below" };

const AFTER_REMOVAL: readonly AfterRemoval[] = ["below", "above", "none"];

/** What was saved, with anything missing or unknown at its default. */
export function parseViewingPrefs(raw: string | null): ViewingPrefs {
  let saved: unknown;
  try {
    saved = raw ? JSON.parse(raw) : null;
  } catch {
    saved = null;
  }
  const after = (saved as { afterRemoval?: unknown } | null)?.afterRemoval;
  return {
    afterRemoval: AFTER_REMOVAL.find((a) => a === after) ?? DEFAULT_VIEWING_PREFS.afterRemoval,
  };
}
