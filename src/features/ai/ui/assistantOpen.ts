import { useSyncExternalStore } from "react";
import type { ThreadId } from "../../../platform/tauri/bindings";
import type { Draft } from "../../compose/model/draft";

/**
 * Whether each message's writing assistant is open, by draft, kept here
 * rather than in the card so it survives minimising and restoring the
 * card, and popping a reply out of the reader.
 */
const open = new Map<number, boolean>();
/** Conversations whose next reply should open with the assistant ("Reply with AI"). */
const wanted = new Set<ThreadId>();
const subscribers = new Set<() => void>();
let version = 0;

function changed() {
  version++;
  for (const s of subscribers) s();
}

/**
 * Whether a message's assistant is open. The first reply to ask after
 * "Reply with AI" takes the wish for itself, so it doesn't outlive that
 * reply: discarded, the next plain Reply opened with the chat (owner
 * report, 2026-10-24). Nothing else's answer changes, so no one is told.
 */
export function assistantOpen(draft: Pick<Draft, "id" | "kind" | "threadId">): boolean {
  const chosen = open.get(draft.id);
  if (chosen !== undefined) return chosen;
  if (draft.kind === "new" || draft.threadId === null || !wanted.has(draft.threadId)) return false;
  wanted.delete(draft.threadId);
  open.set(draft.id, true);
  return true;
}

export function setAssistantOpen(draft: Pick<Draft, "id" | "threadId">, value: boolean) {
  open.set(draft.id, value);
  if (draft.threadId !== null) wanted.delete(draft.threadId);
  changed();
}

/** The reply about to be started in this conversation opens with the assistant. */
export function openAssistantForNextReply(thread: ThreadId) {
  wanted.add(thread);
  changed();
}

/** Forgets a message's choice once it's sent or closed. */
export function forgetAssistant(draft: Pick<Draft, "id" | "threadId">) {
  open.delete(draft.id);
  if (draft.threadId !== null) wanted.delete(draft.threadId);
  changed();
}

/** [open, setOpen] for a message's assistant. */
export function useAssistantOpen(
  draft: Pick<Draft, "id" | "kind" | "threadId">,
): [boolean, (value: boolean) => void] {
  useSyncExternalStore(
    (notify) => {
      subscribers.add(notify);
      return () => subscribers.delete(notify);
    },
    () => version,
  );
  return [assistantOpen(draft), (value) => setAssistantOpen(draft, value)];
}
