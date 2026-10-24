/** What a swipe does; "archive" trashes where archiving doesn't apply. */
export type SwipeChoice = "archive" | "trash" | "read" | "star" | "spam" | "none";

export const SWIPE_CHOICES: readonly SwipeChoice[] = [
  "archive",
  "trash",
  "read",
  "star",
  "spam",
  "none",
];

/** Settings → List; window-only, kept in the web view's storage. */
export type ListPrefs = {
  /** Fingers moving left (the button shows at the right). */
  swipeLeft: SwipeChoice;
  /** Fingers moving right. */
  swipeRight: SwipeChoice;
};

export const LIST_PREFS_KEY = "mailboat.list";

/** As before there was a choice: left archives, right toggles read. */
export const DEFAULT_LIST_PREFS: ListPrefs = { swipeLeft: "archive", swipeRight: "read" };

const pick = (value: unknown, fallback: SwipeChoice) =>
  SWIPE_CHOICES.find((c) => c === value) ?? fallback;

/** What was saved, with anything missing or unknown at its default. */
export function parseListPrefs(raw: string | null): ListPrefs {
  let saved: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === "object") saved = parsed as Record<string, unknown>;
  } catch {
    // Fall through to the defaults.
  }
  return {
    swipeLeft: pick(saved.swipeLeft, DEFAULT_LIST_PREFS.swipeLeft),
    swipeRight: pick(saved.swipeRight, DEFAULT_LIST_PREFS.swipeRight),
  };
}
