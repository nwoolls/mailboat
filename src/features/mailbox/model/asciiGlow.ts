/**
 * The empty list's glow drawn as ASCII art (Settings → Toybox → Style):
 * the same glow, following the pointer as before, drawn on a grid of
 * monospace cells. Each lit cell is a square tile that lightens with the
 * glow, with a character on it picked by brightness from a short ramp; the
 * hottest cells flip to a pale tile with a dark character. A faint grid
 * covers the card. After the owner's references (ASCII jellyfish and rays
 * on tiles, 2026-11-13).
 *
 * Pure logic here; `ui/AsciiGlow.tsx` draws it. Every number the look
 * depends on is in `AsciiGlowTuning`, so the playground (`playground/`)
 * can dial it live; the app always uses `ASCII_GLOW_DEFAULTS`.
 */
export type AsciiGlowTuning = {
  /** Character size in CSS pixels; a cell is one character wide. */
  fontPx: number;
  /** A cell's height, as a multiple of the character size. */
  lineHeight: number;
  /** Characters from faint to dense; the first is never drawn (empty). */
  ramp: string;
  /** The glow's radius, as a multiple of the gradient glow's own (190px). */
  radiusScale: number;
  /** How far past the radius the falloff reaches before it's cut off. */
  reach: number;
  /** How much the edge breathes (a slow wobble on the falloff). */
  wobble: number;
  /** Below this brightness a cell is left empty. */
  cutoff: number;
  /** Seconds the wake left behind a moving glow takes to fade (to ~37%). */
  wakeSeconds: number;
  /** How bright the wake is, compared with the glow that left it. */
  wakeStrength: number;
  /** How much each character's pick is jittered, in ramp steps. */
  jitter: number;
  /** How often a character steps up or down a notch: base + per brightness. */
  shimmerBase: number;
  shimmerGain: number;
  /** Brightness above which a cell may flip to a pale tile. */
  hotAt: number;
  /** Share of cells above `hotAt` that flip (the rest stay tinted). */
  hotShare: number;
  /** A tile's opacity: base + gain × brightness, per theme. */
  tileBaseDark: number;
  tileGainDark: number;
  tileBaseLight: number;
  tileGainLight: number;
  /** A flipped tile's opacity, per theme. */
  hotTileDark: number;
  hotTileLight: number;
  /** A character's opacity: base + gain × brightness. */
  glyphBase: number;
  glyphGain: number;
  /** How far the hottest color leans from the accent toward the text color. */
  hotMixDark: number;
  hotMixLight: number;
  /** The grid's lines, as a share of the text color, per theme. */
  gridDark: number;
  gridLight: number;
  /**
   * The clearing round the icon and each line of the words, so they still
   * read: within `pad` px of the shape the glow is down to `floor` (0 is
   * gone), and over the next `feather` px it comes back. Shapes are rounded
   * rectangles (`radius` px).
   */
  iconPad: number;
  iconFeather: number;
  iconFloor: number;
  iconRadius: number;
  wordsPad: number;
  wordsFeather: number;
  wordsFloor: number;
  wordsRadius: number;
  /**
   * How the clearing works: 1 thins the characters (they step down the
   * ramp to lighter ones), 0 only fades them; in between, both.
   */
  thin: number;
};

export const ASCII_GLOW_DEFAULTS: AsciiGlowTuning = {
  fontPx: 12,
  lineHeight: 1.25,
  ramp: " .':;otS%X8@",
  radiusScale: 1,
  reach: 1.15,
  wobble: 0.08,
  cutoff: 0.06,
  wakeSeconds: 0.45,
  wakeStrength: 0.6,
  jitter: 1.6,
  shimmerBase: 0.2,
  shimmerGain: 1.2,
  hotAt: 0.86,
  hotShare: 0.75,
  tileBaseDark: 0.08,
  tileGainDark: 0.42,
  tileBaseLight: 0.06,
  tileGainLight: 0.38,
  hotTileDark: 0.8,
  hotTileLight: 0.9,
  glyphBase: 0.35,
  glyphGain: 0.65,
  hotMixDark: 0.65,
  hotMixLight: 0.45,
  // Picked by the owner in the mockup (2026-11-13).
  gridDark: 0.02,
  gridLight: 0.04,
  iconPad: 4,
  iconFeather: 36,
  iconFloor: 0,
  iconRadius: 16,
  wordsPad: 0,
  wordsFeather: 22,
  wordsFloor: 0,
  wordsRadius: 8,
  thin: 0.7,
};

let tuning: AsciiGlowTuning = ASCII_GLOW_DEFAULTS;

/** What the glow draws with; the defaults unless the playground changed it. */
export function asciiGlowTuning(): AsciiGlowTuning {
  return tuning;
}

/** For the playground only: draw with these from the next frame on. */
export function setAsciiGlowTuning(next: AsciiGlowTuning) {
  tuning = next;
}

/** Smooth falloff from 1 at the center to 0 at `reach` (distance in radii). */
export function falloff(dist: number, wobble: number, t: AsciiGlowTuning): number {
  if (dist >= t.reach + Math.abs(wobble)) return 0;
  const f = Math.max(0, Math.min(1, 1 - dist + wobble));
  return f * f * (3 - 2 * f);
}

/** The slow wobble on the edge, for a cell at (col, row) at time `s` seconds. */
export function edgeWobble(col: number, row: number, s: number, t: AsciiGlowTuning): number {
  return Math.sin(col * 0.055 + s * 0.9) * Math.cos(row * 0.07 - s * 0.7) * t.wobble;
}

/** How one lit cell looks. */
export type CellLook = {
  /** Index into the ramp (1 or more; 0 is empty and never returned). */
  glyph: number;
  /** A pale tile with a dark character. */
  hot: boolean;
  tileAlpha: number;
  glyphAlpha: number;
  /** How far the tile's color leans from the accent toward the hot color, 0–1. */
  warmth: number;
};

/**
 * The look of a cell of brightness `v` (0–1), or null when it's too faint
 * to draw. `seed` is the cell's own random number (0–1), so neighbors pick
 * different characters; `notch` (-1, 0 or 1) is its shimmer right now.
 */
export function cellLook(
  v: number,
  seed: number,
  notch: number,
  dark: boolean,
  t: AsciiGlowTuning,
): CellLook | null {
  if (v < t.cutoff) return null;
  const top = t.ramp.length - 1;
  if (top < 1) return null;
  const glyph = Math.min(
    top,
    Math.max(1, Math.floor(v * top + (seed - 0.5) * t.jitter + 0.5) + notch),
  );
  // Most of the hottest cells flip; the seed decides which, so they stay put.
  const hot = v > t.hotAt && seed < t.hotShare;
  const tileAlpha = hot
    ? dark
      ? t.hotTileDark
      : t.hotTileLight
    : dark
      ? t.tileBaseDark + t.tileGainDark * v
      : t.tileBaseLight + t.tileGainLight * v;
  return {
    glyph,
    hot,
    tileAlpha: Math.min(1, tileAlpha),
    glyphAlpha: hot ? 1 : Math.min(1, t.glyphBase + t.glyphGain * v),
    warmth: hot ? 1 : Math.max(0, v - 0.5) * 0.6,
  };
}

/**
 * The shimmer: each cell's clock runs faster the brighter it is, and for
 * the first tenth of each turn its character steps a notch (up or down,
 * by its seed). Returns the new clock and the notch.
 */
export function shimmer(
  clock: number,
  v: number,
  seed: number,
  dt: number,
  t: AsciiGlowTuning,
): { clock: number; notch: number } {
  const next = (clock + dt * (t.shimmerBase + t.shimmerGain * v)) % 1;
  return { clock: next, notch: next < 0.1 ? (seed > 0.5 ? 1 : -1) : 0 };
}

/** The wake: what's left of a cell's heat after `dt`, topped up by the glow. */
export function wake(heat: number, glow: number, dt: number, t: AsciiGlowTuning): number {
  const kept = t.wakeSeconds > 0 ? heat * Math.exp(-dt / t.wakeSeconds) : 0;
  return Math.max(kept, glow * 0.75);
}

/** Something the glow clears round, in CSS pixels from the canvas's corner. */
export type ClearShape = {
  kind: "icon" | "words";
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

/** Distance from (px, py) to a rounded rectangle's edge; negative inside. */
export function roundedBoxDistance(px: number, py: number, b: ClearShape, radius: number): number {
  const hw = (b.x1 - b.x0) / 2;
  const hh = (b.y1 - b.y0) / 2;
  const r = Math.max(0, Math.min(radius, hw, hh));
  const qx = Math.abs(px - (b.x0 + hw)) - (hw - r);
  const qy = Math.abs(py - (b.y0 + hh)) - (hh - r);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0) - r;
}

/**
 * How much of the glow is left in the cell centered at (px, py) near the
 * icon and words: 1 far away, down to the shape's floor close in, with a
 * smooth edge between. Measured from the cell's nearest edge (`halfW`,
 * `halfH` are half its size), so no tile overlaps a letter. The nearest
 * shape decides.
 */
export function clearing(
  px: number,
  py: number,
  shapes: readonly ClearShape[],
  t: AsciiGlowTuning,
  halfW = 0,
  halfH = 0,
): number {
  let left = 1;
  for (const shape of shapes) {
    const icon = shape.kind === "icon";
    const pad = icon ? t.iconPad : t.wordsPad;
    const feather = icon ? t.iconFeather : t.wordsFeather;
    const floor = icon ? t.iconFloor : t.wordsFloor;
    // The shape grown by half a cell each way: the cell's center is within
    // it exactly when some of the cell is within the shape.
    const b = {
      ...shape,
      x0: shape.x0 - halfW,
      y0: shape.y0 - halfH,
      x1: shape.x1 + halfW,
      y1: shape.y1 + halfH,
    };
    const d = roundedBoxDistance(px, py, b, icon ? t.iconRadius : t.wordsRadius);
    if (d >= pad + feather) continue;
    const k = feather > 0 ? Math.max(0, Math.min(1, (d - pad) / feather)) : d >= pad ? 1 : 0;
    left = Math.min(left, floor + (1 - floor) * k * k * (3 - 2 * k));
  }
  return left;
}

/**
 * A cell's brightness and opacity after the clearing `left` (0–1), split
 * between the two by `thin`: brightness × left^thin (lighter characters)
 * and opacity left^(1 − thin), so where nothing is left (0) both reach
 * nothing, whatever the split.
 */
export function cleared(v: number, left: number, t: AsciiGlowTuning): { v: number; fade: number } {
  if (left >= 1) return { v, fade: 1 };
  return { v: v * left ** t.thin, fade: left ** (1 - t.thin) };
}
