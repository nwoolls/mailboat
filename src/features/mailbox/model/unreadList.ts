import { type InfiniteData, replaceEqualDeep } from "@tanstack/react-query";
import type { ThreadPage, ThreadSummary } from "../../../platform/tauri/bindings";

/**
 * The Unread view keeps what was read during a visit (owner, 2026-11-12).
 * Reading a conversation there used to drop it from the list at once, under
 * the pointer and the selection. Now, while the view stays open, a refresh
 * keeps the conversations it left out, shown as read, in their place; when
 * the person leaves the view its list is forgotten (`Shell`), so the next
 * visit lists only what is unread.
 *
 * It's done in the Unread list's own cached data (the query's
 * `structuralSharing`), not beside it, so the app's own updates, their
 * rollback on failure, and Undo work on these rows as on any other (code
 * review: a separate copy needed each of them again).
 */

/**
 * A list update the app made itself (an action's immediate update,
 * `withAction`): taken as it is, so a conversation moved to Trash really
 * goes. Fetched lists don't carry it.
 */
export type ListData = InfiniteData<ThreadPage> & { local?: true };

/** Whether `a` comes before `b` in the list: newest first, then the higher id. */
function before(a: ThreadSummary, b: ThreadSummary): boolean {
  return a.lastMessageAt !== b.lastMessageAt ? a.lastMessageAt > b.lastMessageAt : a.id > b.id;
}

/**
 * The Unread list's new data, with what the previous data had and the new
 * one left out kept, marked read, in its place. A local update is taken as
 * it is. Unchanged rows keep their identity (`replaceEqualDeep`), as the
 * query's default does.
 */
export function keepReadRows(prev: ListData | undefined, next: ListData): ListData {
  if (next.local) {
    const { local: _local, ...data } = next;
    return replaceEqualDeep(prev, data);
  }
  if (!prev) return next;
  const present = new Set(next.pages.flatMap((p) => p.threads.map((t) => t.id)));
  const missing = prev.pages
    .flatMap((p) => p.threads)
    .filter((t) => !present.has(t.id))
    .map((t) => (t.unread ? { ...t, unread: false } : t))
    .toSorted((a, b) => (before(a, b) ? -1 : 1));
  if (missing.length === 0 || next.pages.length === 0) return replaceEqualDeep(prev, next);
  const pages = next.pages.map((p) => ({ ...p, threads: [...p.threads] }));
  for (const row of missing) {
    // Before the first row it comes before; when that's the first row of a
    // page, at the end of the page before it. At the very end when it comes
    // after them all.
    let placed = false;
    for (const [i, page] of pages.entries()) {
      const at = page.threads.findIndex((t) => before(row, t));
      if (at < 0) continue;
      if (at === 0 && i > 0) pages[i - 1]!.threads.push(row);
      else page.threads.splice(at, 0, row);
      placed = true;
      break;
    }
    if (!placed) pages.at(-1)!.threads.push(row);
  }
  return replaceEqualDeep(prev, { ...next, pages });
}
