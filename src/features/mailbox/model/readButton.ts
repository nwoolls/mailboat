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
