import {
  blend,
  clamp,
  type FrameResult,
  ink,
  type Pointer,
  type Scene,
  type SceneSetup,
  SLOT,
} from "./scene";

/**
 * A starfield (owner, 2026-10-27): flying through space. Stars stream out
 * from a vanishing point behind the icon, growing and brightening as they
 * near, the nearest with a soft glow and, when fast, a streak. Far behind,
 * faint dust twinkles in place and a few very faint clouds of nebula
 * drift. Every so often it goes to warp: the speed surges for a few
 * seconds with long streaks (the icon nods as it starts), then eases back.
 * The pointer pulls the vanishing point towards it, like steering.
 *
 * Drawn on 2px cells (see the catalog).
 */

type Star = {
  /** Across and up from the line of flight, in units of the far plane. */
  x: number;
  y: number;
  /** How far away: 1 is the far plane, near 0 it passes by. */
  z: number;
  /** Where it was drawn last frame, for its streak (NaN when new). */
  px: number;
  py: number;
  /** 0 a white star, 1 tinted by the accent, 2 a dimmer grey one. */
  tint: number;
};
type Dust = { x: number; y: number; phase: number; rate: number; bright: number };
type Cloud = { x: number; y: number; r: number; accent: boolean; drift: number };

const STARS = 260;
const DUST = 220;
/** Cruising speed, in far planes per second: a star takes about 8 s to pass. */
const CRUISE = 0.12;
const WARP = 0.95;
/** Seconds of warp: ramping up, holding, easing down. */
const WARP_UP = 1.5;
const WARP_HOLD = 2.5;
const WARP_DOWN = 2.2;
const NEAR = 0.02;

export class StarfieldScene implements Scene {
  readonly stars: Star[] = [];
  readonly night = true;
  private readonly dust: Dust[] = [];
  private readonly clouds: Cloud[] = [];
  /** The vanishing point, in cells, easing towards where it's pulled. */
  private vx: number;
  private vy: number;
  private readonly home: { x: number; y: number };
  private t = 0;
  speed = CRUISE;
  /** Seconds into the current warp, or negative until the next. */
  private warp: number;

  constructor(private readonly s: SceneSetup) {
    const { cols, rows, rng, icon } = s;
    this.home = icon
      ? { x: (icon.x0 + icon.x1) / 2, y: (icon.y0 + icon.y1) / 2 }
      : { x: cols / 2, y: rows / 2 };
    this.vx = this.home.x;
    this.vy = this.home.y;
    this.warp = -(20 + rng() * 15);
    for (let i = 0; i < STARS; i++) {
      // Already on its way, somewhere it can be seen from where it is.
      const star = this.spawn();
      star.z = NEAR + rng() * (1 - NEAR);
      star.x *= star.z;
      star.y *= star.z;
      this.stars.push(star);
    }
    for (let i = 0; i < DUST; i++)
      this.dust.push({
        x: rng() * cols,
        y: rng() * rows,
        phase: rng() * Math.PI * 2,
        rate: 0.4 + rng() * 1.2,
        bright: rng(),
      });
    for (let i = 0; i < 3; i++)
      this.clouds.push({
        x: cols * (0.15 + rng() * 0.7),
        y: rows * (0.15 + rng() * 0.7),
        r: Math.min(cols, rows) * (0.25 + rng() * 0.2),
        accent: i !== 1,
        drift: (rng() - 0.5) * 0.6,
      });
  }

  /** The scale from the far plane to cells. */
  private get focal(): number {
    return Math.min(this.s.cols, this.s.rows) * 0.5;
  }

  /** A new star at the far plane, anywhere it would be seen. */
  private spawn(): Star {
    const { cols, rows, rng } = this.s;
    const f = this.focal;
    const r = rng();
    return {
      x: (rng() * 2 - 1) * (cols / f) * 0.52,
      y: (rng() * 2 - 1) * (rows / f) * 0.52,
      z: 1,
      px: Number.NaN,
      py: Number.NaN,
      tint: r < 0.16 ? 1 : r < 0.28 ? 2 : 0,
    };
  }

  /** Whether it's at warp now (for tests). */
  get warping(): boolean {
    return this.warp >= 0;
  }

  frame(dt: number, pointer: Pointer): FrameResult {
    const { cols, rows } = this.s;
    this.t += dt;
    let nod = false;
    // Warp: up, hold, down, then cruise until the next.
    const before = this.warp;
    this.warp += dt;
    if (before < 0 && this.warp >= 0) nod = true;
    const w = this.warp;
    let surge = 0;
    if (w >= 0) {
      if (w < WARP_UP) surge = (w / WARP_UP) ** 2;
      else if (w < WARP_UP + WARP_HOLD) surge = 1;
      else if (w < WARP_UP + WARP_HOLD + WARP_DOWN)
        surge = 1 - ((w - WARP_UP - WARP_HOLD) / WARP_DOWN) ** 0.5;
      else this.warp = -(35 + this.s.rng() * 25);
    }
    this.speed = CRUISE + (WARP - CRUISE) * surge;
    // The pointer pulls the vanishing point a third of the way to it.
    const tx = pointer ? this.home.x + (pointer.x - this.home.x) * 0.35 : this.home.x;
    const ty = pointer ? this.home.y + (pointer.y - this.home.y) * 0.35 : this.home.y;
    const f = this.focal;
    for (const star of this.stars) {
      // Where it was, for its streak.
      star.px = this.vx + (star.x / star.z) * f;
      star.py = this.vy + (star.y / star.z) * f;
      star.z -= this.speed * dt;
      const sx = this.vx + (star.x / star.z) * f;
      const sy = this.vy + (star.y / star.z) * f;
      const off = sx < -4 || sx > cols + 4 || sy < -4 || sy > rows + 4;
      if (star.z <= NEAR || off) Object.assign(star, this.spawn());
    }
    // Steering moves the vanishing point after the stars, so their streaks
    // swing with it.
    const ease = Math.min(1, dt * 1.5);
    this.vx += (tx - this.vx) * ease;
    this.vy += (ty - this.vy) * ease;
    for (const c of this.clouds) c.x += c.drift * dt;
    return { nod };
  }

  draw(out: Uint8Array, opacity: Uint8Array) {
    const { cols, rows } = this.s;
    out.fill(0);
    const put = (x: number, y: number, v: number, a: number) => {
      const cx = Math.round(x);
      const cy = Math.round(y);
      if (cx < 0 || cx >= cols || cy < 0 || cy >= rows || a <= 0.02) return;
      const i = cy * cols + cx;
      // Don't let a fainter thing cover a brighter one.
      if (out[i] && opacity[i]! / 255 > a) return;
      out[i] = v;
      opacity[i] = Math.round(clamp(a, 0, 1) * 255);
    };

    // The nebula: very faint, soft clouds.
    for (const c of this.clouds) {
      const x0 = Math.max(0, Math.floor(c.x - c.r));
      const x1 = Math.min(cols - 1, Math.ceil(c.x + c.r));
      const y0 = Math.max(0, Math.floor(c.y - c.r));
      const y1 = Math.min(rows - 1, Math.ceil(c.y + c.r));
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const d = Math.hypot(x - c.x, (y - c.y) * 1.4) / c.r;
          if (d >= 1) continue;
          const a = (1 - d * d) ** 2 * 0.09;
          const i = y * cols + x;
          if (out[i]) {
            // Where two overlap, the denser shows.
            if (opacity[i]! / 255 >= a) continue;
          }
          out[i] = c.accent ? blend(SLOT.accent, SLOT.dark, 0.3) : ink(SLOT.mid);
          opacity[i] = Math.round(a * 255);
        }
    }

    // Distant dust, twinkling in place, shifting a touch as it steers.
    const shiftX = (this.home.x - this.vx) * 0.05;
    const shiftY = (this.home.y - this.vy) * 0.05;
    for (const d of this.dust) {
      const tw = 0.5 + 0.5 * Math.sin(this.t * d.rate + d.phase);
      put(
        d.x + shiftX,
        d.y + shiftY,
        ink(d.bright > 0.7 ? SLOT.light : SLOT.mid),
        0.12 + tw * 0.32 * (0.5 + d.bright),
      );
    }

    // The stars, farthest first.
    const f = this.focal;
    const order = this.stars.toSorted((a, b) => b.z - a.z);
    // Streaks lengthen with speed, like a long exposure.
    const stretch = 1 + (this.speed - CRUISE) * 9;
    for (const star of order) {
      const sx = this.vx + (star.x / star.z) * f;
      const sy = this.vy + (star.y / star.z) * f;
      const near = 1 - star.z;
      // Faint far away; bright up close.
      const b = clamp(0.22 + near ** 1.25 * 0.9, 0, 1);
      const base =
        star.tint === 1
          ? blend(SLOT.bright, SLOT.accent, 0.55)
          : star.tint === 2
            ? ink(SLOT.light)
            : ink(SLOT.bright);
      const head = near > 0.8 ? ink(SLOT.bright, 3) : base;
      if (!Number.isNaN(star.px)) {
        const dx = (sx - star.px) * stretch;
        const dy = (sy - star.py) * stretch;
        const len = Math.hypot(dx, dy);
        if (len > 1.2) {
          const steps = Math.ceil(len);
          for (let k = 0; k < steps; k++) {
            const t = k / steps;
            put(sx - dx * (1 - t), sy - dy * (1 - t), base, b * t * 0.85);
          }
        }
      }
      put(sx, sy, head, b);
      // The nearest stars glow.
      if (star.z < 0.3) {
        const g = b * (0.3 - star.z) * 2;
        for (const [ox, oy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const)
          put(sx + ox, sy + oy, base, g);
        if (star.z < 0.14)
          for (const [ox, oy] of [
            [1, 1],
            [-1, 1],
            [1, -1],
            [-1, -1],
            [2, 0],
            [-2, 0],
            [0, 2],
            [0, -2],
          ] as const)
            put(sx + ox, sy + oy, base, g * 0.45);
      }
    }
  }
}
