/** A ring spreading from where the view was clicked. */
export type Ripple = { x: number; y: number; born: number };

/** How long a ripple lasts, in ms. */
export const RIPPLE_MS = 2400;
/** How far it spreads by the end, in px. */
export const RIPPLE_REACH = 220;
/** Each drop sends out this many rings, a little apart. */
export const RINGS = 3;
export const RING_GAP_MS = 260;
/** Ripples kept at once (rapid clicking stays cheap). */
export const MAX_RIPPLES = 12;

/** Adds a drop, keeping only the newest few. */
export function drop(ripples: Ripple[], x: number, y: number, now: number): Ripple[] {
  return [...ripples, { x, y, born: now }].slice(-MAX_RIPPLES);
}

/** The ones still spreading. */
export function alive(ripples: Ripple[], now: number): Ripple[] {
  return ripples.filter((r) => now - r.born < RIPPLE_MS + (RINGS - 1) * RING_GAP_MS);
}

/**
 * Ring `ring` of a ripple at `now`: its radius and opacity, or null
 * before it starts or after it fades. Eases out, as water slows.
 */
export function ringAt(
  r: Ripple,
  ring: number,
  now: number,
): { radius: number; alpha: number } | null {
  const t = (now - r.born - ring * RING_GAP_MS) / RIPPLE_MS;
  if (t < 0 || t >= 1) return null;
  const eased = 1 - (1 - t) ** 3;
  return { radius: 4 + eased * RIPPLE_REACH, alpha: (1 - t) ** 2 * (1 - ring * 0.25) };
}
