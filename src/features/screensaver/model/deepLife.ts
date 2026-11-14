/**
 * Life in the Toybox's styles (UX Spike 5). Its rules and cycle are the
 * Life scene's own (`life.ts`: seeded from the words, the pointer seeding
 * more, fading and starting again); `ui/lifeDraw.ts` draws each cell as a
 * chunky tile (pixel art) or a character on the glow's grid (ASCII art).
 * The numbers are in `DeepLifeTuning`, for the playground; the app uses
 * `DEEP_LIFE_DEFAULTS`.
 */
export type DeepLifeTuning = {
  /** Pixel art's tile size, in screen pixels (a restart shows a change). */
  pixel: number;
  /** The soft light round newborn cells (0 is none). */
  glow: number;
};

export const DEEP_LIFE_DEFAULTS: DeepLifeTuning = {
  pixel: 8,
  glow: 0.5,
};

let tuning: DeepLifeTuning = DEEP_LIFE_DEFAULTS;

/** What Life uses; the defaults unless the playground changed it. */
export function deepLifeTuning(): DeepLifeTuning {
  return tuning;
}

/** For the playground only. */
export function setDeepLifeTuning(next: DeepLifeTuning) {
  tuning = next;
}

/** A cell's ASCII character by how many generations it has lived: newborn `@`, settling to `.`. */
export function lifeChar(age: number): string {
  return age < 3 ? "@" : age < 12 ? "O" : age < 30 ? "o" : ".";
}
