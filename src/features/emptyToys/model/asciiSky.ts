import type { Cell } from "./skyScene";

/**
 * The Sky toy in ASCII art (Settings → Toybox → Style): the same scene as
 * in pixel art (`skyScene.ts`), sampled at each character's cell of the
 * glow's grid and drawn as characters on tiles: ridgelines as `^ / \`,
 * lit faces `:` and shaded `.`, grass tufts `" ,` over patches of `w`,
 * clouds soft `: - .`, the sun `@ o`, the moon `@ 8` with its dark side
 * dotted, stars `. + *`. The sky itself is a wash in its banded colors.
 *
 * The look's own numbers are in `AsciiSkyTuning`, for the playground; the
 * scene's (where the land is, the clouds, the stars) are the scene's.
 */
export type AsciiSkyTuning = {
  /** The sky's wash, per theme (0 is none). */
  washDark: number;
  washLight: number;
  /** The land's and clouds' tiles, per theme. */
  tileDark: number;
  tileLight: number;
  /** How far a character's color leans from its tile's toward the text color. */
  glyphLift: number;
};

export const ASCII_SKY_DEFAULTS: AsciiSkyTuning = {
  washDark: 0.55,
  washLight: 0.5,
  tileDark: 0.4,
  tileLight: 0.35,
  glyphLift: 0.4,
};

let tuning: AsciiSkyTuning = ASCII_SKY_DEFAULTS;

/** What the sky draws with; the defaults unless the playground changed it. */
export function asciiSkyTuning(): AsciiSkyTuning {
  return tuning;
}

/** For the playground only. */
export function setAsciiSkyTuning(next: AsciiSkyTuning) {
  tuning = next;
}

/** Every character the sky may draw, for the painter's sheet. */
export const SKY_CHARS = `^/\\|-:.'"w,~@o8*+n`;

/**
 * The character for a scene cell, or null for none (the sky's wash, a calm
 * patch). `seed` (0–1) is the cell's own, to vary grass and stars.
 */
export function skyChar(c: Cell, seed: number): string | null {
  switch (c.material) {
    case "sky":
      return null;
    case "star":
      return c.glow > 0.75 ? "+" : c.glow > 0.2 ? "." : null;
    case "sparkle":
      return c.glow > 0.5 ? "*" : "+";
    case "sun":
      return c.glow > 0.4 ? "@" : "o";
    case "moon":
      return c.glow > 0.5 ? (seed < 0.5 ? "@" : "8") : ".";
    case "cloud":
      return c.glow > 0.35 ? ":" : c.glow > -0.25 ? "-" : ".";
    case "mountain":
    case "hill":
      if (c.edge !== 0)
        return c.slope > 0.35 ? "/" : c.slope < -0.35 ? "\\" : c.material === "hill" ? "~" : "^";
      if (c.material === "mountain") return seed < 0.5 ? ":" : ".";
      return seed < 0.3 ? "." : null;
    case "grass":
      if (c.edge !== 0) return seed < 0.5 ? '"' : ",";
      return seed < 0.25 ? "w" : seed < 0.55 ? "," : seed < 0.7 ? "." : null;
    case "flower":
      return "*";
  }
}

/** A shooting star's trail character for its direction (radians, screen y down). */
export function rayChar(angle: number): string {
  const a = ((angle % Math.PI) + Math.PI) % Math.PI;
  if (a < Math.PI / 8 || a >= (7 * Math.PI) / 8) return "-";
  if (a < (3 * Math.PI) / 8) return "\\";
  if (a < (5 * Math.PI) / 8) return "|";
  return "/";
}

/**
 * Whether a point of the moon's disc is lit, for `phase` (0 new, 0.5
 * full; `sky.moonPhase`). (x, y) is on the unit disc. Waxing lights the
 * right, waning the left, as seen from the northern hemisphere.
 */
export function moonLit(x: number, y: number, phase: number): boolean {
  const edge = Math.sqrt(Math.max(0, 1 - y * y));
  const terminator = Math.cos(phase * 2 * Math.PI) * edge;
  return (phase < 0.5 ? x : -x) > terminator;
}

/** A smooth random field: value noise, 0–1, repeatable. */
export function noise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
