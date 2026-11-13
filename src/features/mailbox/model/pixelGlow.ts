/**
 * The empty list's glow in pixel art (Settings → Toybox → Style, owner,
 * 2026-11-13: chunkier pixels, "retro NES / SNES HD-2D"): the same glow,
 * following the pointer as before, drawn on a grid of chunky pixels in a
 * few bands of the accent color that dither into each other, over a faint
 * smooth glow (the soft light of HD-2D games), leaving a short fading
 * trail as it moves.
 *
 * Pure logic here; `ui/PixelGlow.tsx` draws it. The look's numbers are in
 * `PixelGlowTuning`, for the playground; the app uses `PIXEL_GLOW_DEFAULTS`.
 */
export type PixelGlowTuning = {
  /** Screen pixels per block. */
  pixel: number;
  /** How many bands from the edge to the middle. */
  bands: number;
  /** The brightest band's opacity, per theme. */
  peakDark: number;
  peakLight: number;
  /** How much the bands dither into each other (0 is hard steps). */
  dither: number;
  /** The glow's radius, as a multiple of the gradient glow's own (190px). */
  radiusScale: number;
  /** The faint smooth glow underneath, as a share of the peak (0 is none). */
  bloom: number;
  /** Seconds the trail behind a moving glow takes to fade (to ~37%), and how bright it is. */
  wakeSeconds: number;
  wakeStrength: number;
};

export const PIXEL_GLOW_DEFAULTS: PixelGlowTuning = {
  pixel: 5,
  bands: 4,
  peakDark: 0.34,
  peakLight: 0.3,
  dither: 0.6,
  radiusScale: 1,
  bloom: 0.15,
  wakeSeconds: 0.45,
  wakeStrength: 0.6,
};

let tuning: PixelGlowTuning = PIXEL_GLOW_DEFAULTS;

/** What the glow draws with; the defaults unless the playground changed it. */
export function pixelGlowTuning(): PixelGlowTuning {
  return tuning;
}

/** For the playground only. */
export function setPixelGlowTuning(next: PixelGlowTuning) {
  tuning = next;
}

/** Bayer 4×4: ordered dithering's thresholds, 0–1. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

/**
 * The band (0 none, up to `bands`) for a block of brightness `v` (0–1) at
 * block (x, y): stepped, with the steps dithered by the block's place.
 */
export function glowBand(v: number, x: number, y: number, t: PixelGlowTuning): number {
  if (v <= 0) return 0;
  const threshold = (BAYER[(((y % 4) + 4) % 4) * 4 + (((x % 4) + 4) % 4)]! - 0.5) * t.dither;
  return Math.max(0, Math.min(t.bands, Math.floor(v * t.bands + 0.5 + threshold)));
}

/** A band's opacity: evenly up to the peak. */
export function bandAlpha(band: number, dark: boolean, t: PixelGlowTuning): number {
  return (band / t.bands) * (dark ? t.peakDark : t.peakLight);
}
