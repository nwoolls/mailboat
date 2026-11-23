/** How close to the end of the reader still counts as at the end, in pixels (rounding). */
export const AT_END_PX = 2;

/**
 * Whether a reply being written stays stuck to the bottom of the reader
 * after it scrolled (owner, 2026-11-23). Only the person moves it: a
 * scroll with no sign of their hand on it (`byHand`: a wheel, a scrolling
 * key, the scroll bar held, the pointer over an email) changes nothing.
 * The layout moves the reader too, without anyone touching it: content
 * shrinking pulls it up to a shorter end (clicking one of the assistant's
 * ideas did, for a moment, between frames), and content growing above it
 * can move it down to keep the view in place. Read from where the reader
 * ended up, those looked like the person scrolling, and let go of the reply
 * or caught it again.
 *
 * By hand: moved down to the end, stuck (scrolling back down joins the
 * reply to its bar again); moved up short of the end, let go (the person
 * is reading); otherwise, or not moved at all, as it was.
 */
export function stuckAfterScroll(
  stuck: boolean,
  at: { top: number; lastTop: number; end: number; byHand: boolean },
): boolean {
  if (!at.byHand || Math.abs(at.top - at.lastTop) < 0.5) return stuck;
  const atEnd = at.top >= at.end - AT_END_PX;
  if (at.top < at.lastTop) return atEnd && stuck;
  return atEnd || stuck;
}
