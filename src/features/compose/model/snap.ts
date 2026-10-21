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

/** How much wider the card gets with the writing assistant beside the form. */
export const ASSISTANT_WIDTH = 340;

/** Gmail's size, shrunk to fit small windows; wider with the assistant open. */
export function cardSize(viewport: Size, assistant = false): Size {
  return {
    width: Math.min(500 + (assistant ? ASSISTANT_WIDTH : 0), viewport.width - 2 * EDGE),
    height: Math.min(560, viewport.height - TOP_EDGE - EDGE),
  };
}

/** Where the writing assistant sits beside the form, and the card around both. */
export type AssistantLayout = {
  /** The card's left edge and width (the form plus the open panel). */
  left: number;
  width: number;
  /** The side with room for the panel; kept while it opens and closes. */
  side: "left" | "right";
  /** The open panel's width (0 when closed). */
  panelWidth: number;
};

/**
 * The card around the form at `form` (its top-left, where it rests or is
 * dragged to) with the assistant open or closed. The form doesn't move:
 * the panel opens on the side with room, the left first (the card's home
 * is the lower right). Only if neither side has room is the card moved
 * along to keep it in the window, and on a narrow window the panel is
 * narrower.
 */
export function assistantLayout(
  form: Point,
  formSize: Size,
  viewport: Size,
  open: boolean,
): AssistantLayout {
  const roomLeft = form.x - EDGE;
  const roomRight = viewport.width - EDGE - (form.x + formSize.width);
  const side =
    roomLeft >= ASSISTANT_WIDTH || (roomRight < ASSISTANT_WIDTH && roomLeft >= roomRight)
      ? "left"
      : "right";
  const panelWidth = open
    ? Math.max(0, Math.min(ASSISTANT_WIDTH, viewport.width - 2 * EDGE - formSize.width))
    : 0;
  const width = formSize.width + panelWidth;
  const wanted = side === "left" ? form.x - panelWidth : form.x;
  const left = Math.min(Math.max(wanted, EDGE), Math.max(EDGE, viewport.width - EDGE - width));
  return { left, width, side, panelWidth };
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
