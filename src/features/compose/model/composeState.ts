import type { ThreadId } from "../../../platform/tauri/bindings";
import { type Draft, hasChanges } from "./draft";

/** A draft on screen, and how sending it is going. */
export type ComposeEntry = {
  draft: Draft;
  sending: boolean;
  error: string | null;
  /** Bumped to ask the composer to take focus again. */
  focusKey: number;
};

/**
 * Everything being written: the floating card (new messages) and inline
 * replies, at most one per conversation.
 */
export type ComposeState = {
  card: ComposeEntry | null;
  replies: ComposeEntry[];
};

export const EMPTY: ComposeState = { card: null, replies: [] };

function entry(draft: Draft, focusKey = 0): ComposeEntry {
  return { draft, sending: false, error: null, focusKey };
}

/** Opens the card, unless one with writing in it is already open (that one gets focus). */
export function openCard(state: ComposeState, draft: Draft): ComposeState {
  if (state.card && hasChanges(state.card.draft)) return focus(state, state.card.draft.id);
  return { ...state, card: entry(draft) };
}

/**
 * Opens a reply in its conversation. A reply already there with writing
 * in it is kept (and focused) rather than thrown away; an untouched one
 * is replaced, so `r` then `a` switches to reply-all.
 */
export function openReply(state: ComposeState, draft: Draft): ComposeState {
  const existing = replyIn(state, draft.threadId);
  if (existing && hasChanges(existing.draft)) return focus(state, existing.draft.id);
  const others = state.replies.filter((r) => r.draft.threadId !== draft.threadId);
  return { ...state, replies: [...others, entry(draft)] };
}

export function replyIn(state: ComposeState, threadId: ThreadId | null): ComposeEntry | undefined {
  return state.replies.find((r) => r.draft.threadId === threadId);
}

function mapEntry(
  state: ComposeState,
  id: number,
  change: (e: ComposeEntry) => ComposeEntry,
): ComposeState {
  return {
    card: state.card?.draft.id === id ? change(state.card) : state.card,
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
    card: state.card?.draft.id === id ? null : state.card,
    replies: state.replies.filter((r) => r.draft.id !== id),
  };
}
