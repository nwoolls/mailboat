import { useSyncExternalStore } from "react";
import type { ThreadId } from "../../../platform/tauri/bindings";

/**
 * Summaries asked for from outside the reader (⌘K, the menu bar, the
 * right-click menu), counted per conversation. The summary card reads
 * the count: any request means "asked", and one made after Hide shows
 * the card again. Kept for the session, like an answered Summarize.
 */
const requests = new Map<ThreadId, number>();
const subscribers = new Set<() => void>();
let version = 0;

export function requestSummary(thread: ThreadId) {
  requests.set(thread, (requests.get(thread) ?? 0) + 1);
  version++;
  for (const s of subscribers) s();
}

/** How many times this conversation's summary was asked for (0: never). */
export function useSummaryRequests(thread: ThreadId): number {
  useSyncExternalStore(
    (notify) => {
      subscribers.add(notify);
      return () => subscribers.delete(notify);
    },
    () => version,
  );
  return requests.get(thread) ?? 0;
}
