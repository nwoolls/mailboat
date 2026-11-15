import type { MarkRead } from "./viewingPrefs";

/**
 * Which envelope the toolbar's read button shows: open for Mark as read,
 * closed for Mark as unread. A conversation just opened while unread, with
 * Settings → Viewing marking mail read on open, is about to be marked read,
 * so it shows closed from the start, rather than open for a moment and
 * then closed (owner: that switch on every click was distracting). Once
 * it's marked read or unread by hand, the button follows that.
 */
export function readButtonShowsUnread(o: {
  /** The button would mark the conversations unread (they're all read). */
  marksUnread: boolean;
  /** One conversation shown, opened while unread, not marked by hand since. */
  opening: boolean;
  markRead: MarkRead;
}): boolean {
  return o.marksUnread || (o.opening && o.markRead === "open");
}

/**
 * The conversation last opened, and whether it was unread then (`null`
 * until its row is in the list: one opened from a notification while the
 * Inbox loads). Decided once, from the row as it first shows, so marking
 * it read afterwards doesn't change it.
 */
export type Opened<Id> = { id: Id; unread: boolean | null } | null;

/**
 * `opened` after a render: a new conversation opened (`openedNow`) is
 * looked up in `rows`, and one still undecided is decided once its row
 * arrives. The same object when nothing changes.
 */
export function nextOpened<Id>(
  opened: Opened<Id>,
  openedNow: Id | null,
  rows: readonly { id: Id; unread: boolean }[],
): Opened<Id> {
  if (openedNow !== null)
    return { id: openedNow, unread: rows.find((t) => t.id === openedNow)?.unread ?? null };
  if (opened === null || opened.unread !== null) return opened;
  const row = rows.find((t) => t.id === opened.id);
  return row ? { id: opened.id, unread: row.unread } : opened;
}
