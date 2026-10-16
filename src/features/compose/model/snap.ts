/**
 * Where the compose card can rest, like iOS picture-in-picture: the four
 * corners and the middle of each side. Dropped anywhere, it springs to
 * the spot it was heading for.
 */
export type Spot =
  | "top-left"
  | "top"
  | "top-right"
  | "left"
  | "right"
  | "bottom-left"
  | "bottom"
  | "bottom-right";

export const SPOTS: Spot[] = [
  "top-left",
  "top",
  "top-right",
  "left",
  "right",
  "bottom-left",
  "bottom",
  "bottom-right",
];

export type Size = { width: number; height: number };
export type Point = { x: number; y: number };

/** Gap from the window's edges; the top clears the toolbar. */
export const EDGE = 16;
export const TOP_EDGE = 48;

/** Gmail's size, shrunk to fit small windows. */
export function cardSize(viewport: Size): Size {
  return {
    width: Math.min(500, viewport.width - 2 * EDGE),
    height: Math.min(560, viewport.height - TOP_EDGE - EDGE),
  };
}

/** The card's top-left corner when resting at a spot. */
export function spotPosition(spot: Spot, viewport: Size, card: Size): Point {
  const left = EDGE;
  const right = viewport.width - EDGE - card.width;
  const top = TOP_EDGE;
  const bottom = viewport.height - EDGE - card.height;
  const midX = (left + right) / 2;
  const midY = (top + bottom) / 2;
  const x = spot.endsWith("left") ? left : spot.endsWith("right") ? right : midX;
  const y = spot.startsWith("top") ? top : spot.startsWith("bottom") ? bottom : midY;
  return { x, y };
}

/**
 * How far ahead a flick carries the card, in seconds of its release
 * speed, so a quick throw lands where it was going, not where it let go.
 */
const PROJECTION_S = 0.18;

/**
 * The spot nearest where the card would come to rest: its position at
 * release plus a bit of its speed (px/s).
 */
export function nearestSpot(at: Point, velocity: Point, viewport: Size, card: Size): Spot {
  const aim = { x: at.x + velocity.x * PROJECTION_S, y: at.y + velocity.y * PROJECTION_S };
  let best: Spot = "bottom-right";
  let bestDistance = Infinity;
  for (const spot of SPOTS) {
    const p = spotPosition(spot, viewport, card);
    const d = Math.hypot(p.x - aim.x, p.y - aim.y);
    if (d < bestDistance) [best, bestDistance] = [spot, d];
  }
  return best;
}
