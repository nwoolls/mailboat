/**
 * The Pond toy in chunky pixel art (Settings → Toybox → Style, owner,
 * 2026-11-13: chunkier pixels, "retro NES / SNES HD-2D"). The water is the
 * same simulation (`pond.ts`); it's drawn in blocks on the same grid as the
 * glow and the sky: slopes facing the light in a few stepped bands of the
 * accent color, lighter toward the brightest, with dithered edges; slopes
 * facing away in faint darker bands; droplets as bright blocks; a stone's
 * plop as a quick burst of them, with a soft glow around the splash.
 *
 * The look's numbers are in `PixelPondTuning`, for the playground; the app
 * uses `PIXEL_POND_DEFAULTS`.
 */
export type PixelPondTuning = {
  /** Screen pixels per block. */
  pixel: number;
  /** Bands for lit water, and for water facing away. */
  crestBands: number;
  troughBands: number;
  /** Brightness from a slope facing the light (|shading| × gain), and the darkness from one facing away. */
  crestGain: number;
  troughGain: number;
  /** Below this either way, a block is left clear. */
  cutoff: number;
  /** How much the bands dither into each other (0 is hard steps). */
  dither: number;
  /** The brightest crest band's opacity, and the darkest trough band's. */
  crestPeak: number;
  troughPeak: number;
  /** The soft glow around droplets and the plop (0 is none). */
  bloom: number;
};

export const PIXEL_POND_DEFAULTS: PixelPondTuning = {
  pixel: 5,
  crestBands: 4,
  troughBands: 2,
  crestGain: 4.5,
  troughGain: 2.5,
  cutoff: 0.08,
  dither: 0.6,
  crestPeak: 0.85,
  troughPeak: 0.3,
  bloom: 0.5,
};

let tuning: PixelPondTuning = PIXEL_POND_DEFAULTS;

/** What the pond draws with; the defaults unless the playground changed it. */
export function pixelPondTuning(): PixelPondTuning {
  return tuning;
}

/** For the playground only. */
export function setPixelPondTuning(next: PixelPondTuning) {
  tuning = next;
}

/** Bayer 4×4: ordered dithering's thresholds, 0–1. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

/**
 * A block of water with `shading` (`PondToy.shading`: negative faces the
 * light) at block (x, y): a crest band (1 up to `crestBands`), a trough
 * band (1 up to `troughBands`), or nothing, stepped and dithered.
 */
export function pondBand(
  shading: number,
  x: number,
  y: number,
  t: PixelPondTuning,
): { kind: "crest" | "trough"; band: number } | null {
  const crest = shading < 0;
  const v = Math.min(1, Math.abs(shading) * (crest ? t.crestGain : t.troughGain));
  if (v < t.cutoff) return null;
  const bands = crest ? t.crestBands : t.troughBands;
  const threshold = (BAYER[(((y % 4) + 4) % 4) * 4 + (((x % 4) + 4) % 4)]! - 0.5) * t.dither;
  const band = Math.max(0, Math.min(bands, Math.floor(v * bands + 0.5 + threshold)));
  return band > 0 ? { kind: crest ? "crest" : "trough", band } : null;
}
