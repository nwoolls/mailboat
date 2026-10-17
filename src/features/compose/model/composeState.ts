import type { DraftId, ThreadId } from "../../../platform/tauri/bindings";
import { type Draft, hasChanges } from "./draft";

/** A draft on screen, and how sending it is going. */
export type ComposeEntry = {
  draft: Draft;
  sending: boolean;
  error: string | null;
  /** Bumped to ask the composer to take focus again. */
  focusKey: number;
  /** A new message folded down to a tab along the bottom. */
  minimized: boolean;
  /** Saving to Gmail's Drafts, for the "Saving…" / "Saved" note. */
  save: "saving" | "saved" | "failed" | null;
  /** A reply popped out of its conversation into the floating card. */
  popped: boolean;
};

/**
 * Everything being written: new messages and popped-out replies (at most
 * one open as the floating card, the rest minimised along the bottom) and
 * inline replies, at most one per conversation.
 */
export type ComposeState = {
  cards: ComposeEntry[];
  replies: ComposeEntry[];
};

export const EMPTY: ComposeState = { cards: [], replies: [] };

function entry(draft: Draft, focusKey = 0): ComposeEntry {
  return {
    draft,
    sending: false,
    error: null,
    focusKey,
    minimized: false,
    save: null,
    popped: false,
  };
}

/** The new message showing as the floating card, if any. */
export function openCardEntry(state: ComposeState): ComposeEntry | undefined {
  return state.cards.find((c) => !c.minimized);
}

/**
 * Folds the open card away so another can open: kept (minimised) if it
 * has writing in it, dropped if it's untouched.
 */
function stepAside(cards: ComposeEntry[]): ComposeEntry[] {
  return cards
    .filter((c) => c.minimized || hasChanges(c.draft))
    .map((c) => (c.minimized ? c : minimized(c)));
}

function minimized(c: ComposeEntry): ComposeEntry {
  return { ...c, minimized: true };
}

/** Opens a new message as the card; the one open before is minimised. */
export function openCard(state: ComposeState, draft: Draft): ComposeState {
  return { ...state, cards: [...stepAside(state.cards), entry(draft)] };
}

/** Brings a minimised message back as the card (and focuses it). */
export function expand(state: ComposeState, id: number): ComposeState {
  const target = state.cards.find((c) => c.draft.id === id);
  if (!target) return state;
  const others = stepAside(state.cards.filter((c) => c.draft.id !== id));
  const shown = { ...target, minimized: false, focusKey: target.focusKey + 1 };
  // Keep each tab where it was along the bottom.
  const order = state.cards.map((c) => c.draft.id);
  const cards = [...others, shown].toSorted(
    (a, b) => order.indexOf(a.draft.id) - order.indexOf(b.draft.id),
  );
  return { ...state, cards };
}

export function minimize(state: ComposeState, id: number): ComposeState {
  return mapEntry(state, id, minimized);
}

/**
 * Opens a reply in its conversation. A reply already there with writing
 * in it is kept (and focused) rather than thrown away; an untouched one
 * is replaced, so `r` then `a` switches to reply-all.
 */
export function openReply(state: ComposeState, draft: Draft): ComposeState {
  // One reply per conversation: a popped-out one is brought forward.
  const popped = poppedReplyIn(state, draft.threadId);
  if (popped) return expand(state, popped.draft.id);
  const existing = replyIn(state, draft.threadId);
  if (existing && hasChanges(existing.draft)) return focus(state, existing.draft.id);
  const others = state.replies.filter((r) => r.draft.threadId !== draft.threadId);
  return { ...state, replies: [...others, entry(draft)] };
}

export function replyIn(state: ComposeState, threadId: ThreadId | null): ComposeEntry | undefined {
  return state.replies.find((r) => r.draft.threadId === threadId);
}

/** A reply to this conversation that was popped out into the card. */
export function poppedReplyIn(
  state: ComposeState,
  threadId: ThreadId | null,
): ComposeEntry | undefined {
  return state.cards.find((c) => c.popped && c.draft.threadId === threadId);
}

/**
 * Moves an inline reply into the floating card, as Gmail's pop-out, so
 * other mail can be read while writing. The card open before is minimised.
 */
export function popOut(state: ComposeState, id: number): ComposeState {
  const target = state.replies.find((r) => r.draft.id === id);
  if (!target) return state;
  const shown = { ...target, popped: true, minimized: false, focusKey: target.focusKey + 1 };
  return {
    cards: [...stepAside(state.cards), shown],
    replies: state.replies.filter((r) => r.draft.id !== id),
  };
}

function mapEntry(
  state: ComposeState,
  id: number,
  change: (e: ComposeEntry) => ComposeEntry,
): ComposeState {
  return {
    cards: state.cards.map((c) => (c.draft.id === id ? change(c) : c)),
    replies: state.replies.map((r) => (r.draft.id === id ? change(r) : r)),
  };
}

export function updateDraft(
  state: ComposeState,
  id: number,
  change: (d: Draft) => Draft,
): ComposeState {
  // Editing clears an earlier send error.
  return mapEntry(state, id, (e) => ({ ...e, draft: change(e.draft), error: null }));
}

export function setSending(
  state: ComposeState,
  id: number,
  sending: boolean,
  error: string | null,
) {
  return mapEntry(state, id, (e) => ({ ...e, sending, error }));
}

export function focus(state: ComposeState, id: number): ComposeState {
  return mapEntry(state, id, (e) => ({ ...e, focusKey: e.focusKey + 1 }));
}

export function close(state: ComposeState, id: number): ComposeState {
  return {
    cards: state.cards.filter((c) => c.draft.id !== id),
    replies: state.replies.filter((r) => r.draft.id !== id),
  };
}

export function entryById(state: ComposeState, id: number): ComposeEntry | undefined {
  return [...state.cards, ...state.replies].find((e) => e.draft.id === id);
}

/**
 * Puts a draft back on screen as it was (after Undo send, or when sending
 * failed): a new message (or popped-out reply) as the open card, a reply
 * in its conversation.
 */
export function reopen(state: ComposeState, e: ComposeEntry, error: string | null = null) {
  const back = { ...e, sending: false, error, minimized: false, focusKey: e.focusKey + 1 };
  if (e.draft.kind === "new" || e.popped)
    return { ...state, cards: [...stepAside(state.cards), back] };
  const others = state.replies.filter((r) => r.draft.threadId !== e.draft.threadId);
  return { ...state, replies: [...others, back] };
}

/** Records a save to Gmail's Drafts; not an edit (the send error stays). */
export function setSaved(
  state: ComposeState,
  id: number,
  save: ComposeEntry["save"],
  savedId?: DraftId,
): ComposeState {
  return mapEntry(state, id, (e) => ({
    ...e,
    save,
    draft: savedId === undefined ? e.draft : { ...e.draft, savedId },
  }));
}
