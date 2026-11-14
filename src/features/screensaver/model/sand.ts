/**
 * The empty list's screensaver: pixel sand in the style of a sandscape
 * (the frames of sand and liquid between two panes of glass that you turn
 * over). A ceiling of layered sand leaks through a few gaps in slow, thin
 * curtains that settle into steep, finely layered hills, heaping on the
 * empty state's icon and words and on the pointer too. When the ceiling is
 * spent and the hills are still, the frame rests a while, turns over, and
 * the finished landscape becomes the next ceiling.
 *
 * `SandBox` is the grid and its physics, `SandShow` the cycle, and
 * `SandscapeScene` fits them to the scene contract (`scene.ts`).
 */

import {
  blend,
  type FrameResult,
  ink,
  type Pointer,
  type Rng,
  type Scene,
  type SceneSetup,
  SLOT,
  type Slot,
} from "./scene";

/**
 * Screen pixels per grain: finer than the 3px it began with (UX Spike 4).
 * The leaks pour proportionally more, so a cycle takes about as long.
 */
export const SAND_CELL_PX = 2;

/**
 * The sands. Heavier ones sink faster through the liquid (`fall` is the
 * chance of dropping a cell each frame), which is part of why real
 * sandscapes settle in separate layers.
 */
export const SAND_KINDS: readonly { slot: Slot; fall: number }[] = [
  { slot: SLOT.dark, fall: 0.95 }, // heaviest
  { slot: SLOT.bright, fall: 0.82 }, // lightest
  { slot: SLOT.accent, fall: 0.9 },
  { slot: SLOT.light, fall: 0.86 },
];
/** Each grain gets one of a few shades of its sand, for texture. */
export const SAND_SHADES = 4;
/** How long a finished landscape rests before the frame turns over. */
export const REST_SECONDS = 12;
/** How long the turn takes. */
export const FLIP_SECONDS = 1.8;
/** How long the leaks may free nothing before the rest of the ceiling lets go. */
const STUCK_SECONDS = 3;

export const EMPTY = 0;
/** The icon and words: sand rests on them. */
export const SOLID = 1;
/** The pointer: sand rests on it and is pushed aside as it moves. */
export const CURSOR = 2;
/** Grain values start here: GRAIN + kind × SAND_SHADES + shade. */
export const GRAIN = 16;
/** Set on grains of the ceiling, which hang until a leak lets them go. */
export const HELD = 128;

/** In liquid, flung grains slow quickly and sink gently. */
const GRAVITY = 0.05;
const DRAG = 0.92;
/** Frames a landed grain may still roll down a 45° slope before it locks. */
const ROLL_FRAMES = 3;
const LEAKS = 3;
/** How far either side of a gap the ceiling gives way, in cells. */
const LEAK_REACH = 4;

/** Whether a cell holds a ceiling grain. */
const hanging = (v: number) => v >= GRAIN && (v & HELD) !== 0;

export function grainValue(kind: number, shade: number): number {
  return GRAIN + (kind % SAND_KINDS.length) * SAND_SHADES + (shade % SAND_SHADES);
}

/** Which sand a grain value is (held or not). */
export function kindOf(v: number): number {
  return Math.floor(((v & ~HELD) - GRAIN) / SAND_SHADES);
}

/** A grain in flight (pushed by the pointer or shrugged off the icon). */
type Particle = { x: number; y: number; vx: number; vy: number; v: number };

/** The grid and its physics. */
export class SandBox {
  readonly cells: Uint8Array;
  /** Frames left in which each landed grain may roll. */
  private readonly roll: Uint8Array;
  readonly particles: Particle[] = [];
  private cursor: number[] = [];
  private cursorAt: { x: number; y: number } | null = null;
  /** Grains on the grid plus those in flight. */
  grains = 0;
  /** Of those, how many hang in the ceiling. */
  held = 0;
  /** How many grains moved (or were still falling) in the last step. */
  moving = 0;

  constructor(
    readonly cols: number,
    readonly rows: number,
    private readonly rng: Rng = Math.random,
  ) {
    this.cells = new Uint8Array(cols * rows);
    this.roll = new Uint8Array(cols * rows);
  }

  /**
   * Takes the sand of `old` (a box of another size) after a resize: the
   * hanging ceiling stays at the top and everything else keeps to the
   * floor, so hills don't float when the box grows taller; columns keep
   * their place from the left. What no longer fits is gone.
   */
  carryFrom(old: SandBox) {
    this.cells.fill(EMPTY);
    this.roll.fill(0);
    this.grains = 0;
    this.held = 0;
    const down = this.rows - old.rows;
    for (let y = 0; y < old.rows; y++)
      for (let x = 0; x < Math.min(this.cols, old.cols); x++) {
        const v = old.cells[y * old.cols + x]!;
        if (v < GRAIN) continue;
        const ny = v & HELD ? y : y + down;
        if (ny < 0 || ny >= this.rows) continue;
        this.cells[ny * this.cols + x] = v;
        this.grains++;
        if (v & HELD) this.held++;
      }
    this.particles.length = 0;
    for (const p of old.particles)
      if (p.x < this.cols && p.y + down >= 0) {
        this.particles.push({ ...p, y: p.y + down });
        this.grains++;
      }
  }

  /** Marks cells sand can't enter (1 in `mask`); grains already there go. */
  setSolids(mask: Uint8Array) {
    for (let i = 0; i < this.cells.length; i++) {
      const v = this.cells[i]!;
      if (mask[i]) {
        if (v >= GRAIN) this.forget(v);
        this.cells[i] = SOLID;
      } else if (v === SOLID) this.cells[i] = EMPTY;
    }
  }

  private forget(v: number) {
    this.grains--;
    if (v & HELD) this.held--;
  }

  /** Drops a free grain in at the top, if there's room. */
  pour(x: number, v: number): boolean {
    const cx = Math.round(x);
    if (cx < 0 || cx >= this.cols || this.cells[cx] !== EMPTY) return false;
    this.cells[cx] = v;
    this.grains++;
    return true;
  }

  /** Places a ceiling grain at (x, y), if the cell is free. */
  hang(x: number, y: number, v: number): boolean {
    const at = y * this.cols + x;
    if (this.cells[at] !== EMPTY) return false;
    this.cells[at] = v | HELD;
    this.grains++;
    this.held++;
    return true;
  }

  /**
   * The row of the lowest ceiling grain in column x, if nothing holds it
   * up from below (so it could fall); otherwise -1.
   */
  private looseBottom(x: number): number {
    if (x < 0 || x >= this.cols) return -1;
    const { cols, cells } = this;
    for (let y = this.rows - 1; y >= 0; y--) {
      const v = cells[y * cols + x]!;
      if (v < GRAIN || !(v & HELD)) continue;
      return y + 1 < this.rows && cells[(y + 1) * cols + x] === EMPTY ? y : -1;
    }
    return -1;
  }

  /**
   * Lets a ceiling grain go near column x: the lowest loose one within
   * `reach` columns, so the ceiling wears away in a wide funnel rather
   * than a slot. With `v` it falls as that sand instead (the show uses
   * this to pour in layers). Returns whether one fell.
   */
  release(x: number, reach = 0, v?: number): boolean {
    let best = -1;
    let bestY = -1;
    for (let cx = x - reach; cx <= x + reach; cx++) {
      const y = this.looseBottom(cx);
      // Ties go to the column nearer the gap.
      if (y > bestY || (y === bestY && y >= 0 && Math.abs(cx - x) < Math.abs(best - x))) {
        best = cx;
        bestY = y;
      }
    }
    if (bestY < 0) return false;
    const at = bestY * this.cols + best;
    this.cells[at] = v ?? this.cells[at]! & ~HELD;
    this.held--;
    return true;
  }

  /**
   * One frame: grains in flight move, then free sand sinks, drifting a
   * little, and slides. A grain sinks a cell with its sand's `fall`
   * chance. Landed grains slide down steep (2:1) slopes, and down 45° ones
   * only for a few frames after landing, so hills stand steep and jagged
   * as they do in liquid.
   */
  step() {
    const { cols, rows, cells, roll, rng } = this;
    this.stepParticles();
    let moving = 0;
    // Bottom-up, so a grain that falls lands in a row already done this
    // frame and isn't moved twice. The direction across alternates at
    // random so hills don't lean.
    for (let y = rows - 2; y >= 0; y--) {
      const ltr = rng() < 0.5;
      for (let i = 0; i < cols; i++) {
        const x = ltr ? i : cols - 1 - i;
        const at = y * cols + x;
        const v = cells[at]!;
        if (v < GRAIN || v & HELD) continue;
        const below = at + cols;
        if (cells[below] === EMPTY) {
          moving++;
          if (rng() >= SAND_KINDS[kindOf(v)]!.fall) continue;
          let to = below;
          if (rng() < 0.08) {
            const nx = x + (rng() < 0.5 ? -1 : 1);
            if (
              nx >= 0 &&
              nx < cols &&
              cells[y * cols + nx] === EMPTY &&
              cells[below - x + nx] === EMPTY
            )
              to = below - x + nx;
          }
          cells[at] = EMPTY;
          cells[to] = v;
          roll[to] = ROLL_FRAMES;
          continue;
        }
        const first = rng() < 0.5 ? -1 : 1;
        for (const d of [first, -first]) {
          const nx = x + d;
          if (nx < 0 || nx >= cols) continue;
          const diag = below + d;
          if (cells[at + d] !== EMPTY || cells[diag] !== EMPTY) continue;
          const steep = y + 2 < rows && cells[diag + cols] === EMPTY;
          if (!steep && roll[at] === 0) continue;
          cells[at] = EMPTY;
          cells[diag] = v;
          roll[diag] = Math.max(0, roll[at]! - 1);
          moving++;
          break;
        }
        if (cells[at] === v && roll[at]! > 0) roll[at] = roll[at]! - 1;
      }
    }
    this.moving = moving + this.particles.length;
  }

  private stepParticles() {
    const { cols, rows, cells } = this;
    const kept: Particle[] = [];
    for (const p of this.particles) {
      p.vy += GRAVITY;
      p.vx *= DRAG;
      p.vy *= DRAG;
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
          this.settle(nx, rows - 1, p.v);
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
      // Slowed to a drift: it rejoins the sand and sinks from here.
      if (!landed && Math.abs(p.vx) < 0.15 && p.vy > 0 && p.vy < 0.6) {
        this.settle(p.x, p.y, p.v);
        landed = true;
      }
      if (!landed) kept.push(p);
    }
    this.particles.length = 0;
    this.particles.push(...kept);
  }

  /**
   * Puts a grain from flight back on the grid: at (x, y) or the nearest
   * free cell above it, else the nearest below (it may have flown above
   * the top edge, onto a full top row).
   */
  private settle(x: number, y: number, v: number) {
    const cx = Math.max(0, Math.min(this.cols - 1, Math.round(x)));
    const cy = Math.min(this.rows - 1, Math.max(0, Math.round(y)));
    for (let d = 0; d < this.rows; d++) {
      for (const ty of [cy - d, cy + d]) {
        if (ty < 0 || ty >= this.rows) continue;
        const at = ty * this.cols + cx;
        if (this.cells[at] === EMPTY) {
          this.cells[at] = v;
          this.roll[at] = ROLL_FRAMES;
          return;
        }
      }
    }
    this.grains--; // The whole column is full: the grain is lost.
  }

  private launch(at: number, vx: number, vy: number) {
    const v = this.cells[at]!;
    if (v & HELD) this.held--;
    this.cells[at] = EMPTY;
    this.particles.push({ x: at % this.cols, y: Math.floor(at / this.cols), vx, vy, v: v & ~HELD });
  }

  /**
   * Moves the pointer's shape (cell offsets from its tip) to (x, y), or
   * takes it away with null. Grains in its new place are pushed along the
   * way it moved, so it can dig and stir; grains resting on it stay until
   * it moves out from under them.
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
    const cut = new Set<number>();
    for (const [dx, dy] of shape) {
      const x = tx + dx;
      const y = ty + dy;
      if (x < 0 || x >= cols || y < 0 || y >= rows) continue;
      const i = y * cols + x;
      if (cells[i] === SOLID) continue;
      if (cells[i]! >= GRAIN) {
        if (cells[i]! & HELD) cut.add(x);
        this.launch(i, mvx * 0.8 + (rng() - 0.5), Math.min(mvy * 0.8, 0) - 0.6 - rng() * 0.8);
      }
      cells[i] = CURSOR;
      this.cursor.push(i);
    }
    for (const x of cut) this.dropBelowGap(x);
  }

  /**
   * The ceiling hangs from the top edge, so in column x every ceiling
   * grain below the first gap has nothing holding it up: it lets go and
   * falls. (Cut by the pointer, the sand below used to hang on until a
   * leak let it go; owner, 2026-10-27.)
   */
  private dropBelowGap(x: number) {
    const { cols, rows, cells } = this;
    let y = 0;
    while (y < rows && hanging(cells[y * cols + x]!)) y++;
    for (; y < rows; y++) {
      const i = y * cols + x;
      if (!hanging(cells[i]!)) continue;
      cells[i] = cells[i]! & ~HELD;
      this.held--;
    }
  }

  /**
   * Every ceiling grain left becomes ordinary sand: what's free falls,
   * what sits on a pile stays. For when the leaks can't free any more.
   */
  letGo() {
    const { cells } = this;
    for (let i = 0; i < cells.length; i++)
      if (cells[i]! >= GRAIN && cells[i]! & HELD) cells[i] = cells[i]! & ~HELD;
    this.held = 0;
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
        this.launch(i, out * (1.5 + this.rng() * 1.5), -2 - this.rng() * 2);
        n++;
      }
    }
    return n;
  }

  /**
   * Turns the frame over (180°): every grain moves to the opposite cell.
   * Grains in flight land first; any that would land inside the icon or
   * words are lost. Then whatever hangs from the top edge in an unbroken
   * column becomes the new ceiling; the rest falls.
   */
  turnOver() {
    const { cells } = this;
    for (const i of this.cursor) if (cells[i] === CURSOR) cells[i] = EMPTY;
    this.cursor = [];
    this.cursorAt = null;
    for (const p of this.particles) this.settle(p.x, p.y, p.v);
    this.particles.length = 0;
    const n = cells.length;
    const moved: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const v = cells[i]!;
      if (v < GRAIN) continue;
      moved.push([n - 1 - i, v & ~HELD]);
      cells[i] = EMPTY;
    }
    this.held = 0;
    for (const [to, v] of moved) {
      if (cells[to] === EMPTY) cells[to] = v;
      else this.grains--;
    }
    this.roll.fill(0);
    for (let x = 0; x < this.cols; x++) {
      for (let y = 0; y < this.rows; y++) {
        const at = y * this.cols + x;
        if (cells[at]! < GRAIN) break;
        cells[at] = cells[at]! | HELD;
        this.held++;
      }
    }
  }
}

/** A gap in the ceiling that sand trickles through for a while. */
type Leak = { x: number; rate: number; life: number; owed: number; drift: number };

export type ShowPhase = "falling" | "resting" | "turning";

/**
 * The whole show: a layered ceiling leaks through a few wandering gaps
 * into a landscape; once the ceiling is spent and the sand is still, it
 * rests, turns over, and the landscape is the next ceiling. Also tells the
 * UI when the icon's heap is high enough to shrug off.
 */
export class SandShow {
  readonly box: SandBox;
  phase: ShowPhase = "falling";
  /** How far through the turn (0 to 1) while `phase` is "turning". */
  turn = 0;
  private t = 0;
  private quiet = 0;
  private restLeft = 0;
  private lastShrug = -Infinity;
  /** Seconds the leaks have freed nothing while the ceiling still hangs. */
  private stuck = 0;
  private readonly leaks: Leak[] = [];
  /** The sand falling now, and for how much longer, so curtains lay down layers. */
  private layer = { kind: 0, left: 0 };

  constructor(
    cols: number,
    rows: number,
    private readonly rng: Rng = Math.random,
  ) {
    this.box = new SandBox(cols, rows, rng);
    fillCeiling(this.box, rng);
  }

  /** Carries on from `old` after a resize: its sand (`SandBox.carryFrom`) and where it is in its cycle. */
  carryFrom(old: SandShow) {
    this.box.carryFrom(old.box);
    this.phase = old.phase;
    this.turn = old.turn;
    this.t = old.t;
    this.quiet = old.quiet;
    this.restLeft = old.restLeft;
    this.lastShrug = old.lastShrug;
    this.stuck = old.stuck;
    this.leaks.length = 0;
    for (const l of old.leaks) if (l.x < this.box.cols) this.leaks.push({ ...l });
    this.layer = { ...old.layer };
  }

  /**
   * Advances by `dt` seconds. `icon` is the icon's top edge and columns in
   * cells; returns true when it should shrug its heap off this frame.
   */
  frame(dt: number, icon?: { x0: number; x1: number; top: number }): boolean {
    const { box } = this;
    this.t += dt;
    if (this.phase === "turning") {
      this.turn = Math.min(1, this.turn + dt / FLIP_SECONDS);
      if (this.turn >= 1) {
        box.turnOver();
        this.phase = "falling";
        this.turn = 0;
        this.quiet = 0;
        this.stuck = 0;
        this.leaks.length = 0;
      }
      return false;
    }
    if (this.phase === "falling") {
      this.leak(dt);
      this.quiet = box.held === 0 && box.moving === 0 ? this.quiet + dt : 0;
      if (this.quiet > 1) {
        this.phase = "resting";
        this.restLeft = REST_SECONDS;
      }
    } else if ((this.restLeft -= dt) <= 0) {
      this.phase = "turning";
      this.turn = 0;
      return false;
    }
    box.step();
    if (!icon || this.t - this.lastShrug < 4) return false;
    const width = icon.x1 - icon.x0 + 1;
    if (box.restingOn(icon.x0, icon.x1, icon.top, 5) < width * 2.6) return false;
    this.lastShrug = this.t;
    box.shrug(icon.x0, icon.x1, icon.top);
    return true;
  }

  private leak(dt: number) {
    const { box, rng } = this;
    if (box.held === 0) return;
    if ((this.layer.left -= dt) <= 0) this.layer = nextLayer(this.layer.kind, rng);
    while (this.leaks.length < LEAKS) this.leaks.push(this.newLeak());
    let freed = false;
    for (const leak of this.leaks) {
      leak.life -= dt;
      leak.owed += leak.rate * dt;
      // Gaps wander slowly, so curtains sweep a little.
      leak.x = Math.max(0, Math.min(box.cols - 1, leak.x + leak.drift * dt));
      while (leak.owed >= 1) {
        leak.owed--;
        const v = grainValue(this.layer.kind, Math.floor(rng() * SAND_SHADES));
        if (!box.release(Math.round(leak.x), LEAK_REACH, v)) {
          leak.life = Math.min(leak.life, 0.5);
          break;
        }
        freed = true;
      }
      if (leak.life <= 0) Object.assign(leak, this.newLeak());
    }
    // The last of the ceiling can end up propped on sand piled on the
    // pointer, so it never counts as loose and the frame never turned
    // over (owner, 2026-10-27). After a while freeing nothing, let it go.
    this.stuck = freed ? 0 : this.stuck + dt;
    if (this.stuck > STUCK_SECONDS) {
      box.letGo();
      this.stuck = 0;
    }
  }

  private newLeak(): Leak {
    const { box, rng } = this;
    // Somewhere the ceiling still has sand, if a few tries find it.
    let x = Math.floor(rng() * box.cols);
    for (let k = 0; k < 12 && !(box.cells[x]! & HELD); k++) x = Math.floor(rng() * box.cols);
    return {
      x,
      rate: 55 + rng() * 45,
      life: 6 + rng() * 8,
      owed: 0,
      drift: (rng() - 0.5) * 4.5,
    };
  }
}

/**
 * The next layer: dark and light sands take turns in thin bands, with the
 * odd blue one in place of the dark.
 */
function nextLayer(kind: number, rng: Rng): { kind: number; left: number } {
  const next = kind === 1 ? (rng() < 0.65 ? 0 : rng() < 0.5 ? 2 : 3) : 1;
  return { kind: next, left: 1.2 + rng() * 2.5 };
}

/**
 * The first ceiling: about a sixth of the frame, hanging from the top with
 * a wavy lower edge, in thin bands that alternate dark and light sands
 * (with the occasional blue), as a sandscape's ceiling looks after a turn.
 */
export function fillCeiling(box: SandBox, rng: Rng) {
  const { cols, rows } = box;
  const p1 = rng() * 6;
  const p2 = rng() * 6;
  const bands: number[] = [];
  let kind = 0;
  for (let y = 0; y < rows;) {
    const thick = 2 + Math.floor(rng() * 4);
    for (let k = 0; k < thick; k++) bands.push(kind);
    y += thick;
    kind = kind === 1 ? (rng() < 0.6 ? 0 : rng() < 0.6 ? 2 : 3) : 1;
  }
  for (let x = 0; x < cols; x++) {
    const depth = Math.round(
      rows * (0.17 + 0.05 * Math.sin(x * 0.06 + p1) + 0.03 * Math.sin(x * 0.17 + p2)),
    );
    const wave = Math.round(2 * Math.sin(x * 0.05 + p2));
    for (let y = 0; y < Math.min(rows, depth); y++) {
      const band = bands[Math.max(0, Math.min(bands.length - 1, y + wave))]!;
      box.hang(x, y, grainValue(band, Math.floor(rng() * SAND_SHADES)));
    }
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

/** The sandscape as a scene: the show, the pointer's arrow, and drawing. */
export class SandscapeScene implements Scene {
  private readonly show: SandShow;
  private readonly arrow = arrowCells(SAND_CELL_PX);
  private readonly icon?: { x0: number; x1: number; top: number };

  constructor(setup: SceneSetup) {
    this.show = new SandShow(setup.cols, setup.rows, setup.rng);
    this.show.box.setSolids(setup.solid);
    if (setup.icon) this.icon = { x0: setup.icon.x0, x1: setup.icon.x1, top: setup.icon.y0 };
  }

  /** Carries on from `old` after a resize instead of starting over. */
  carryFrom(old: SandscapeScene, setup: SceneSetup) {
    this.show.carryFrom(old.show);
    this.show.box.setSolids(setup.solid);
  }

  frame(dt: number, pointer: Pointer): FrameResult {
    const { show } = this;
    // The pointer stays out of the sand while the frame turns over.
    if (show.phase !== "turning") show.box.setCursor(pointer, this.arrow);
    const nod = show.frame(dt, this.icon);
    const t = show.turn;
    const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    return { nod, turn: show.phase === "turning" ? eased * 180 : 0 };
  }

  /**
   * The grains, lit: on top of a hill they catch the light, on a slope
   * facing left they're a little brighter and facing right a little
   * darker, so the hills read as dunes; inside, each grain's own shade
   * gives the layers a sandy texture. Grains falling through the liquid
   * are a little see-through, so the curtains look fine and soft.
   */
  draw(out: Uint8Array, opacity: Uint8Array) {
    const { cells, particles, cols, rows } = this.show.box;
    const open = (i: number) => {
      const v = cells[i]!;
      return v === EMPTY || v === CURSOR;
    };
    for (let i = 0; i < cells.length; i++) {
      const v = cells[i]!;
      if (v < GRAIN) {
        out[i] = 0;
        continue;
      }
      const x = i % cols;
      const y = (i - x) / cols;
      const held = (v & HELD) !== 0;
      const g = (v & ~HELD) - GRAIN;
      const slot = SAND_KINDS[Math.floor(g / SAND_SHADES)]!.slot;
      const shade = g % SAND_SHADES;
      const top = y > 0 && open(i - cols);
      const falling = !held && y < rows - 1 && open(i + cols);
      if (top && !held) out[i] = lit(slot, 0.32);
      else if (x > 0 && open(i - 1)) out[i] = lit(slot, 0.16);
      else if (x < cols - 1 && open(i + 1)) out[i] = shaded(slot, 0.22);
      else out[i] = shade < 2 ? shaded(slot, (2 - shade) * 0.09) : lit(slot, (shade - 1) * 0.07);
      if (falling) opacity[i] = 190;
    }
    for (const p of particles) {
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      if (x < 0 || x >= cols || y < 0 || y >= rows) continue;
      out[y * cols + x] = grainInk(p.v);
      opacity[y * cols + x] = 210;
    }
  }
}

/** A sand's colour lightened `t` of the way towards the palette's bright. */
function lit(slot: Slot, t: number): number {
  return slot === SLOT.bright ? ink(slot, 3) : blend(slot, SLOT.bright, t);
}

/** A sand's colour darkened `t` of the way towards the palette's dark. */
function shaded(slot: Slot, t: number): number {
  return slot === SLOT.dark ? ink(slot, t > 0.15 ? 0 : 1) : blend(slot, SLOT.dark, t);
}

function grainInk(v: number): number {
  const g = (v & ~HELD) - GRAIN;
  return ink(SAND_KINDS[Math.floor(g / SAND_SHADES)]!.slot, g % SAND_SHADES);
}
