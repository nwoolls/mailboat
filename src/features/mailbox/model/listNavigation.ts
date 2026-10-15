import type { ThreadId, ThreadSummary } from "../../../platform/tauri/bindings";

export type NavKey = "next" | "prev" | "first" | "last";

const KEYS: Record<string, NavKey> = {
  j: "next",
  ArrowDown: "next",
  k: "prev",
  ArrowUp: "prev",
  Home: "first",
  End: "last",
};

/** Maps a keydown to a list movement, ignoring keys typed into inputs or with modifiers. */
export function navKeyFor(
  e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey">,
  inEditable: boolean,
): NavKey | null {
  if (inEditable || e.metaKey || e.ctrlKey || e.altKey) return null;
  return KEYS[e.key] ?? null;
}

/** The thread to select after a movement. Starts at the top when nothing is selected. */
export function moveSelection(
  threads: Pick<ThreadSummary, "id">[],
  current: ThreadId | null,
  key: NavKey,
): ThreadId | null {
  if (threads.length === 0) return null;
  const last = threads.length - 1;
  const index = current === null ? -1 : threads.findIndex((t) => t.id === current);
  let next: number;
  switch (key) {
    case "first":
      next = 0;
      break;
    case "last":
      next = last;
      break;
    case "next":
      next = index < 0 ? 0 : Math.min(index + 1, last);
      break;
    case "prev":
      next = index < 0 ? 0 : Math.max(index - 1, 0);
      break;
  }
  return threads[next]?.id ?? null;
}
