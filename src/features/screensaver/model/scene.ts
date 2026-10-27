/**
 * What every screensaver scene shares. A scene is pure logic on a grid of
 * cells (one cell per SCENE_CELL_PX screen pixels): it moves by `frame`
 * and paints by `draw`, writing colour *slots* rather than colours, so any
 * palette (`palettes.ts`) can colour any scene. The UI
 * (`ScreensaverCanvas`) supplies the empty state's shapes and the pointer.
 */

/** Screen pixels per cell: chunky enough to read as pixel art (a scene may ask for finer, `cellPx` in the catalog). */
export const SCENE_CELL_PX = 3;

export type Rng = () => number;

/** A box of cells, inclusive on all sides. */
export type Rect = { x0: number; y0: number; x1: number; y1: number };

/** The empty state as cells: what a scene can rest on or play with. */
export type SceneSetup = {
  cols: number;
  rows: number;
  /** 1 where the icon box or a letter is. */
  solid: Uint8Array;
  /** 1 where a letter of the words is (a subset of `solid`). */
  letters: Uint8Array;
  /** The icon's box, if shown. */
  icon: Rect | null;
  /** The words' box, if shown. */
  words: Rect | null;
  rng: Rng;
};

/** The pointer's tip in cells, or null when it's off the area. */
export type Pointer = { x: number; y: number } | null;

/** What a frame asks of the empty state around it. */
export type FrameResult = {
  /** Nod the icon (something landed on it, or it shook something off). */
  nod?: boolean;
  /** Fade the words out (true) or back in (false); unset leaves them. */
  hideWords?: boolean;
  /** Turn the whole canvas this many degrees (the sandscape's flip). */
  turn?: number;
};

export interface Scene {
  frame(dt: number, pointer: Pointer): FrameResult;
  /**
   * Paints every cell of `out` (0 is clear) with `ink(...)` values. A scene
   * may also set how solid each cell is in `opacity` (255 solid, 0 clear;
   * every cell is 255 before each draw), to let the background through.
   */
  draw(out: Uint8Array, opacity: Uint8Array): void;
  /**
   * Wants a night sky behind it on a light page (the starfield, the
   * fireworks: light on white vanishes). The canvas paints one in the
   * palette's darkest colour and lays the scene over it.
   */
  readonly night?: boolean;
}

/** Palette slots, darkest to lightest, then the accent. */
export const SLOT = { dark: 0, mid: 1, light: 2, bright: 3, accent: 4 } as const;
export type Slot = (typeof SLOT)[keyof typeof SLOT];
export const SLOT_COUNT = 5;
/** Each slot has a few shades, from a little darker (0) to a little lighter. */
export const SHADES = 4;

/** The value `draw` writes for a slot in one of its shades. */
export function ink(slot: Slot, shade = 2): number {
  return 1 + slot * SHADES + Math.max(0, Math.min(SHADES - 1, shade));
}

/** Steps from one slot's colour to another's in `blend`. */
export const BLEND_STEPS = 8;
const BLEND_BASE = 1 + SLOT_COUNT * SHADES;
/** How many values `draw` can write, clear included. */
export const INK_COUNT = BLEND_BASE + SLOT_COUNT * SLOT_COUNT * (BLEND_STEPS - 1);

/**
 * The value for a colour `t` of the way from one slot's colour to
 * another's (in BLEND_STEPS steps), for shading finer than `ink`'s shades
 * while staying inside the palette.
 */
export function blend(from: Slot, to: Slot, t: number): number {
  const k = Math.round(clamp(t, 0, 1) * BLEND_STEPS);
  if (k === 0 || from === to) return ink(from);
  if (k === BLEND_STEPS) return ink(to);
  return BLEND_BASE + (from * SLOT_COUNT + to) * (BLEND_STEPS - 1) + (k - 1);
}

/** Writes `v` at (x, y) if that's inside the grid. */
export function plot(out: Uint8Array, cols: number, rows: number, x: number, y: number, v: number) {
  const cx = Math.round(x);
  const cy = Math.round(y);
  if (cx >= 0 && cx < cols && cy >= 0 && cy < rows) out[cy * cols + cx] = v;
}

/** Whether (x, y) is a solid cell (outside the grid counts as not). */
export function isSolid(s: SceneSetup, x: number, y: number): boolean {
  const cx = Math.round(x);
  const cy = Math.round(y);
  return cx >= 0 && cx < s.cols && cy >= 0 && cy < s.rows && s.solid[cy * s.cols + cx] === 1;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * A blank setup for tests and previews: a grid with an icon box in the
 * middle and a line of "letters" under it.
 */
export function testSetup(cols: number, rows: number, rng: Rng): SceneSetup {
  const solid = new Uint8Array(cols * rows);
  const letters = new Uint8Array(cols * rows);
  const cx = Math.floor(cols / 2);
  const cy = Math.floor(rows / 2);
  const icon = { x0: cx - 9, y0: cy - 9, x1: cx + 9, y1: cy + 9 };
  const words = { x0: cx - 22, y0: cy + 14, x1: cx + 22, y1: cy + 18 };
  for (let y = icon.y0; y <= icon.y1; y++)
    for (let x = icon.x0; x <= icon.x1; x++) solid[y * cols + x] = 1;
  for (let y = words.y0; y <= words.y1; y++)
    for (let x = words.x0; x <= words.x1; x++)
      if ((x - words.x0) % 4 !== 3) {
        solid[y * cols + x] = 1;
        letters[y * cols + x] = 1;
      }
  return { cols, rows, solid, letters, icon, words, rng };
}

/** A repeatable stand-in for Math.random, for tests. */
export function seeded(seed = 1): Rng {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}
