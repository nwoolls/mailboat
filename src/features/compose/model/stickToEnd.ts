/** How close to the end of the reader still counts as at the end, in pixels (rounding). */
export const AT_END_PX = 2;

/**
 * Whether a reply being written stays stuck to the bottom of the reader
 * after it scrolled (owner, 2026-11-23). Moved down to the end: stuck (the
 * person scrolling back down joins the reply to its bar again). Moved up
 * and not at the end: the person is reading, so it lets go. Moved down but
 * not there yet (the scroll that opens the reply, or the person scrolling
 * down), or not moved at all: unchanged.
 *
 * Content growing while stuck doesn't scroll the reader, so it never shows
 * here; the reader is put back at its end for it. Content shrinking clamps
 * the reader up to its new end, and content growing above can move it down
 * by as much (the browser keeping the view in place): both keep whatever it
 * was, since the person didn't move (a released reply isn't caught again
 * by an email or the assistant opening or closing).
 */
export function stuckAfterScroll(
  stuck: boolean,
  at: { top: number; lastTop: number; end: number; lastEnd: number },
): boolean {
  const atEnd = at.top >= at.end - AT_END_PX;
  if (at.top < at.lastTop) return atEnd && stuck;
  // Not moved at all (WebKit sends a second scroll after a clamp): as it was.
  if (Math.abs(at.top - at.lastTop) < 0.5) return stuck;
  // Moved down by just as much as the content grew: the browser keeping
  // what's on screen in place as something above grew (scroll anchoring),
  // not the person. A released reply sitting at the end stays released.
  const grew = at.end - at.lastEnd;
  if (grew > 0 && Math.abs(at.top - at.lastTop - grew) <= 1) return stuck;
  return atEnd || stuck;
}
