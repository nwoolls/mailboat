/** How close to the end of the reader still counts as at the end, in pixels (rounding). */
export const AT_END_PX = 2;

/**
 * Whether a reply being written stays stuck to the bottom of the reader
 * after it scrolled (owner, 2026-11-23). At the end: stuck, whatever moved
 * it there (the person scrolling back down joins the reply to its bar
 * again). Moved up and not at the end: the person is reading, so it lets
 * go. Moved down but not there yet (the scroll that opens the reply, or
 * the person scrolling down): unchanged.
 *
 * Content growing while stuck doesn't scroll the reader, so it never shows
 * here; the reader is put back at its end for it. Content shrinking clamps
 * the reader up to its new end: that keeps whatever it was, since the
 * person didn't move (a released reply isn't caught again by the
 * assistant closing).
 */
export function stuckAfterScroll(
  stuck: boolean,
  at: { top: number; lastTop: number; end: number },
): boolean {
  const atEnd = at.top >= at.end - AT_END_PX;
  if (at.top < at.lastTop) return atEnd && stuck;
  return atEnd || stuck;
}
