/**
 * Rain on the glass in the Toybox's styles (UX Spike 5). Its motion is the
 * rain scene's own (`rain.ts`: fog, beads, drops that cling and slide
 * leaving wet trails, the puddle on the icon, the pointer's wipe);
 * `ui/deepRainDraw.ts` draws it in chunky pixel art or ASCII art instead of
 * converting its fine cells. The numbers are in `DeepRainTuning`, for the
 * playground; the app uses `DEEP_RAIN_DEFAULTS`.
 */
export type DeepRainTuning = {
  /** Pixel art's block size, in screen pixels. */
  pixel: number;
  /** How thick the fog on the glass looks (0 is none). */
  fog: number;
  /** The soft light round each drop's glint (0 is none). */
  glint: number;
  /** How bright a fresh wet trail is (0 is none). */
  trail: number;
};

export const DEEP_RAIN_DEFAULTS: DeepRainTuning = {
  pixel: 3,
  fog: 1,
  glint: 0.5,
  trail: 1,
};

let tuning: DeepRainTuning = DEEP_RAIN_DEFAULTS;

/** What the rain uses; the defaults unless the playground changed it. */
export function deepRainTuning(): DeepRainTuning {
  return tuning;
}

/** For the playground only. */
export function setDeepRainTuning(next: DeepRainTuning) {
  tuning = next;
}

/** A drop's ASCII character by its size (radius in the scene's cells): bigger drops, rounder and bolder. */
export function dropChar(r: number): string {
  return r < 1.5 ? "." : r < 3 ? "o" : r < 5 ? "O" : "@";
}

/**
 * Which part of a drop a point is in, seen as a lens: `nx`, `ny` from its
 * middle as shares of its radii (y down). Its glint at the top left, its
 * dark rim, the light it gathers at its bottom, and see-through between.
 */
export function lensPart(
  nx: number,
  ny: number,
  big: boolean,
): "glint" | "rim" | "low" | "clear" | null {
  const r = Math.hypot(nx, ny);
  if (r > 1) return null;
  const gx = nx + 0.35;
  const gy = ny + 0.42;
  if (big && gx * gx + gy * gy < 0.07) return "glint";
  if (r > 0.74) return "rim";
  if (ny > 0.2 && r > 0.4) return "low";
  return "clear";
}
