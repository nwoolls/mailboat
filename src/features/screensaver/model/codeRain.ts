import {
  blend,
  type FrameResult,
  ink,
  type Pointer,
  type Scene,
  type SceneSetup,
  SLOT,
} from "./scene";

/**
 * Code rain (owner, 2026-11-13: a Matrix-style rain screensaver, from the
 * ASCII glow's mockup). Columns of characters fall, each at its own pace:
 * a bright, near-white head and a trail behind it fading in the palette's
 * accent, its characters flickering as they change. Now and then a cascade
 * starts down every column at once, and the icon nods. The pointer is a
 * flashlight: the code it passes over shows faintly even where no stream
 * is falling.
 *
 * Its motion is in cells of a character grid (`CodeRain`), drawn in ASCII
 * art (real characters) or chunky pixel art (a tiny pixel font) by
 * `ui/codeRainDraw.ts`. `CodeRainScene` draws it on the fine grid too, for
 * when it isn't restyled. The numbers are in `CodeRainTuning`, for the
 * playground; the app uses `CODE_RAIN_DEFAULTS`.
 */
export type CodeRainTuning = {
  /** How fast streams fall, in rows a second (each a little faster or slower). */
  speed: number;
  /** How long a stream's trail is, in rows (about). */
  length: number;
  /** New streams a second, per hundred columns. */
  density: number;
  /** How often a character changes, a second (each). */
  flicker: number;
  /** Seconds between cascades (about). */
  cascadeEvery: number;
  /** The flashlight round the pointer, in screen pixels (0 is none). */
  flashlight: number;
  /** The soft light round each head (0 is none). */
  glow: number;
  /** Pixel art: the pixel font's block size, in screen pixels. */
  pixel: number;
};

export const CODE_RAIN_DEFAULTS: CodeRainTuning = {
  speed: 9,
  length: 16,
  density: 30,
  flicker: 0.8,
  cascadeEvery: 40,
  flashlight: 90,
  glow: 0.5,
  pixel: 2,
};

let tuning: CodeRainTuning = CODE_RAIN_DEFAULTS;

/** What code rain uses; the defaults unless the playground changed it. */
export function codeRainTuning(): CodeRainTuning {
  return tuning;
}

/** For the playground only. */
export function setCodeRainTuning(next: CodeRainTuning) {
  tuning = next;
}

/** A stream: its head's row (it falls down from above the top), pace and length. */
export type Stream = { head: number; speed: number; length: number };

export type CodeRain = {
  cols: number;
  rows: number;
  /** Each column's streams. */
  streams: Stream[][];
  /** Each cell's character (an index; the drawing picks the shape). */
  glyphs: Uint8Array;
  time: number;
  nextCascade: number;
};

/** How many different characters a cell can show. */
export const GLYPHS = 64;

/** Code rain for a grid of `cols` × `rows` characters, already raining. */
export function makeCodeRain(
  cols: number,
  rows: number,
  t: CodeRainTuning,
  rng: () => number,
): CodeRain {
  const rain: CodeRain = {
    cols,
    rows,
    streams: Array.from({ length: cols }, () => []),
    glyphs: new Uint8Array(cols * rows),
    time: 0,
    nextCascade: t.cascadeEvery * (0.6 + rng() * 0.4),
  };
  for (let i = 0; i < rain.glyphs.length; i++) rain.glyphs[i] = Math.floor(rng() * GLYPHS);
  // Mid-fall from the start, not an empty screen filling up.
  for (let c = 0; c < cols; c++)
    if (rng() < 0.45) rain.streams[c]!.push(newStream(t, rng, rng() * (rows + t.length)));
  return rain;
}

function newStream(t: CodeRainTuning, rng: () => number, head = -rng() * 4): Stream {
  return {
    head,
    speed: t.speed * (0.55 + rng() * 0.9),
    length: Math.max(3, t.length * (0.5 + rng())),
  };
}

/** Moves the rain on by `dt`. Returns whether a cascade just began (to nod the icon). */
export function stepCodeRain(
  rain: CodeRain,
  dt: number,
  t: CodeRainTuning,
  rng: () => number,
): boolean {
  rain.time += dt;
  let cascade = false;
  if (rain.time >= rain.nextCascade) {
    rain.nextCascade = rain.time + t.cascadeEvery * (0.75 + rng() * 0.5);
    cascade = true;
  }
  const spawn = (t.density / 100) * dt;
  for (let c = 0; c < rain.cols; c++) {
    const col = rain.streams[c]!;
    for (const s of col) s.head += s.speed * dt;
    // Gone once its whole trail is past the bottom.
    for (let i = col.length - 1; i >= 0; i--)
      if (col[i]!.head - col[i]!.length > rain.rows) col.splice(i, 1);
    // A new stream only once the last one is well on its way.
    const room = col.every((s) => s.head - s.length > 2);
    if (cascade) col.push(newStream(t, rng, -rng() * 2));
    else if (room && col.length < 3 && rng() < spawn) col.push(newStream(t, rng));
  }
  // Characters change at random: `flicker` a second each, on average.
  const changes = rain.glyphs.length * t.flicker * dt;
  const n = Math.floor(changes) + (rng() < changes % 1 ? 1 : 0);
  for (let k = 0; k < n; k++)
    rain.glyphs[Math.floor(rng() * rain.glyphs.length)] = Math.floor(rng() * GLYPHS);
  return cascade;
}

/**
 * How lit a cell is by the streams in its column (0–1, the head brightest,
 * fading along the trail behind it), and whether it is a head.
 */
export function litAt(rain: CodeRain, col: number, row: number): { lit: number; head: boolean } {
  let lit = 0;
  let head = false;
  for (const s of rain.streams[col] ?? []) {
    const behind = s.head - row;
    if (behind < 0 || behind >= s.length) continue;
    const v = 1 - behind / s.length;
    if (v > lit) {
      lit = v;
      head = behind < 1;
    }
  }
  return { lit, head };
}

/**
 * Fits the rain to a resized grid without starting over: the columns that
 * remain keep their streams and characters, new ones start empty.
 */
export function resizeCodeRain(rain: CodeRain, cols: number, rows: number, rng: () => number) {
  const glyphs = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      glyphs[r * cols + c] =
        c < rain.cols && r < rain.rows
          ? rain.glyphs[r * rain.cols + c]!
          : Math.floor(rng() * GLYPHS);
  rain.streams = Array.from({ length: cols }, (_, c) => rain.streams[c] ?? []);
  rain.glyphs = glyphs;
  rain.cols = cols;
  rain.rows = rows;
}

/** Fine-grid cells per character, across and down. */
const FINE_W = 4;
const FINE_H = 6;

/**
 * Code rain on the fine grid (when it isn't restyled): each character a
 * small block of cells, brighter at the head.
 */
export class CodeRainScene implements Scene {
  readonly night = true;
  private readonly rain: CodeRain;

  constructor(private readonly s: SceneSetup) {
    this.rain = makeCodeRain(
      Math.ceil(s.cols / FINE_W),
      Math.ceil(s.rows / FINE_H),
      codeRainTuning(),
      s.rng,
    );
  }

  frame(dt: number, _pointer: Pointer): FrameResult {
    return { nod: stepCodeRain(this.rain, dt, codeRainTuning(), this.s.rng) };
  }

  draw(out: Uint8Array, opacity: Uint8Array) {
    const { cols, rows } = this.s;
    out.fill(0);
    for (let c = 0; c < this.rain.cols; c++)
      for (let r = 0; r < this.rain.rows; r++) {
        const { lit, head } = litAt(this.rain, c, r);
        if (lit <= 0.03) continue;
        const v = head ? ink(SLOT.bright, 3) : blend(SLOT.dark, SLOT.accent, lit);
        const a = Math.round(Math.min(1, 0.25 + lit) * 255);
        const glyph = this.rain.glyphs[r * this.rain.cols + c]!;
        for (let y = 0; y < FINE_H - 1; y++)
          for (let x = 0; x < FINE_W - 1; x++) {
            // A rough character: some of its cells, by its glyph.
            if (!((glyph >> ((x + y * 3) % 6)) & 1) && !head) continue;
            const gx = c * FINE_W + x;
            const gy = r * FINE_H + y;
            if (gx >= cols || gy >= rows) continue;
            out[gy * cols + gx] = v;
            opacity[gy * cols + gx] = a;
          }
      }
  }
}
