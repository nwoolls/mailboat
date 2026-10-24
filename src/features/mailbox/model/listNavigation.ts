import type { ThreadId, ThreadSummary } from "../../../platform/tauri/bindings";

export type NavKey = "next" | "prev" | "first" | "last" | "pageNext" | "pagePrev";

const KEYS: Record<string, NavKey> = {
  j: "next",
  ArrowDown: "next",
  k: "prev",
  ArrowUp: "prev",
  Home: "first",
  End: "last",
  PageDown: "pageNext",
  PageUp: "pagePrev",
};

/** Maps a keydown to a list movement, ignoring keys typed into inputs or with modifiers. */
export function navKeyFor(
  e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey"> & { shiftKey?: boolean },
  inEditable: boolean,
): NavKey | null {
  if (inEditable || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return null;
  return KEYS[e.key] ?? null;
}

/** The thread to select after a movement. Starts at the top when nothing is selected. */
export function moveSelection(
  threads: Pick<ThreadSummary, "id">[],
  current: ThreadId | null,
  key: NavKey,
  /** Rows a page moves (PageDown / PageUp): about a screenful. */
  page = 10,
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
    case "pageNext":
      next = index < 0 ? 0 : Math.min(index + page, last);
      break;
    case "pagePrev":
      next = index < 0 ? 0 : Math.max(index - page, 0);
      break;
  }
  return threads[next]?.id ?? null;
}

/**
 * j/k (or the arrows): with a preview showing, the next conversation is
 * previewed; without, only the selection moves, and nothing opens until
 * Enter, `o` or a click (owner, 2026-10-24).
 */
export function moveKeyboard(
  threads: Pick<ThreadSummary, "id">[],
  at: { previewed: ThreadId | null; selected: ThreadId | null; previewing: boolean },
  key: NavKey,
  page?: number,
): { previewed: ThreadId | null; selected: ThreadId | null } {
  if (at.previewing && at.previewed !== null)
    return { previewed: moveSelection(threads, at.previewed, key, page), selected: null };
  return {
    previewed: null,
    selected: moveSelection(threads, at.previewed ?? at.selected, key, page),
  };
}

/** ⇧↓ / ⇧↑: which way a range grows, or null for other keys. */
export function rangeKeyFor(
  e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
  inEditable: boolean,
): "next" | "prev" | null {
  if (inEditable || !e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return null;
  return e.key === "ArrowDown" ? "next" : e.key === "ArrowUp" ? "prev" : null;
}
