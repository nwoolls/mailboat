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

/** How much room each row has around its text. */
export type Density = "compact" | "default" | "roomy";

/** Lines of the email's first words (or AI summary) under the subject. */
export type PreviewLines = 0 | 1 | 2;

/** Settings → List; window-only, kept in the web view's storage. */
export type ListPrefs = {
  density: Density;
  previewLines: PreviewLines;
  /** Fingers moving left (the button shows at the right). */
  swipeLeft: SwipeChoice;
  /** Fingers moving right. */
  swipeRight: SwipeChoice;
};

export const LIST_PREFS_KEY = "prefs.list";

/** As before there was a choice: left archives, right toggles read. */
export const DEFAULT_LIST_PREFS: ListPrefs = {
  density: "default",
  previewLines: 1,
  swipeLeft: "archive",
  swipeRight: "read",
};

/**
 * A row's height plus the 4px gap to the next, before text size zooms it.
 * Default with one preview line is the 72 it always was; each preview
 * line is a 16px line of small text with its 2px gap (none when compact,
 * whose lines sit together: see `tests/browser/list-density.spec.ts`).
 */
export function rowStep(prefs: Pick<ListPrefs, "density" | "previewLines">): number {
  const base = { compact: 64, default: 72, roomy: 84 }[prefs.density];
  const line = prefs.density === "compact" ? 16 : 18;
  return base + (prefs.previewLines - 1) * line;
}

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
  const d = DEFAULT_LIST_PREFS;
  return {
    density:
      (["compact", "default", "roomy"] as const).find((x) => x === saved.density) ?? d.density,
    previewLines: ([0, 1, 2] as const).find((x) => x === saved.previewLines) ?? d.previewLines,
    swipeLeft: pick(saved.swipeLeft, DEFAULT_LIST_PREFS.swipeLeft),
    swipeRight: pick(saved.swipeRight, DEFAULT_LIST_PREFS.swipeRight),
  };
}
