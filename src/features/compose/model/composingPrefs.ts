import type { AccountId } from "../../../platform/tauri/bindings";
import { FONTS, SIZES, type TextStyle } from "./fonts";

/** Settings → Composing; window-only, kept in the web view's storage. */
export type ComposingPrefs = {
  /** How long Undo send holds a message before it goes (Gmail's choices). */
  undoSendSeconds: UndoSendSeconds;
  /**
   * The address new mail starts from, or null for the account being
   * viewed (as before). Replies still start from the conversation's.
   */
  defaultFrom: { accountId: AccountId; email: string } | null;
  /** The font and size new messages and replies start in. */
  style: TextStyle;
};

export type UndoSendSeconds = 5 | 10 | 20 | 30;

export const UNDO_SEND_CHOICES: readonly UndoSendSeconds[] = [5, 10, 20, 30];

export const COMPOSING_PREFS_KEY = "mailboat.composing";

/** 5 seconds (Gmail's default), From the viewed account, no font set: as before. */
export const DEFAULT_COMPOSING_PREFS: ComposingPrefs = {
  undoSendSeconds: 5,
  defaultFrom: null,
  style: { font: "", size: "" },
};

function parseFrom(value: unknown): ComposingPrefs["defaultFrom"] {
  if (!value || typeof value !== "object") return null;
  const { accountId, email } = value as Record<string, unknown>;
  return typeof accountId === "number" && typeof email === "string" && email
    ? { accountId, email }
    : null;
}

/** What was saved, with anything missing or unknown at its default. */
export function parseComposingPrefs(raw: string | null): ComposingPrefs {
  let saved: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === "object") saved = parsed as Record<string, unknown>;
  } catch {
    // Fall through to the defaults.
  }
  const style = (saved.style ?? {}) as Record<string, unknown>;
  return {
    undoSendSeconds:
      UNDO_SEND_CHOICES.find((s) => s === saved.undoSendSeconds) ??
      DEFAULT_COMPOSING_PREFS.undoSendSeconds,
    defaultFrom: parseFrom(saved.defaultFrom),
    style: {
      font: FONTS.find(([, family]) => family === style.font)?.[1] ?? "",
      size: SIZES.find(([, size]) => size === style.size)?.[1] ?? "",
    },
  };
}
