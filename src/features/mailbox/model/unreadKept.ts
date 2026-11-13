import type { ThreadId, ThreadSummary } from "../../../platform/tauri/bindings";
import { type ThreadAction, updateSummary } from "./threadActions";

/**
 * Conversations read during a visit to the Unread view (owner, 2026-11-12).
 * Reading one there used to drop it from the list at once, under the
 * pointer and the selection. They stay, shown as read, until the person
 * leaves the view; the next visit lists only what is unread.
 *
 * The Unread list only ever brings unread conversations, so a row in it
 * that shows as read was read during this visit (the list marks it read at
 * once, then refreshes without it).
 */
export type Kept = ReadonlyMap<ThreadId, ThreadSummary>;

export const NOTHING_KEPT: Kept = new Map();

/** `kept` with the rows of `listed` that are now read added (or refreshed). */
export function keepRead(kept: Kept, listed: readonly ThreadSummary[]): Kept {
  const read = listed.filter((t) => !t.unread);
  const changed = read.filter((t) => kept.get(t.id) !== t);
  if (changed.length === 0) return kept;
  const next = new Map(kept);
  for (const t of changed) next.set(t.id, t);
  return next;
}

/**
 * The list as shown: `listed`, with the kept rows it no longer has put back
 * in their place (newest first, as the list is ordered).
 */
export function withKept(listed: readonly ThreadSummary[], kept: Kept): ThreadSummary[] {
  if (kept.size === 0) return [...listed];
  const present = new Set(listed.map((t) => t.id));
  const back = [...kept.values()].filter((t) => !present.has(t.id));
  if (back.length === 0) return [...listed];
  // Newest first, then the higher id, as the list is ordered.
  const before = (a: ThreadSummary, b: ThreadSummary) =>
    a.lastMessageAt !== b.lastMessageAt ? a.lastMessageAt > b.lastMessageAt : a.id > b.id;
  const out: ThreadSummary[] = [];
  const rest = back.toSorted((a, b) => (before(a, b) ? -1 : 1));
  for (const t of listed) {
    while (rest.length > 0 && before(rest[0]!, t)) out.push(rest.shift()!);
    out.push(t);
  }
  return [...out, ...rest];
}

/**
 * `kept` after an action on `ids`: marked read or unread, a kept row shows
 * it; anything else (archived, deleted, labeled away, …) lets it go, as the
 * list will.
 */
export function keptAfter(kept: Kept, ids: readonly ThreadId[], action: ThreadAction): Kept {
  const hit = ids.filter((id) => kept.has(id));
  if (hit.length === 0) return kept;
  const next = new Map(kept);
  for (const id of hit) {
    if (action.kind === "read") next.set(id, updateSummary(action, kept.get(id)!));
    else next.delete(id);
  }
  return next;
}
