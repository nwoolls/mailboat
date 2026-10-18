/**
 * Whether a pointer event is the user moving the pointer: more than a
 * couple of pixels from the last one. WebKit also sends pointer events
 * without movement when the page changes under a still cursor (a list
 * scrolling, a dialog closing), which mustn't count as the user's doing.
 */
export function isRealMove(
  last: { x: number; y: number } | null,
  e: { clientX: number; clientY: number },
): boolean {
  if (!last) return false;
  return Math.abs(e.clientX - last.x) + Math.abs(e.clientY - last.y) > 2;
}
