import { blend, ink, type Rect, SLOT } from "../../screensaver/model/scene";

/**
 * The Pond toy in pixel art (UX Spike 4), on a grid of cells like the
 * screensavers and coloured by their palette. A click drops a stone: a
 * bright plop and a crown of droplets thrown up, each making a small
 * disturbance where it falls back.
 *
 * The water is simulated (the wave equation on a grid), so the rings
 * behave as water does: they reflect off the edges of the area and off
 * the icon and each line of the words, bend round them, and add up where
 * they cross (owner, 2026-10-27: "have the ripples interact with the
 * edges of the area realistically, and maybe with the icon and text").
 * The surface is lit from the top left: crests catch the light, troughs
 * darken. The simulation's rows are taller than the screen's, so rings
 * come out flattened, as water seen at an angle. It only runs while the
 * water moves, then clears.
 */

type Droplet = { x: number; y: number; vx: number; vy: number; ground: number };
type Plop = { x: number; y: number; age: number };

/** How long a stone's plop lasts, in seconds. */
export /** Seen at an angle: the water is drawn this much as tall as it is wide. */
const FLAT = 0.62;
/** Simulation steps per second, and the waves' speed (cells per step, squared; over 0.5 blows up). */
const STEPS_PER_SECOND = 240;
const SPEED = 0.3;
/** How much of its motion the water keeps each step: calm in about three seconds. */
const DAMPING = 0.988;
/** Below this everywhere, the water is calm. */
const CALM = 0.012;
/** A stone's push, and how wide its splash is, in cells. */
const STONE = 6.4;
const STONE_RADIUS = 5;
const GRAVITY = 140;
/** How long a stone's plop lasts, in seconds. */
export const PLOP_SECONDS = 0.25;
/**
 * The pointer stirring the water as it moves over it (owner, 2026-11-13:
 * "extremely subtle ripples that follow the mouse, but clicking still
 * disturbs the water more"). Off when `stirDepth` is 0. Shared by pixel
 * and ASCII art, since the water is the same; the playground can dial it.
 */
export type PondStir = {
  /** How deep each stir pushes, at full speed (a stone is 6.4). 0 is off. */
  stirDepth: number;
  /** How wide each stir is, in cells (2px each). */
  stirRadius: number;
  /** How far the pointer moves between stirs, in cells. */
  stirEvery: number;
  /** Pointer speed, in cells per second, that stirs at full depth. */
  stirFullSpeed: number;
};

export const POND_STIR_DEFAULTS: PondStir = {
  // Tried in the playground and chosen by the owner (2026-11-13).
  stirDepth: 0.6,
  stirRadius: 2.2,
  stirEvery: 6,
  stirFullSpeed: 400,
};

let stirTuning: PondStir = POND_STIR_DEFAULTS;

/** How the pointer stirs the pond; the defaults unless the playground changed it. */
export function pondStir(): PondStir {
  return stirTuning;
}

/** For the playground only. */
export function setPondStir(next: PondStir) {
  stirTuning = next;
}

/** Calm by now at the latest, however it was disturbed (for tests). */
export const SETTLE_SECONDS = 4;

export class PondToy {
  /** The simulation's size: as wide as the screen, taller by 1 / FLAT. */
  private readonly w: number;
  private readonly h: number;
  private now: Float32Array;
  private before: Float32Array;
  /** 1 where the icon or a line of the words stands in the water. */
  private readonly solid: Uint8Array;
  readonly droplets: Droplet[] = [];
  readonly plops: Plop[] = [];
  private owed = 0;
  private moving = false;

  constructor(
    readonly cols: number,
    readonly rows: number,
    private readonly rng: () => number = Math.random,
  ) {
    this.w = cols;
    this.h = Math.max(1, Math.ceil(rows / FLAT));
    this.now = new Float32Array(this.w * this.h);
    this.before = new Float32Array(this.w * this.h);
    this.solid = new Uint8Array(this.w * this.h);
  }

  /** What stands in the water (boxes in screen cells): waves reflect off them. */
  setSolids(boxes: Rect[]) {
    const { w, h, solid } = this;
    solid.fill(0);
    for (const b of boxes)
      for (
        let y = Math.max(0, Math.floor(b.y0 / FLAT));
        y <= Math.min(h - 1, Math.ceil(b.y1 / FLAT));
        y++
      )
        for (let x = Math.max(0, Math.floor(b.x0)); x <= Math.min(w - 1, Math.ceil(b.x1)); x++)
          solid[y * w + x] = 1;
  }

  /** A stone dropped at (x, y), in screen cells. */
  drop(x: number, y: number) {
    const { rng } = this;
    this.push(x, y, STONE, STONE_RADIUS);
    this.plops.push({ x, y, age: 0 });
    // The crown: droplets thrown up and out, landing near where they rose.
    const n = 9 + Math.floor(rng() * 5);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + rng() * 0.4;
      const out = 6 + rng() * 10;
      this.droplets.push({
        x,
        y,
        vx: Math.cos(a) * out * 2.2,
        vy: -(28 + rng() * 26),
        ground: y + Math.sin(a) * out * FLAT,
      });
    }
    if (this.droplets.length > 80) this.droplets.splice(0, this.droplets.length - 80);
  }

  /**
   * The pointer passing over (x, y) in screen cells at `speed` cells per
   * second: a faint dip, deeper the faster it moves, up to `stirDepth`.
   */
  stir(x: number, y: number, speed: number, t: PondStir = stirTuning) {
    if (t.stirDepth <= 0) return;
    const depth = t.stirDepth * Math.min(1, speed / t.stirFullSpeed);
    if (depth > 0.01) this.push(x, y, depth, t.stirRadius);
  }

  /** Pushes the water down in a soft round dip at (x, y) in screen cells. */
  private push(x: number, y: number, depth: number, radius: number) {
    const { w, h, now, before, solid } = this;
    const sx = x;
    const sy = y / FLAT;
    for (let yy = Math.floor(sy - radius * 2); yy <= sy + radius * 2; yy++)
      for (let xx = Math.floor(sx - radius * 2); xx <= sx + radius * 2; xx++) {
        if (xx < 1 || xx >= w - 1 || yy < 1 || yy >= h - 1) continue;
        const i = yy * w + xx;
        if (solid[i]) continue;
        const d2 = ((xx - sx) ** 2 + (yy - sy) ** 2) / (radius * radius);
        const dip = -depth * Math.exp(-d2);
        // Clamped, so rapid clicking can't pile up without end.
        now[i] = Math.max(-12, now[i]! + dip);
        before[i] = Math.max(-12, before[i]! + dip);
      }
    this.moving = true;
  }

  /** Whether anything is still moving. */
  get active(): boolean {
    return this.moving || this.droplets.length > 0 || this.plops.length > 0;
  }

  frame(dt: number) {
    for (const p of this.plops) p.age += dt;
    for (const d of this.droplets) {
      d.vy += GRAVITY * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      // Back in the water: a small disturbance of its own.
      if (d.vy > 0 && d.y >= d.ground) this.push(d.x, d.ground, 1.6, 1.6);
    }
    prune(this.plops, (p) => p.age < PLOP_SECONDS);
    prune(this.droplets, (d) => !(d.vy > 0 && d.y >= d.ground));
    if (!this.moving) return;
    this.owed += dt * STEPS_PER_SECOND;
    let biggest = 0;
    while (this.owed >= 1) {
      this.owed--;
      biggest = this.step();
    }
    if (biggest > 0 && biggest < CALM) {
      this.now.fill(0);
      this.before.fill(0);
      this.moving = false;
    }
  }

  /**
   * One step of the wave equation. The area's edges and anything solid
   * hold the water still, so waves reflect off them. Returns the largest
   * movement anywhere.
   */
  private step(): number {
    const { w, h, now, before, solid } = this;
    let biggest = 0;
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (solid[i]) {
          before[i] = 0;
          continue;
        }
        const lap = now[i - 1]! + now[i + 1]! + now[i - w]! + now[i + w]! - 4 * now[i]!;
        const next = (2 * now[i]! - before[i]! + SPEED * lap) * DAMPING;
        before[i] = next;
        const a = Math.abs(next);
        if (a > biggest) biggest = a;
      }
    // `before` now holds the newest; swap so `now` does.
    this.before = now;
    this.now = before;
    return biggest;
  }

  /**
   * How the surface catches the light at (x, y) in screen cells: negative
   * on a slope facing the light (top left, bright), positive facing away
   * (dark), 0 on still water. Measured over two cells, which smooths the
   * grid's finest ripples (a grainy wake behind each wave front).
   */
  shading(x: number, y: number): number {
    const { cols, w, h, now } = this;
    if (!this.moving) return 0;
    const xi = Math.round(x);
    if (xi < 1 || xi >= cols - 1) return 0;
    // Between two of the simulation's rows, blended (picking the nearest
    // one drew in streaks).
    const fy = Math.min(h - 3, Math.max(1, y / FLAT));
    const sy = Math.floor(fy);
    const t = fy - sy;
    const at = (xx: number, yy: number) =>
      now[yy * w + xx]! * (1 - t) + now[(yy + 1) * w + xx]! * t;
    const x0 = Math.max(0, xi - 2);
    const x1 = Math.min(cols - 1, xi + 2);
    const y0 = Math.max(0, sy - 2);
    const y1 = Math.min(h - 2, sy + 2);
    return (at(x0, sy) - at(x1, sy) + (at(xi, y0) - at(xi, y1))) * 0.5;
  }

  draw(out: Uint8Array, opacity: Uint8Array) {
    const { cols, rows } = this;
    out.fill(0);
    if (this.moving)
      for (let y = 0; y < rows; y++) {
        for (let x = 1; x < cols - 1; x++) {
          // Lit from the top left: slopes facing it are bright, facing away dark.
          const slope = this.shading(x, y);
          if (Math.abs(slope) < 0.03) continue;
          const j = y * cols + x;
          out[j] = slope < 0 ? blend(SLOT.accent, SLOT.bright, 0.25) : ink(SLOT.dark);
          opacity[j] = Math.round(Math.min(1, Math.abs(slope) * (slope < 0 ? 3.2 : 2.2)) * 255);
        }
      }
    // The plop: a bright flattened splash, fading quickly.
    for (const p of this.plops) {
      const fade = 1 - p.age / PLOP_SECONDS;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -4; dx <= 4; dx++) {
          if (Math.hypot(dx / 4, dy / 2) > 1) continue;
          put(out, opacity, cols, rows, p.x + dx, p.y + dy, ink(SLOT.bright, 3), fade * 0.9);
        }
    }
    // Droplets: a bright bead, and a short streak behind it.
    for (const d of this.droplets) {
      put(out, opacity, cols, rows, d.x, d.y, ink(SLOT.bright, 3), 0.95);
      put(
        out,
        opacity,
        cols,
        rows,
        d.x - d.vx * 0.02,
        d.y - d.vy * 0.02,
        blend(SLOT.accent, SLOT.bright, 0.5),
        0.5,
      );
    }
  }

  /** The water's height at (x, y) in screen cells (for tests). */
  heightAt(x: number, y: number): number {
    const sy = Math.min(this.h - 1, Math.max(0, Math.round(y / FLAT)));
    return this.now[sy * this.w + Math.round(x)] ?? 0;
  }
}

function put(
  out: Uint8Array,
  opacity: Uint8Array,
  cols: number,
  rows: number,
  x: number,
  y: number,
  v: number,
  a: number,
) {
  const cx = Math.round(x);
  const cy = Math.round(y);
  if (cx < 0 || cx >= cols || cy < 0 || cy >= rows || a <= 0) return;
  out[cy * cols + cx] = v;
  opacity[cy * cols + cx] = Math.round(Math.min(1, a) * 255);
}

/** Keeps only the items that pass, in place. */
function prune<T>(items: T[], keep: (item: T) => boolean) {
  let n = 0;
  for (const item of items) if (keep(item)) items[n++] = item;
  items.length = n;
}
