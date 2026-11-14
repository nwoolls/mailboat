/**
 * The fireflies in the Toybox's styles (UX Spike 5). Their motion is the
 * firefly scene's own (`fireflies.ts`: drifting, blinking into step,
 * gathering into the boat, drifting to the pointer); `ui/deepFirefliesDraw.ts`
 * draws it in chunky pixel art or ASCII art: each flash a field of light,
 * over a grass silhouette swaying along the bottom, and on a light page a
 * dusk sky. The numbers are in `DeepFireflyTuning`, for the playground;
 * the app uses `DEEP_FIREFLY_DEFAULTS`.
 */
export type DeepFireflyTuning = {
  /** How many fireflies (a restart shows a change). */
  count: number;
  /** How often each flashes, a second (about). */
  flashes: number;
  /** Pixel art's block size, in screen pixels. */
  pixel: number;
  /** How far a flash's light reaches, as a share of the scene's own. */
  reach: number;
  /** The soft bloom round each flash (0 is none). */
  bloom: number;
  /** How tall the grass is, as a share of the area's height (0 is none). */
  grass: number;
};

export const DEEP_FIREFLY_DEFAULTS: DeepFireflyTuning = {
  // Fewer and calmer than the fine scene's 38 at about one flash every two
  // seconds, and smaller (owner, 2026-11-13: "they flash too often, or
  // there's too many fireflies, or both"; reach 0.65 "looks better").
  count: 26,
  flashes: 0.32,
  pixel: 4,
  reach: 0.65,
  bloom: 0.6,
  grass: 0.12,
};

let tuning: DeepFireflyTuning = DEEP_FIREFLY_DEFAULTS;

/** What the fireflies use; the defaults unless the playground changed it. */
export function deepFireflyTuning(): DeepFireflyTuning {
  return tuning;
}

/** For the playground only. */
export function setDeepFireflyTuning(next: DeepFireflyTuning) {
  tuning = next;
}

/** ASCII art's light, faint to bright: a flash's heart is `@`. */
export const GLOW_RAMP = ".:+*#@";

/** The character for a cell lit `light` (0–1 and up), or null when too dark. */
export function glowChar(light: number): string | null {
  if (light < 0.06) return null;
  const top = GLOW_RAMP.length - 1;
  return GLOW_RAMP[Math.min(top, Math.floor(Math.sqrt(Math.min(1, light)) * (top + 0.999)))]!;
}

/**
 * How tall the grass is at `x` (screen pixels), 0–1 of its full height:
 * tufts of uneven blades, the same each time.
 */
export function grassHeight(x: number): number {
  const a =
    Math.sin(x * 0.091) * 0.5 + Math.sin(x * 0.23 + 1.7) * 0.3 + Math.sin(x * 0.61 + 4.1) * 0.2;
  return 0.45 + 0.55 * (0.5 + 0.5 * a);
}

/** The fireflies' usual flashes a second, each (`fireflies.ts`), for `pace`. */
export const USUAL_FLASHES = 0.5;
