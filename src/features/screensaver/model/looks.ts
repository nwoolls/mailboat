import type { SceneId } from "./catalog";

/**
 * Screensavers in the Toybox's styles (Settings → Toybox → Style), one
 * scene at a time as the owner approves each (owner, 2026-11-13: "let's do
 * the screensavers one at a time"). A scene still paints its fine grid of
 * palette cells; this decides how that grid is drawn:
 *
 * - "fine": as it was, one screen block per cell (every scene not yet
 *   restyled, whatever the style);
 * - "chunky": pixel art in chunky blocks (`chunkPx`), each block the most
 *   common color of the cells in it, as solid as they are on average;
 * - "ascii": a character per cell of the glow's grid, picked by how much of
 *   it is covered from the glow's ramp, on a tile in the cells' average
 *   color, the brightest flipping to a pale tile with a dark character.
 *
 * The numbers are in `ScreensaverLookTuning`, for the playground; the app
 * uses `SCREENSAVER_LOOK_DEFAULTS`.
 */
export type ScreensaverLook = "fine" | "chunky" | "ascii";

/** The scenes restyled so far; the rest stay fine in either style. */
export const RESTYLED: ReadonlySet<SceneId> = new Set<SceneId>([
  "jellyfish",
  "starfield",
  "fireworks",
  "rain",
  "code",
  "koi",
]);

/** How a scene is drawn in the chosen style. */
export function lookFor(scene: SceneId, style: "pixel" | "ascii"): ScreensaverLook {
  if (!RESTYLED.has(scene)) return "fine";
  return style === "ascii" ? "ascii" : "chunky";
}

export type ScreensaverLookTuning = {
  /**
   * How solid a restyled scene is over the card (a fine one is as
   * see-through as the card's glass, which made chunky blocks and
   * characters look dim).
   */
  solidity: number;
  /** Pixel art's block size, in screen pixels (rounded to whole cells). */
  chunkPx: number;
  /** ASCII: characters from faint to dense; the first is never drawn. */
  ramp: string;
  /** ASCII: below this coverage a cell is left clear. */
  cutoff: number;
  /** ASCII: how much the coverage is boosted before picking a character. */
  gain: number;
  /** ASCII: a tile's opacity, base + gain × coverage, per theme. */
  tileBaseDark: number;
  tileGainDark: number;
  tileBaseLight: number;
  tileGainLight: number;
  /** ASCII: coverage above which a bright cell flips to a pale tile, and how bright it must be (0–1). */
  hotAt: number;
  hotBright: number;
  /** ASCII: how far a character's color leans from its tile's toward the text color. */
  glyphLift: number;
};

export const SCREENSAVER_LOOK_DEFAULTS: ScreensaverLookTuning = {
  solidity: 0.8,
  chunkPx: 6,
  ramp: " .':;otS%X8@",
  cutoff: 0.05,
  gain: 1.3,
  tileBaseDark: 0.08,
  tileGainDark: 0.5,
  tileBaseLight: 0.06,
  tileGainLight: 0.45,
  hotAt: 0.82,
  hotBright: 0.6,
  glyphLift: 0.35,
};

let tuning: ScreensaverLookTuning = SCREENSAVER_LOOK_DEFAULTS;

/** What the screensavers draw with; the defaults unless the playground changed it. */
export function screensaverLookTuning(): ScreensaverLookTuning {
  return tuning;
}

/** For the playground only. */
export function setScreensaverLookTuning(next: ScreensaverLookTuning) {
  tuning = next;
}

/** The block size in cells for a scene of `cellPx` screen pixels per cell. */
export function chunkCells(cellPx: number, t: ScreensaverLookTuning): number {
  return Math.max(1, Math.round(t.chunkPx / cellPx));
}

/**
 * The most common ink among `inks` (weighted by each cell's opacity), and
 * the block's average opacity (0–255): a chunky pixel's color and solidity.
 */
export function dominantInk(
  inks: ArrayLike<number>,
  opacities: ArrayLike<number>,
): { ink: number; opacity: number } {
  const weight = new Map<number, number>();
  let total = 0;
  for (let i = 0; i < inks.length; i++) {
    const a = inks[i] ? opacities[i]! : 0;
    total += a;
    if (a > 0) weight.set(inks[i]!, (weight.get(inks[i]!) ?? 0) + a);
  }
  let ink = 0;
  let most = 0;
  for (const [k, w] of weight)
    if (w > most) {
      most = w;
      ink = k;
    }
  return { ink, opacity: Math.round(total / Math.max(1, inks.length)) };
}

/** The ramp character for a coverage (0–1), or null when too faint. */
export function coverageChar(coverage: number, t: ScreensaverLookTuning): string | null {
  const v = Math.min(1, coverage * t.gain);
  if (v < t.cutoff) return null;
  const top = t.ramp.length - 1;
  if (top < 1) return null;
  return t.ramp[Math.max(1, Math.min(top, Math.round(v * top)))]!;
}
