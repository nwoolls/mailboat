import type { ThreadId, ThreadSummary } from "../../../platform/tauri/bindings";

/**
 * Picking several conversations, as in Mail and Finder: ⌘-click (or `x`)
 * toggles one, ⇧-click picks the range from the open conversation. The
 * open conversation (shown in the reader) counts as picked when the first
 * ⌘-click starts a multi-selection.
 */
export type Checked = ReadonlySet<ThreadId>;

export const NONE: Checked = new Set();

/** ⌘-click / `x`: toggle one conversation. */
export function toggleChecked(checked: Checked, open: ThreadId | null, id: ThreadId): Checked {
  const next = new Set(checked);
  if (next.size === 0 && open !== null && open !== id) next.add(open);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** ⇧-click: everything between the open conversation and this one. */
export function rangeChecked(
  threads: Pick<ThreadSummary, "id">[],
  checked: Checked,
  open: ThreadId | null,
  id: ThreadId,
): Checked {
  const to = threads.findIndex((t) => t.id === id);
  const from = open === null ? to : threads.findIndex((t) => t.id === open);
  if (to < 0) return checked;
  const [lo, hi] = from < 0 ? [to, to] : [Math.min(from, to), Math.max(from, to)];
  const next = new Set(checked);
  for (let i = lo; i <= hi; i++) next.add(threads[i]!.id);
  return next;
}

/** Which conversations an action applies to: the picked ones, else the open one. */
export function actionTargets<T extends Pick<ThreadSummary, "id">>(
  threads: T[],
  checked: Checked,
  open: ThreadId | null,
): T[] {
  if (checked.size > 0) return threads.filter((t) => checked.has(t.id));
  const one = threads.find((t) => t.id === open);
  return one ? [one] : [];
}

/**
 * What a right-click menu acts on: all the picks when the clicked row is
 * one of them, otherwise just the clicked row. The open conversation is
 * left as it is (a right-click never opens anything).
 */
export function menuTargets<T extends Pick<ThreadSummary, "id">>(
  threads: T[],
  checked: Checked,
  clicked: ThreadId,
): T[] {
  if (checked.has(clicked)) return threads.filter((t) => checked.has(t.id));
  const one = threads.find((t) => t.id === clicked);
  return one ? [one] : [];
}

/** Picks that are still in the list (the rest were archived, trashed, …). */
export function prune(checked: Checked, threads: Pick<ThreadSummary, "id">[]): Checked {
  if (checked.size === 0) return checked;
  const present = new Set(threads.map((t) => t.id));
  const kept = [...checked].filter((id) => present.has(id));
  return kept.length === checked.size ? checked : new Set(kept);
}
