/**
 * The empty list's screensaver: pixel sand, like a desk sand-art frame.
 * Coloured layers pour in from a wandering spout, heap up on the empty
 * state's icon and words (and on the pointer), then drain away through the
 * floor like an hourglass, and it starts over.
 *
 * Pure logic on a grid of cells, one cell per few screen pixels; the UI
 * (`SandScreensaver`) draws the grid and feeds in the solids and pointer.
 */

/** Screen pixels per sand cell: chunky enough to read as pixel art. */
export const SAND_CELL_PX = 3;
/** How long without input before the screensaver starts. */
export const SCREENSAVER_IDLE_SECONDS = 60;
/** Window event that starts the screensaver now (the palette's command). */
export const SCREENSAVER_EVENT = "mailboat:screensaver";

/** Sand-art colours, poured in turn so the heap shows layers. */
export const SAND_COLORS = ["#0a84ff", "#e8cfa0", "#7fbfff", "#b4a7ff", "#5fd4c4", "#f2a98a"];
/** Each grain gets one of a few shades of its colour, for texture. */
export const SAND_SHADES = 4;
/** Seconds each colour pours before the next. */
export const LAYER_SECONDS = 5;

export const EMPTY = 0;
/** The icon and words: sand rests on them. */
export const SOLID = 1;
/** The pointer: sand rests on it and is pushed aside as it moves. */
export const CURSOR = 2;
/** Grain values start here: GRAIN + colour × SAND_SHADES + shade. */
export const GRAIN = 16;

const MAX_SPEED = 5;
const GRAVITY = 0.12;

export type Rng = () => number;

export function grainValue(color: number, shade: number): number {
  return GRAIN + (color % SAND_COLORS.length) * SAND_SHADES + (shade % SAND_SHADES);
}

/** A grain in flight (pushed by the pointer or shrugged off the icon). */
type Particle = { x: number; y: number; vx: number; vy: number; v: number };

/** The grid and its physics. */
export class SandBox {
  readonly cells: Uint8Array;
  private readonly speed: Uint8Array;
  readonly particles: Particle[] = [];
  private cursor: number[] = [];
  private cursorAt: { x: number; y: number } | null = null;
  /** While true the floor is open and grains fall out of the bottom. */
  draining = false;
  /** Grains on the grid plus those in flight. */
  grains = 0;

  constructor(
    readonly cols: number,
    readonly rows: number,
    private readonly rng: Rng = Math.random,
  ) {
    this.cells = new Uint8Array(cols * rows);
    this.speed = new Uint8Array(cols * rows);
  }

  /** Marks cells sand can't enter (1 in `mask`); grains already there go. */
  setSolids(mask: Uint8Array) {
    for (let i = 0; i < this.cells.length; i++) {
      const v = this.cells[i]!;
      if (mask[i]) {
        if (v >= GRAIN) this.grains--;
        this.cells[i] = SOLID;
      } else if (v === SOLID) this.cells[i] = EMPTY;
    }
  }

  /** Drops a grain in at the top, if there's room. */
  pour(x: number, v: number): boolean {
    const cx = Math.round(x);
    if (cx < 0 || cx >= this.cols || this.cells[cx] !== EMPTY) return false;
    this.cells[cx] = v;
    this.speed[cx] = 1;
    this.grains++;
    return true;
  }

  /** One frame: grains in flight move, then the sand falls and slides. */
  step() {
    const { cols, rows, cells, speed, rng } = this;
    this.stepParticles();
    if (this.draining) {
      const base = (rows - 1) * cols;
      for (let x = 0; x < cols; x++) {
        if (cells[base + x]! >= GRAIN && rng() < 0.4) {
          cells[base + x] = EMPTY;
          this.grains--;
        }
      }
    }
    // Bottom-up, so a grain that falls lands in a row already done this
    // frame and isn't moved twice. The direction across alternates at
    // random so heaps don't lean.
    for (let y = rows - 2; y >= 0; y--) {
      const ltr = rng() < 0.5;
      for (let i = 0; i < cols; i++) {
        const x = ltr ? i : cols - 1 - i;
        const at = y * cols + x;
        const v = cells[at]!;
        if (v < GRAIN) continue;
        const s = speed[at]!;
        let ny = y;
        while (ny - y < s && ny + 1 < rows && cells[(ny + 1) * cols + x] === EMPTY) ny++;
        if (ny > y) {
          const to = ny * cols + x;
          cells[at] = EMPTY;
          cells[to] = v;
          speed[to] = ny - y === s ? Math.min(s + 1, MAX_SPEED) : 1;
          continue;
        }
        speed[at] = 1;
        const first = rng() < 0.5 ? -1 : 1;
        for (const d of [first, -first]) {
          const nx = x + d;
          if (nx < 0 || nx >= cols) continue;
          if (cells[y * cols + nx] !== EMPTY || cells[(y + 1) * cols + nx] !== EMPTY) continue;
          cells[at] = EMPTY;
          cells[(y + 1) * cols + nx] = v;
          speed[(y + 1) * cols + nx] = 1;
          break;
        }
      }
    }
  }

  private stepParticles() {
    const { cols, rows, cells } = this;
    const kept: Particle[] = [];
    for (const p of this.particles) {
      p.vy += GRAVITY;
      p.vx *= 0.98;
      const n = Math.max(1, Math.ceil(Math.max(Math.abs(p.vx), Math.abs(p.vy))));
      let landed = false;
      for (let k = 0; k < n; k++) {
        let nx = p.x + p.vx / n;
        const ny = p.y + p.vy / n;
        if (nx < 0 || nx > cols - 1) {
          nx = Math.max(0, Math.min(cols - 1, nx));
          p.vx = -p.vx * 0.4;
        }
        if (ny > rows - 1) {
          if (this.draining) this.grains--;
          else this.settle(nx, rows - 1, p.v);
          landed = true;
          break;
        }
        const cy = Math.round(ny);
        if (cy >= 0 && cells[cy * cols + Math.round(nx)] !== EMPTY) {
          this.settle(p.x, p.y, p.v);
          landed = true;
          break;
        }
        p.x = nx;
        p.y = ny;
      }
      if (!landed) kept.push(p);
    }
    this.particles.length = 0;
    this.particles.push(...kept);
  }

  /** Puts a grain from flight back on the grid, at or above (x, y). */
  private settle(x: number, y: number, v: number) {
    const cx = Math.max(0, Math.min(this.cols - 1, Math.round(x)));
    for (let cy = Math.min(this.rows - 1, Math.max(0, Math.round(y))); cy >= 0; cy--) {
      const at = cy * this.cols + cx;
      if (this.cells[at] === EMPTY) {
        this.cells[at] = v;
        this.speed[at] = 1;
        return;
      }
    }
    this.grains--; // No room in this column: the grain is lost.
  }

  private launch(at: number, vx: number, vy: number) {
    const v = this.cells[at]!;
    this.cells[at] = EMPTY;
    this.particles.push({ x: at % this.cols, y: Math.floor(at / this.cols), vx, vy, v });
  }

  /**
   * Moves the pointer's shape (cell offsets from its tip) to (x, y), or
   * takes it away with null. Grains in its new place are flung along the
   * way it moved, so it can dig and scatter; grains resting on it stay
   * until it moves out from under them.
   */
  setCursor(at: { x: number; y: number } | null, shape: readonly (readonly [number, number])[]) {
    const { cols, rows, cells, rng } = this;
    for (const i of this.cursor) if (cells[i] === CURSOR) cells[i] = EMPTY;
    this.cursor = [];
    const prev = this.cursorAt;
    this.cursorAt = at;
    if (!at) return;
    const mvx = prev ? Math.max(-4, Math.min(4, at.x - prev.x)) : 0;
    const mvy = prev ? Math.max(-4, Math.min(4, at.y - prev.y)) : 0;
    const tx = Math.round(at.x);
    const ty = Math.round(at.y);
    for (const [dx, dy] of shape) {
      const x = tx + dx;
      const y = ty + dy;
      if (x < 0 || x >= cols || y < 0 || y >= rows) continue;
      const i = y * cols + x;
      if (cells[i] === SOLID) continue;
      if (cells[i]! >= GRAIN)
        this.launch(i, mvx * 0.7 + (rng() - 0.5), Math.min(mvy * 0.7, 0) - 0.4 - rng() * 0.8);
      cells[i] = CURSOR;
      this.cursor.push(i);
    }
  }

  /** How many grains lie in the `depth` rows just above `top`, across x0..x1. */
  restingOn(x0: number, x1: number, top: number, depth: number): number {
    let n = 0;
    for (let y = Math.max(0, top - depth); y < top; y++)
      for (let x = Math.max(0, x0); x <= Math.min(this.cols - 1, x1); x++)
        if (this.cells[y * this.cols + x]! >= GRAIN) n++;
    return n;
  }

  /**
   * Flings the heap sitting on top of x0..x1 (rows above `top`) up and
   * outwards, as if the icon shrugged it off. Returns how many went.
   */
  shrug(x0: number, x1: number, top: number): number {
    const mid = (x0 + x1) / 2;
    const half = Math.max(1, (x1 - x0) / 2);
    let n = 0;
    for (let x = Math.max(0, x0); x <= Math.min(this.cols - 1, x1); x++) {
      for (let y = top - 1; y >= 0; y--) {
        const i = y * this.cols + x;
        if (this.cells[i]! < GRAIN) break;
        const out = (x - mid) / half;
        this.launch(i, out * (1 + this.rng() * 1.2), -1.2 - this.rng() * 1.8);
        n++;
      }
    }
    return n;
  }
}

/** Where the spout is, as a share of the width, `t` seconds in: a slow wander. */
export function spoutAt(t: number): number {
  return 0.5 + 0.38 * Math.sin(t * 0.21) * Math.cos(t * 0.067 + 1.3);
}

/** Which colour pours `t` seconds in. */
export function layerAt(t: number): number {
  return Math.floor(t / LAYER_SECONDS) % SAND_COLORS.length;
}

/**
 * The whole show: pour until the frame holds `budget` grains, drain until
 * nearly empty, repeat. Also tells the UI when the icon's heap is high
 * enough to shrug off.
 */
export class SandShow {
  readonly box: SandBox;
  /** Fill target: the heap reaches about a third of the way up. */
  readonly budget: number;
  private t = 0;
  private lastShrug = -Infinity;

  constructor(
    cols: number,
    rows: number,
    private readonly rng: Rng = Math.random,
  ) {
    this.box = new SandBox(cols, rows, rng);
    this.budget = Math.round(cols * rows * 0.16);
  }

  get phase(): "pouring" | "draining" {
    return this.box.draining ? "draining" : "pouring";
  }

  /**
   * Advances by `dt` seconds. `icon` is the icon's top edge and columns in
   * cells; returns true when it should shrug its heap off this frame.
   */
  frame(dt: number, icon?: { x0: number; x1: number; top: number }): boolean {
    const { box, rng } = this;
    this.t += dt;
    if (box.draining) {
      if (box.grains <= this.budget * 0.03) box.draining = false;
    } else if (box.grains >= this.budget) {
      box.draining = true;
    } else {
      const x = spoutAt(this.t) * (box.cols - 1);
      const color = layerAt(this.t);
      for (let k = 0; k < 3; k++)
        box.pour(x + (rng() - 0.5) * 3, grainValue(color, Math.floor(rng() * SAND_SHADES)));
    }
    box.step();
    if (!icon || this.t - this.lastShrug < 4) return false;
    const width = icon.x1 - icon.x0 + 1;
    if (box.restingOn(icon.x0, icon.x1, icon.top, 4) < width * 2.2) return false;
    this.lastShrug = this.t;
    box.shrug(icon.x0, icon.x1, icon.top);
    return true;
  }
}

/**
 * The macOS arrow pointer as cell offsets from its tip, at `cellPx` screen
 * pixels per cell, so sand can rest on it.
 */
export function arrowCells(cellPx: number): [number, number][] {
  // Outline in screen pixels, tip at (0, 0), white edge included.
  const poly: [number, number][] = [
    [0, 0],
    [0, 17],
    [4, 13.5],
    [7, 20],
    [10, 18.8],
    [7.2, 12.5],
    [12.5, 12.5],
  ];
  const inside = (px: number, py: number) => {
    let hit = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i]!;
      const [xj, yj] = poly[j]!;
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  };
  const cells: [number, number][] = [];
  for (let cy = 0; cy * cellPx < 21; cy++)
    for (let cx = 0; cx * cellPx < 13; cx++)
      // A cell counts if any of four points in it is inside, so the
      // narrow tip still gets a cell.
      if (
        [0.25, 0.75].some((fx) =>
          [0.25, 0.75].some((fy) => inside((cx + fx) * cellPx, (cy + fy) * cellPx)),
        )
      )
        cells.push([cx, cy]);
  return cells;
}
