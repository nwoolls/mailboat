import {
  type FrameResult,
  ink,
  isSolid,
  plot,
  type Pointer,
  type Scene,
  type SceneSetup,
  SLOT,
} from "./scene";

/**
 * Rain on the glass. Fine condensation fogs the pane; drops land, cling,
 * then slide down in fits, leaving a trail and swallowing the beads in
 * their way. They pool on the icon box (which nods the puddle off once it
 * grows) and catch on the letters. The pointer wipes a clear streak that
 * fogs over again slowly.
 */

type Drop = {
  x: number;
  y: number;
  /** 0 a bead of condensation, 1 a drop, 2 a big drop. */
  size: number;
  vy: number;
  sliding: boolean;
  /** Seconds left before a resting drop dries up. */
  life: number;
  onIcon: boolean;
};

const MAX_BEADS = 420;
const WIPE = 4;

export class RainScene implements Scene {
  readonly drops: Drop[] = [];
  /** Trail left by sliding drops, fading from 1. */
  private readonly trail: Float32Array;
  /** Where the pointer wiped, fading from 1; no fog forms there meanwhile. */
  private readonly wiped: Float32Array;
  private last: Pointer = null;
  private t = 0;
  private lastNod = -Infinity;

  constructor(private readonly s: SceneSetup) {
    this.trail = new Float32Array(s.cols * s.rows);
    this.wiped = new Float32Array(s.cols * s.rows);
    for (let i = 0; i < MAX_BEADS / 2; i++) this.bead();
  }

  private bead() {
    const { s } = this;
    const x = Math.floor(s.rng() * s.cols);
    const y = Math.floor(s.rng() * s.rows);
    if (isSolid(s, x, y) || this.wiped[y * s.cols + x]! > 0.05) return;
    this.drops.push({
      x,
      y,
      size: 0,
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
    const beads = drops.reduce((n, d) => n + (d.size === 0 ? 1 : 0), 0);
    if (beads < MAX_BEADS && rng() < dt * 40) this.bead();
    if (rng() < dt * 1.6) {
      const x = 2 + rng() * (cols - 4);
      const y = rng() * rows * 0.7;
      if (!isSolid(s, x, y))
        drops.push({
          x,
          y,
          size: rng() < 0.4 ? 2 : 1,
          vy: 0,
          sliding: false,
          life: 30,
          onIcon: false,
        });
    }
    if (pointer) this.wipe(this.last ?? pointer, pointer);
    this.last = pointer;

    for (const d of drops) {
      if (d.size === 0 || d.onIcon) {
        d.life -= dt;
        continue;
      }
      if (!d.sliding) {
        d.life -= dt;
        // Bigger drops let go sooner.
        if (rng() < dt * (d.size === 2 ? 0.7 : 0.18)) d.sliding = true;
        continue;
      }
      d.vy = Math.min(d.vy + dt * 30, d.size === 2 ? 26 : 16);
      // Fits and starts: a sliding drop sometimes catches.
      if (rng() < dt * 0.6) {
        d.sliding = false;
        d.vy = 0;
        continue;
      }
      const ny = d.y + d.vy * dt;
      const below = ny + d.size;
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
      for (let y = Math.round(d.y); y <= Math.round(ny); y++)
        if (y >= 0 && y < rows) this.trail[y * cols + Math.round(d.x)] = 1;
      d.x += (rng() - 0.5) * 0.3;
      d.y = ny;
      // Swallow beads in the way.
      for (const o of drops)
        if (
          o.size === 0 &&
          o.life > 0 &&
          Math.abs(o.x - d.x) <= d.size &&
          Math.abs(o.y - d.y) <= d.size
        )
          o.life = 0;
    }
    for (let i = 0; i < this.trail.length; i++) {
      if (this.trail[i]! > 0) this.trail[i] = Math.max(0, this.trail[i]! - dt / 3);
      if (this.wiped[i]! > 0) this.wiped[i] = Math.max(0, this.wiped[i]! - dt / 8);
    }
    const kept = drops.filter((d) => d.life > 0 && d.y < rows + 2);
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
    if (puddle.reduce((n, d) => n + d.size, 0) < 6) return false;
    this.lastNod = this.t;
    const mid = (icon.x0 + icon.x1) / 2;
    for (const d of puddle) {
      d.onIcon = false;
      d.x = d.x < mid ? icon.x0 - 2 : icon.x1 + 2;
      d.sliding = true;
      d.vy = 6;
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

  draw(out: Uint8Array) {
    const { cols, rows } = this.s;
    for (let i = 0; i < out.length; i++) out[i] = this.trail[i]! > 0.25 ? ink(SLOT.dark, 1) : 0;
    for (const d of this.drops) {
      if (d.life <= 0) continue;
      const { x, y } = d;
      if (d.size === 0) plot(out, cols, rows, x, y, ink(SLOT.mid, 0));
      else if (d.size === 1) {
        for (const [dx, dy] of [
          [0, -1],
          [-1, 0],
          [1, 0],
          [0, 1],
        ] as const)
          plot(out, cols, rows, x + dx, y + dy, ink(SLOT.light));
        plot(out, cols, rows, x, y, ink(SLOT.bright));
      } else {
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++) {
            if (Math.abs(dx) + Math.abs(dy) > 3) continue;
            const v = dy === 2 || dx === 2 ? ink(SLOT.mid) : ink(SLOT.light);
            plot(out, cols, rows, x + dx, y + dy, v);
          }
        plot(out, cols, rows, x - 1, y - 1, ink(SLOT.bright, 3));
        plot(out, cols, rows, x, y - 1, ink(SLOT.accent, 3));
      }
    }
  }
}
