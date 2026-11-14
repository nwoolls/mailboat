import { blend, type FrameResult, type Pointer, type Scene, type SceneSetup, SLOT } from "./scene";

/**
 * Conway's Game of Life, seeded from the words: the letters dissolve into
 * living cells that spread over the card, the pointer seeds new life
 * where it moves, and after a while (or once life dies down) it fades
 * and the words come back, with a nod. Then it starts again.
 *
 * Drawn on 1px cells (see the catalog), each living cell a 4×4 tile with
 * a 1px gap, like a mosaic (UX Spike 4, after the owner's reference). A
 * cell born swells in and one that dies fades out, so generations flow
 * into each other; its colour runs from the accent when new, through
 * pale grey, to a deeper grey as it ages.
 */

type Phase = "living" | "fading" | "resting";

const GENERATIONS_PER_SECOND = 9;
const LIVING_SECONDS = 40;
const FADE_SECONDS = 1.5;
const REST_SECONDS = 6;
/** Screen cells per Life cell: a 4×4 tile and a 1-cell gap. */
const TILE = 5;
/** How quickly a cell swells in or fades out, per second. */
const EASE = 14;

/**
 * A Life grid's tiles, in the scene's cells: their size across and down,
 * and where the first starts (so the Toybox's styles can line them up with
 * the glow's character grid).
 */
export type LifeTiles = { w: number; h: number; ox: number; oy: number };

export class LifeScene implements Scene {
  /** The Life grid's size, in tiles. */
  readonly cols: number;
  readonly rows: number;
  readonly tiles: LifeTiles;
  alive: Uint8Array;
  private next: Uint8Array;
  /** Generations each cell has lived, capped. */
  readonly age: Uint8Array;
  /** How much each tile shows, 0 to 1, easing towards alive or dead. */
  readonly shown: Float32Array;
  phase: Phase = "living";
  private clock = 0;
  private owed = 0;
  private last: Pointer = null;

  constructor(
    private readonly s: SceneSetup,
    tiles: LifeTiles = { w: TILE, h: TILE, ox: 0, oy: 0 },
  ) {
    this.tiles = tiles;
    this.cols = Math.max(1, Math.floor((s.cols - tiles.ox) / tiles.w));
    this.rows = Math.max(1, Math.floor((s.rows - tiles.oy) / tiles.h));
    const n = this.cols * this.rows;
    this.alive = new Uint8Array(n);
    this.next = new Uint8Array(n);
    this.age = new Uint8Array(n);
    this.shown = new Float32Array(n);
    this.seed();
  }

  /** The letters come alive, with a sprinkle so they don't just freeze. */
  private seed() {
    const { s, cols, rows, tiles } = this;
    this.alive.fill(0);
    // A tile is a letter's if enough of its screen cells are: 6 of a 5 × 5,
    // fewer in proportion for bigger tiles (strokes are thin; in the
    // proportion, the Toybox's big tiles caught only a few).
    const enough = 6 * Math.sqrt((tiles.w * tiles.h) / 25);
    for (let ty = 0; ty < rows; ty++)
      for (let tx = 0; tx < cols; tx++) {
        let n = 0;
        const x0 = Math.floor(tiles.ox + tx * tiles.w);
        const y0 = Math.floor(tiles.oy + ty * tiles.h);
        for (let y = Math.max(0, y0); y < Math.min(s.rows, Math.floor(y0 + tiles.h)); y++)
          for (let x = Math.max(0, x0); x < Math.min(s.cols, Math.floor(x0 + tiles.w)); x++)
            n += s.letters[y * s.cols + x]!;
        if (n >= enough) this.alive[ty * cols + tx] = 1;
      }
    // A sprinkle round them, so they don't just freeze. Big tiles get a
    // wide, dense soup: the words make few of them, and a thin sprinkle
    // settled into a few blinkers within seconds.
    const big = tiles.w * tiles.h > 25;
    const band = big ? 7 : 2;
    if (s.words)
      for (let y = s.words.y0 - band * tiles.h; y <= s.words.y1 + band * tiles.h; y += tiles.h)
        for (
          let x = s.words.x0 - (big ? 10 * tiles.w : 0);
          x <= s.words.x1 + (big ? 10 * tiles.w : 0);
          x += tiles.w
        )
          if (s.rng() < (big ? 0.4 : 0.12)) this.setAt(x, y);
    this.age.fill(0);
  }

  /** Brings the tile under (x, y), in the scene's cells, to life. */
  private setAt(x: number, y: number) {
    const tx = Math.floor((x - this.tiles.ox) / this.tiles.w);
    const ty = Math.floor((y - this.tiles.oy) / this.tiles.h);
    if (tx >= 0 && tx < this.cols && ty >= 0 && ty < this.rows) this.alive[ty * this.cols + tx] = 1;
  }

  /**
   * Carries on from `old` after a resize (with tiles the same size): the
   * cells it had stay where they were, as much as fits, and so does where
   * it was in its cycle, instead of seeding from the words again.
   */
  carryFrom(old: LifeScene) {
    this.alive.fill(0);
    this.age.fill(0);
    this.shown.fill(0);
    for (let y = 0; y < Math.min(this.rows, old.rows); y++)
      for (let x = 0; x < Math.min(this.cols, old.cols); x++) {
        const from = y * old.cols + x;
        const to = y * this.cols + x;
        this.alive[to] = old.alive[from]!;
        this.age[to] = old.age[from]!;
        this.shown[to] = old.shown[from]!;
      }
    this.phase = old.phase;
    this.clock = old.clock;
    this.owed = old.owed;
  }

  /** Seconds into its current phase. */
  get phaseSeconds(): number {
    return this.clock;
  }

  get population(): number {
    let n = 0;
    for (const v of this.alive) n += v;
    return n;
  }

  frame(dt: number, pointer: Pointer): FrameResult {
    this.clock += dt;
    const result = this.step(dt, pointer);
    // Every tile eases towards whether its cell is alive.
    const k = Math.min(1, dt * EASE);
    for (let i = 0; i < this.shown.length; i++)
      this.shown[i]! += (this.alive[i]! - this.shown[i]!) * k;
    return result;
  }

  private step(dt: number, pointer: Pointer): FrameResult {
    if (this.phase === "resting") {
      if (this.clock < REST_SECONDS) return {};
      this.phase = "living";
      this.clock = 0;
      this.seed();
      return { hideWords: true };
    }
    if (this.phase === "fading") {
      // Cull at random until nothing's left.
      const keep = Math.max(0, 1 - this.clock / FADE_SECONDS);
      for (let i = 0; i < this.alive.length; i++)
        if (this.alive[i] && this.s.rng() > keep) this.alive[i] = 0;
      if (this.clock < FADE_SECONDS) return {};
      this.alive.fill(0);
      this.phase = "resting";
      this.clock = 0;
      return {};
    }
    const step = Math.min(this.tiles.w, this.tiles.h);
    if (pointer && this.last && Math.hypot(pointer.x - this.last.x, pointer.y - this.last.y) > step)
      for (let k = 0; k < 6; k++)
        this.setAt(
          pointer.x + (this.s.rng() - 0.5) * 6 * this.tiles.w,
          pointer.y + (this.s.rng() - 0.5) * 6 * this.tiles.h,
        );
    if (
      !this.last ||
      !pointer ||
      Math.hypot(pointer.x - this.last.x, pointer.y - this.last.y) > step
    )
      this.last = pointer;
    this.owed += dt * GENERATIONS_PER_SECOND;
    while (this.owed >= 1) {
      this.owed--;
      this.generation();
    }
    // Died down: a dozen cells left on the usual grid, as few in proportion on others.
    const few = Math.max(4, Math.round((12 * this.cols * this.rows) / 20000));
    if (this.clock > LIVING_SECONDS || (this.clock > 5 && this.population < few)) {
      this.phase = "fading";
      this.clock = 0;
      // The words return as life fades, and the icon nods them back.
      return { hideWords: false, nod: true };
    }
    return { hideWords: true };
  }

  private generation() {
    const { cols, rows, alive, next, age } = this;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= rows) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if ((dx || dy) && xx >= 0 && xx < cols) n += alive[yy * cols + xx]!;
          }
        }
        const i = y * cols + x;
        const live = alive[i] ? n === 2 || n === 3 : n === 3;
        next[i] = live ? 1 : 0;
        // A dying cell keeps its age, so it fades out in its own colour.
        if (live) age[i] = alive[i] ? Math.min(255, age[i]! + 1) : 0;
      }
    }
    this.alive = next;
    this.next = alive;
  }

  draw(out: Uint8Array, opacity: Uint8Array) {
    const { s, cols, rows, age, shown } = this;
    out.fill(0);
    for (let ty = 0; ty < rows; ty++)
      for (let tx = 0; tx < cols; tx++) {
        const i = ty * cols + tx;
        const show = shown[i]!;
        if (show < 0.03) continue;
        // New cells in the accent, paling, then settling to grey. (Through
        // bright, the white, they vanished on a light background.)
        const a = Math.min(1, age[i]! / 40);
        const v =
          a < 0.2
            ? blend(SLOT.accent, SLOT.light, a / 0.2)
            : blend(SLOT.light, SLOT.mid, (a - 0.2) / 0.8);
        const solid = Math.round(show * 255);
        const tw = Math.round(this.tiles.w);
        const th = Math.round(this.tiles.h);
        const x0 = Math.round(this.tiles.ox + tx * this.tiles.w);
        const y0 = Math.round(this.tiles.oy + ty * this.tiles.h);
        for (let y = 0; y < th - 1; y++)
          for (let x = 0; x < tw - 1; x++) {
            // The corners a little see-through, so the tiles look rounded.
            const corner = (x === 0 || x === tw - 2) && (y === 0 || y === th - 2);
            if (x0 + x >= s.cols || y0 + y >= s.rows) continue;
            const j = (y0 + y) * s.cols + x0 + x;
            out[j] = v;
            opacity[j] = corner ? Math.round(solid * 0.35) : solid;
          }
      }
  }
}
