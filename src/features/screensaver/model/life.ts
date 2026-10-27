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

export class LifeScene implements Scene {
  /** The Life grid's size, in tiles. */
  private readonly cols: number;
  private readonly rows: number;
  private alive: Uint8Array;
  private next: Uint8Array;
  /** Generations each cell has lived, capped. */
  private readonly age: Uint8Array;
  /** How much each tile shows, 0 to 1, easing towards alive or dead. */
  private readonly shown: Float32Array;
  phase: Phase = "living";
  private clock = 0;
  private owed = 0;
  private last: Pointer = null;

  constructor(private readonly s: SceneSetup) {
    this.cols = Math.max(1, Math.floor(s.cols / TILE));
    this.rows = Math.max(1, Math.floor(s.rows / TILE));
    const n = this.cols * this.rows;
    this.alive = new Uint8Array(n);
    this.next = new Uint8Array(n);
    this.age = new Uint8Array(n);
    this.shown = new Float32Array(n);
    this.seed();
  }

  /** The letters come alive, with a sprinkle so they don't just freeze. */
  private seed() {
    const { s, cols, rows } = this;
    this.alive.fill(0);
    // A tile is a letter's if enough of its screen cells are.
    for (let ty = 0; ty < rows; ty++)
      for (let tx = 0; tx < cols; tx++) {
        let n = 0;
        for (let y = 0; y < TILE; y++)
          for (let x = 0; x < TILE; x++) n += s.letters[(ty * TILE + y) * s.cols + tx * TILE + x]!;
        if (n >= 6) this.alive[ty * cols + tx] = 1;
      }
    if (s.words)
      for (let y = s.words.y0 - 2 * TILE; y <= s.words.y1 + 2 * TILE; y += TILE)
        for (let x = s.words.x0; x <= s.words.x1; x += TILE)
          if (s.rng() < 0.12) this.set(x / TILE, y / TILE);
    this.age.fill(0);
  }

  /** Brings the tile at (x, y), in tiles, to life. */
  private set(x: number, y: number) {
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    if (tx >= 0 && tx < this.cols && ty >= 0 && ty < this.rows) this.alive[ty * this.cols + tx] = 1;
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
    if (pointer && this.last && Math.hypot(pointer.x - this.last.x, pointer.y - this.last.y) > TILE)
      for (let k = 0; k < 6; k++)
        this.set(
          (pointer.x + (this.s.rng() - 0.5) * 6 * TILE) / TILE,
          (pointer.y + (this.s.rng() - 0.5) * 6 * TILE) / TILE,
        );
    if (
      !this.last ||
      !pointer ||
      Math.hypot(pointer.x - this.last.x, pointer.y - this.last.y) > TILE
    )
      this.last = pointer;
    this.owed += dt * GENERATIONS_PER_SECOND;
    while (this.owed >= 1) {
      this.owed--;
      this.generation();
    }
    if (this.clock > LIVING_SECONDS || (this.clock > 5 && this.population < 12)) {
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
        for (let y = 0; y < TILE - 1; y++)
          for (let x = 0; x < TILE - 1; x++) {
            // The corners a little see-through, so the tiles look rounded.
            const corner = (x === 0 || x === TILE - 2) && (y === 0 || y === TILE - 2);
            const j = (ty * TILE + y) * s.cols + tx * TILE + x;
            out[j] = v;
            opacity[j] = corner ? Math.round(solid * 0.35) : solid;
          }
      }
  }
}
