/** Settings → Composing; window-only, kept in the web view's storage. */
export type ComposingPrefs = {
  /** How long Undo send holds a message before it goes (Gmail's choices). */
  undoSendSeconds: UndoSendSeconds;
};

export type UndoSendSeconds = 5 | 10 | 20 | 30;

export const UNDO_SEND_CHOICES: readonly UndoSendSeconds[] = [5, 10, 20, 30];

export const COMPOSING_PREFS_KEY = "mailboat.composing";

/** 5 seconds, Gmail's default and what Mailboat always did before. */
export const DEFAULT_COMPOSING_PREFS: ComposingPrefs = { undoSendSeconds: 5 };

/** What was saved, with anything missing or unknown at its default. */
export function parseComposingPrefs(raw: string | null): ComposingPrefs {
  let saved: unknown;
  try {
    saved = raw ? JSON.parse(raw) : null;
  } catch {
    saved = null;
  }
  const seconds = (saved as { undoSendSeconds?: unknown } | null)?.undoSendSeconds;
  return {
    undoSendSeconds:
      UNDO_SEND_CHOICES.find((s) => s === seconds) ?? DEFAULT_COMPOSING_PREFS.undoSendSeconds,
  };
}
