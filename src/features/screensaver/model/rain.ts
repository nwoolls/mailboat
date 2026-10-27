import {
  blend,
  clamp,
  type FrameResult,
  ink,
  isSolid,
  type Pointer,
  type Scene,
  type SceneSetup,
  SLOT,
} from "./scene";

/**
 * Rain on the glass. Fine condensation fogs the pane; drops land, cling,
 * then slide down in fits, clearing a wet trail through the fog,
 * swallowing the beads in their way (and growing), and now and then
 * leaving a tiny bead behind. They pool on the icon box (which nods the
 * puddle off once it grows) and catch on the letters. The pointer wipes a
 * clear streak that fogs over again slowly.
 *
 * Drawn on 2px cells (see the catalog). Each drop looks like a lens: a
 * dark rim, a glint at its top left, light gathered at its bottom, and
 * see-through between; a sliding drop stretches into a teardrop.
 */

type Drop = {
  x: number;
  y: number;
  /** Radius in cells; below BEAD it's a bead of condensation. */
  r: number;
  vy: number;
  sliding: boolean;
  /** Seconds left before a resting drop dries up. */
  life: number;
  onIcon: boolean;
};

const MAX_BEADS = 900;
/** Drops smaller than this are beads: they never slide. */
const BEAD = 1.5;
/** The largest a drop grows by swallowing others. */
const MAX_R = 7.5;
const WIPE = 6;

export class RainScene implements Scene {
  readonly drops: Drop[] = [];
  /** Trail left by sliding drops, fading from 1. */
  private readonly trail: Float32Array;
  /** Where the pointer wiped, fading from 1; no fog forms there meanwhile. */
  private readonly wiped: Float32Array;
  /** How thick the fog is in each cell, a little uneven, fixed. */
  private readonly mist: Float32Array;
  private last: Pointer = null;
  private t = 0;
  private lastNod = -Infinity;

  constructor(private readonly s: SceneSetup) {
    this.trail = new Float32Array(s.cols * s.rows);
    this.wiped = new Float32Array(s.cols * s.rows);
    this.mist = new Float32Array(s.cols * s.rows);
    for (let i = 0; i < this.mist.length; i++) this.mist[i] = 0.75 + s.rng() * 0.5;
    for (let i = 0; i < MAX_BEADS / 2; i++) this.bead();
  }

  private bead(
    x = Math.floor(this.s.rng() * this.s.cols),
    y = Math.floor(this.s.rng() * this.s.rows),
  ) {
    const { s } = this;
    if (isSolid(s, x, y) || this.wiped[Math.round(y) * s.cols + Math.round(x)]! > 0.05) return;
    this.drops.push({
      x,
      y,
      r: 0.5 + s.rng() * 0.9,
      vy: 0,
      sliding: false,
      life: 20 + s.rng() * 30,
      onIcon: false,
    });
  }

  frame(dt: number, pointer: Pointer): FrameResult {
    const { s, drops } = this;
    const { cols, rows, rng } = s;
    this.t += dt;
    const beads = drops.reduce((n, d) => n + (d.r < BEAD ? 1 : 0), 0);
    if (beads < MAX_BEADS && rng() < dt * 90) this.bead();
    if (rng() < dt * 1.6) {
      const x = 4 + rng() * (cols - 8);
      const y = rng() * rows * 0.7;
      if (!isSolid(s, x, y))
        drops.push({
          x,
          y,
          r: 2.5 + rng() * 3,
          vy: 0,
          sliding: false,
          life: 30,
          onIcon: false,
        });
    }
    if (pointer) this.wipe(this.last ?? pointer, pointer);
    this.last = pointer;

    for (const d of drops) {
      if (d.r < BEAD || d.onIcon) {
        d.life -= dt;
        continue;
      }
      if (!d.sliding) {
        d.life -= dt;
        // Bigger drops let go sooner.
        if (rng() < dt * (d.r > 4.2 ? 0.7 : 0.18)) d.sliding = true;
        continue;
      }
      d.vy = Math.min(d.vy + dt * 45, 8 + d.r * 5.5);
      // Fits and starts: a sliding drop sometimes catches.
      if (rng() < dt * 0.6) {
        d.sliding = false;
        d.vy = 0;
        continue;
      }
      // It leaves some of itself behind, and stops when too small to slide.
      d.r -= dt * 0.08;
      if (d.r < 2.2) {
        d.sliding = false;
        d.vy = 0;
        continue;
      }
      const ny = d.y + d.vy * dt;
      const below = ny + d.r;
      if (isSolid(s, d.x, below)) {
        // Run off sideways if there's a way down beside, else settle.
        const side = rng() < 0.5 ? -1 : 1;
        if (!isSolid(s, d.x + side, below)) d.x += side;
        else if (!isSolid(s, d.x - side, below)) d.x -= side;
        else {
          d.sliding = false;
          d.vy = 0;
          d.onIcon = this.onIcon(d.x, below);
          d.life = 8 + rng() * 10;
        }
        continue;
      }
      // A wet trail as wide as most of the drop.
      const half = Math.max(0, Math.floor(d.r * 0.55));
      for (let y = Math.round(d.y - d.r); y <= Math.round(ny); y++)
        for (let x = Math.round(d.x) - half; x <= Math.round(d.x) + half; x++)
          if (y >= 0 && y < rows && x >= 0 && x < cols) this.trail[y * cols + x] = 1;
      if (rng() < dt * 1.5) this.bead(d.x + (rng() - 0.5) * d.r, d.y - d.r * 1.5);
      d.x += (rng() - 0.5) * 0.4;
      d.y = ny;
      // Swallow the smaller drops in the way, growing a little.
      for (const o of drops)
        if (
          o !== d &&
          o.life > 0 &&
          o.r < d.r &&
          Math.abs(o.x - d.x) <= d.r &&
          Math.abs(o.y - d.y) <= d.r * 1.3
        ) {
          o.life = 0;
          d.r = Math.min(MAX_R, Math.sqrt(d.r * d.r + o.r * o.r * 0.5));
        }
    }
    for (let i = 0; i < this.trail.length; i++) {
      if (this.trail[i]! > 0) this.trail[i] = Math.max(0, this.trail[i]! - dt / 5);
      if (this.wiped[i]! > 0) this.wiped[i] = Math.max(0, this.wiped[i]! - dt / 8);
    }
    const kept = drops.filter((d) => d.life > 0 && d.y < rows + 6);
    drops.length = 0;
    drops.push(...kept);
    return { nod: this.shedPuddle() };
  }

  private onIcon(x: number, y: number): boolean {
    const i = this.s.icon;
    return !!i && x >= i.x0 && x <= i.x1 && Math.abs(y - i.y0) <= 1;
  }

  /** A big enough puddle on the icon: nod, and it runs off both sides. */
  private shedPuddle(): boolean {
    const { icon } = this.s;
    if (!icon || this.t - this.lastNod < 4) return false;
    const puddle = this.drops.filter((d) => d.onIcon);
    if (puddle.reduce((n, d) => n + d.r, 0) < 9) return false;
    this.lastNod = this.t;
    const mid = (icon.x0 + icon.x1) / 2;
    for (const d of puddle) {
      d.onIcon = false;
      d.x = d.x < mid ? icon.x0 - d.r - 1 : icon.x1 + d.r + 1;
      d.sliding = true;
      d.vy = 9;
      d.life = 30;
    }
    return true;
  }

  /** Clears drops and trails along the pointer's path. */
  private wipe(a: { x: number; y: number }, b: { x: number; y: number }) {
    const { cols, rows } = this.s;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
    for (let k = 0; k <= steps; k++) {
      const px = a.x + ((b.x - a.x) * k) / steps;
      const py = a.y + ((b.y - a.y) * k) / steps;
      for (let y = Math.floor(py - WIPE); y <= py + WIPE; y++)
        for (let x = Math.floor(px - WIPE); x <= px + WIPE; x++) {
          if (x < 0 || x >= cols || y < 0 || y >= rows || Math.hypot(x - px, y - py) > WIPE)
            continue;
          this.trail[y * cols + x] = 0;
          this.wiped[y * cols + x] = 1;
        }
      for (const d of this.drops) if (Math.hypot(d.x - px, d.y - py) <= WIPE) d.life = 0;
    }
  }

  draw(out: Uint8Array, opacity: Uint8Array) {
    const { cols } = this.s;
    // The fog, thinned where a drop ran or the pointer wiped; a fresh
    // trail shows as a faint wet line.
    for (let i = 0; i < out.length; i++) {
      const trail = this.trail[i]!;
      const fog = (1 - Math.max(trail, this.wiped[i]!)) * this.mist[i]!;
      if (trail > 0.6) {
        out[i] = ink(SLOT.light);
        opacity[i] = Math.round((trail - 0.6) * 0.15 * 255);
      } else if (fog > 0.05) {
        out[i] = ink(SLOT.mid);
        opacity[i] = Math.round(fog * 0.1 * 255);
      } else out[i] = 0;
    }
    // Beads first, so drops sit over them.
    for (const d of this.drops) if (d.life > 0 && d.r < BEAD) this.drawBead(out, opacity, d);
    for (const d of this.drops) if (d.life > 0 && d.r >= BEAD) this.drawDrop(out, opacity, d, cols);
  }

  private drawBead(out: Uint8Array, opacity: Uint8Array, d: Drop) {
    const { cols, rows } = this.s;
    const x = Math.round(d.x);
    const y = Math.round(d.y);
    if (x < 0 || x >= cols || y < 0 || y >= rows) return;
    const i = y * cols + x;
    out[i] = ink(SLOT.light, d.r > 1.1 ? 2 : 0);
    opacity[i] = Math.round((0.08 + d.r * 0.14) * 255);
  }

  /**
   * A drop as a lens, cell by cell: the dark rim, the glint at its top
   * left, the light it gathers at its bottom, and the see-through middle.
   * Sliding, it stretches and narrows at the top into a teardrop.
   */
  private drawDrop(out: Uint8Array, opacity: Uint8Array, d: Drop, cols: number) {
    const { rows } = this.s;
    const rx = d.r;
    const ry = d.r * (d.sliding ? 1 + Math.min(0.45, d.vy / 50) : 0.92);
    for (let y = Math.floor(d.y - ry); y <= Math.ceil(d.y + ry); y++) {
      if (y < 0 || y >= rows) continue;
      const ny = (y - d.y) / ry;
      // Narrower towards the top when it's stretched.
      const wide = ny < 0 && d.sliding ? 1 + ny * 0.3 : 1;
      for (let x = Math.floor(d.x - rx); x <= Math.ceil(d.x + rx); x++) {
        if (x < 0 || x >= cols) continue;
        const nx = (x - d.x) / (rx * wide);
        const r = Math.hypot(nx, ny);
        if (r > 1) continue;
        const gx = nx + 0.35;
        const gy = ny + 0.42;
        let value: number;
        let a: number;
        if (gx * gx + gy * gy < 0.06 && d.r > 2) {
          value = ink(SLOT.bright, 3);
          a = 1;
        } else if (r > 0.76) {
          value = blend(SLOT.mid, SLOT.dark, (r - 0.76) / 0.24);
          a = 0.85;
        } else if (ny > 0.2 && r > 0.4) {
          value = blend(SLOT.light, SLOT.accent, 0.3);
          a = 0.45 + (ny - 0.2) * 0.5;
        } else {
          value = ink(SLOT.light);
          a = 0.16 + (ny + 1) * 0.08;
        }
        const i = y * cols + x;
        out[i] = value;
        opacity[i] = Math.round(clamp(a, 0, 1) * 255);
      }
    }
  }
}
