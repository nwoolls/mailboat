/**
 * The Pond toy in ASCII art (Settings → Toybox → Style). The water is the
 * same simulation as in pixel art (`pond.ts`); only the drawing differs.
 * It is drawn on the glow's grid of monospace cells (`asciiGlow.ts`: the
 * character size and grid are the glow's, so the two line up): where a
 * wave faces the light, a tile with a character picked by how bright it
 * is, the brightest flipping to a pale tile with a dark character, as the
 * glow does; where it faces away, only a faint wave character (`~`, `-`)
 * with no tile, so the water still reads as water. Droplets are small
 * bright beads with a tick behind them; a stone's plop is a quick burst of
 * pale tiles.
 *
 * Every number the look depends on is in `AsciiPondTuning`, for the
 * playground (`playground/`); the app always uses `ASCII_POND_DEFAULTS`.
 */
export type AsciiPondTuning = {
  /** Brightness from a lit slope: |shading| × gain. */
  crestGain: number;
  /** How dark a slope facing away shows: |shading| × gain. */
  troughGain: number;
  /** Below this either way, a cell is left empty. */
  cutoff: number;
  /** Characters for lit water, faint to dense; the first is never drawn. */
  crestRamp: string;
  /** Characters for water facing away from the light, faint to dense. */
  troughRamp: string;
  /** How much each lit character's pick is jittered, in ramp steps. */
  jitter: number;
  /** A trough character's opacity at its darkest. */
  troughAlpha: number;
  /** Brightness above which a lit cell may flip to a pale tile, and the share that do. */
  hotAt: number;
  hotShare: number;
  /** A tile's opacity: base + gain × brightness, per theme. */
  tileBaseDark: number;
  tileGainDark: number;
  tileBaseLight: number;
  tileGainLight: number;
  /** A lit character's opacity: base + gain × brightness. */
  glyphBase: number;
  glyphGain: number;
  /** A droplet's bead, and the tick trailing it. */
  dropletChar: string;
  trailChar: string;
  /** The plop's burst: its character and how far it reaches, in cells across and down. */
  plopChar: string;
  plopCols: number;
  plopRows: number;
};

export const ASCII_POND_DEFAULTS: AsciiPondTuning = {
  crestGain: 4.5,
  troughGain: 2.2,
  cutoff: 0.08,
  crestRamp: " .':;otS%X8@",
  troughRamp: " .-~",
  jitter: 1.2,
  troughAlpha: 0.55,
  hotAt: 0.85,
  hotShare: 0.6,
  tileBaseDark: 0.06,
  tileGainDark: 0.45,
  tileBaseLight: 0.05,
  tileGainLight: 0.4,
  glyphBase: 0.35,
  glyphGain: 0.65,
  dropletChar: "o",
  trailChar: "'",
  plopChar: "@",
  plopCols: 3,
  plopRows: 1,
};

let tuning: AsciiPondTuning = ASCII_POND_DEFAULTS;

/** What the pond draws with; the defaults unless the playground changed it. */
export function asciiPondTuning(): AsciiPondTuning {
  return tuning;
}

/** For the playground only: draw with these from the next frame on. */
export function setAsciiPondTuning(next: AsciiPondTuning) {
  tuning = next;
}

/** All the characters the pond may draw, for the painter's sheet. */
export function pondChars(t: AsciiPondTuning): string {
  return t.crestRamp + t.troughRamp + t.dropletChar + t.trailChar + t.plopChar;
}

/** How one cell of water looks. */
export type PondLook =
  | {
      kind: "crest";
      char: string;
      hot: boolean;
      tileAlpha: number;
      glyphAlpha: number;
      /** 0 the accent, 1 the hot color. */
      warmth: number;
      /** Brightness, 0–1. */
      v: number;
    }
  | { kind: "trough"; char: string; glyphAlpha: number };

/**
 * The look of water with `shading` (`PondToy.shading`: negative faces the
 * light), or null when it's too calm to draw. `seed` is the cell's own
 * random number (0–1).
 */
export function pondLook(
  shading: number,
  seed: number,
  dark: boolean,
  t: AsciiPondTuning,
): PondLook | null {
  if (shading < 0) {
    const v = Math.min(1, -shading * t.crestGain);
    if (v < t.cutoff) return null;
    const top = t.crestRamp.length - 1;
    if (top < 1) return null;
    const k = Math.min(top, Math.max(1, Math.floor(v * top + (seed - 0.5) * t.jitter + 0.5)));
    const hot = v > t.hotAt && seed < t.hotShare;
    const tileAlpha = hot
      ? 0.85
      : dark
        ? t.tileBaseDark + t.tileGainDark * v
        : t.tileBaseLight + t.tileGainLight * v;
    return {
      kind: "crest",
      char: t.crestRamp[k]!,
      hot,
      tileAlpha: Math.min(1, tileAlpha),
      glyphAlpha: hot ? 1 : Math.min(1, t.glyphBase + t.glyphGain * v),
      warmth: hot ? 1 : Math.max(0, v - 0.5) * 0.6,
      v,
    };
  }
  const d = Math.min(1, shading * t.troughGain);
  if (d < t.cutoff) return null;
  const top = t.troughRamp.length - 1;
  if (top < 1) return null;
  const k = Math.min(top, Math.max(1, Math.round(d * top)));
  return { kind: "trough", char: t.troughRamp[k]!, glyphAlpha: t.troughAlpha * d };
}

/**
 * The strongest shading among a few points down a cell (a cell is taller
 * than the water's finest ripples, so one point at its middle could miss a
 * ring passing through it). `sample(y)` gives the shading at a height.
 */
export function strongest(sample: (y: number) => number, top: number, height: number): number {
  let best = 0;
  for (const f of [0.2, 0.5, 0.8]) {
    const s = sample(top + height * f);
    if (Math.abs(s) > Math.abs(best)) best = s;
  }
  return best;
}
