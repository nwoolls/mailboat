import type { MailView, ThreadId, ThreadSummary } from "../../../platform/tauri/bindings";
import { leavesView, type ThreadAction, updateSummary } from "./threadActions";

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

/**
 * `kept` after the Unread list came in: its read rows are kept, and rows
 * already kept take the list's newer copy, unread too (a newer message), so
 * a kept row never goes back to an old copy. Not while the list still shows
 * the previous view (`placeholder`, as the list does while a view loads):
 * its read rows weren't read here (code review).
 */
export function keepRead(
  kept: Kept,
  listed: readonly ThreadSummary[],
  { placeholder = false }: { placeholder?: boolean } = {},
): Kept {
  if (placeholder) return kept;
  const changed = listed.filter((t) => (!t.unread || kept.has(t.id)) && kept.get(t.id) !== t);
  if (changed.length === 0) return kept;
  const next = new Map(kept);
  for (const t of changed) next.set(t.id, t);
  return next;
}

/** Whether `a` comes before `b` in the list: newest first, then the higher id. */
function before(a: ThreadSummary, b: ThreadSummary): boolean {
  return a.lastMessageAt !== b.lastMessageAt ? a.lastMessageAt > b.lastMessageAt : a.id > b.id;
}

/**
 * The list as shown: `listed`, with the kept rows it no longer has put back
 * in their place.
 */
export function withKept(listed: readonly ThreadSummary[], kept: Kept): ThreadSummary[] {
  if (kept.size === 0) return [...listed];
  const present = new Set(listed.map((t) => t.id));
  // Left out of the Unread list, so read, whatever the kept copy says.
  const back = [...kept.values()]
    .filter((t) => !present.has(t.id))
    .map((t) => (t.unread ? { ...t, unread: false } : t));
  if (back.length === 0) return [...listed];
  const out: ThreadSummary[] = [];
  const rest = back.toSorted((a, b) => (before(a, b) ? -1 : 1));
  for (const t of listed) {
    while (rest.length > 0 && before(rest[0]!, t)) out.push(rest.shift()!);
    out.push(t);
  }
  return [...out, ...rest];
}

/**
 * `kept` after an action on `ids` in `view`: as for any row there, one the
 * action takes out of the view (Trash, Spam) goes; otherwise it shows the
 * change (read or unread, starred, labeled, archived: none of these take a
 * conversation out of Unread).
 */
export function keptAfter(
  kept: Kept,
  ids: readonly ThreadId[],
  action: ThreadAction,
  view: MailView,
): Kept {
  const hit = ids.filter((id) => kept.has(id));
  if (hit.length === 0) return kept;
  const leaves = leavesView(action, view);
  const next = new Map(kept);
  for (const id of hit) {
    if (leaves) next.delete(id);
    else next.set(id, updateSummary(action, kept.get(id)!));
  }
  return next;
}
