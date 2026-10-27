import {
  blend,
  clamp,
  type FrameResult,
  ink,
  type Pointer,
  type Rect,
  type Scene,
  type SceneSetup,
  SLOT,
  type Slot,
} from "./scene";

/**
 * Jellyfish (owner, 2026-10-27, after an ASCII-art jellyfish video). A few
 * swim up through the pond at different depths, the farther ones smaller,
 * fainter and slower. Each pulses: the bell contracts, narrower and
 * taller, pushing it up, then relaxes and drifts. Its tentacles trail
 * behind and ripple; frilly arms hang from the middle. The bell is
 * translucent, brighter at its edge like glass, with a faint accent glow
 * inside. The pointer startles one into a pulse away from it; they steer
 * round the icon and words, and one bumping the icon makes it nod.
 *
 * Drawn on 2px cells (see the catalog). Distances are in cells.
 */

type Point = { x: number; y: number };
type Jelly = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Which way it swims (radians; -π/2 is straight up), and its slow wander. */
  heading: number;
  wander: number;
  /** 0 near, 1 far: farther is smaller, fainter and slower. */
  depth: number;
  /** Where in its pulse it is (0 to 1), and how long a pulse takes. */
  pulse: number;
  period: number;
  /** The bell's colour, and its glow's. */
  body: Slot;
  glow: Slot;
  /** Each tentacle's points, root first; the root follows the rim. */
  tentacles: Point[][];
  /** The frilly arms' points, root first. */
  arms: Point[][];
  /** Its own phase for the tentacles' ripple. */
  phase: number;
};

const COUNT = 5;
/** The bell's half-width and height at the front, in cells. */
const BELL_W = 30;
const BELL_H = 26;
const TENTACLES = 11;
const TENTACLE_LINKS = 30;
/** Spacing of a tentacle's points at the front, in cells. */
const TENTACLE_LINK = 3;
const ARMS = 4;
const ARM_LINKS = 16;
const ARM_LINK = 2.6;

const LOOKS: [Slot, Slot][] = [
  [SLOT.light, SLOT.accent],
  [SLOT.bright, SLOT.accent],
  [SLOT.accent, SLOT.bright],
  [SLOT.light, SLOT.mid],
  [SLOT.bright, SLOT.accent],
];

/** How contracted the bell is (0 relaxed, 1 fully) at a point in its pulse: quick in, slow out. */
export function contraction(pulse: number): number {
  return pulse < 0.25 ? Math.sin((pulse / 0.25) * (Math.PI / 2)) : (1 - (pulse - 0.25) / 0.75) ** 2;
}

export class JellyfishScene implements Scene {
  readonly jellies: Jelly[] = [];
  private t = 0;
  private lastNod = -Infinity;

  constructor(private readonly s: SceneSetup) {
    const { cols, rows, rng } = s;
    for (let i = 0; i < COUNT; i++) {
      const depth = i / (COUNT - 1);
      const [body, glow] = LOOKS[i % LOOKS.length]!;
      const j: Jelly = {
        x: cols * (0.12 + rng() * 0.76),
        y: rows * (0.2 + rng() * 0.75),
        vx: 0,
        vy: 0,
        heading: -Math.PI / 2 + (rng() - 0.5) * 0.6,
        wander: 0,
        depth,
        pulse: rng(),
        period: 2.4 + rng() * 1.2 + depth * 0.8,
        body,
        glow,
        tentacles: [],
        arms: [],
        phase: rng() * Math.PI * 2,
      };
      this.hangLimbs(j);
      this.jellies.push(j);
    }
  }

  /** How big a jelly is at its depth (1 at the front). */
  private size(j: Jelly): number {
    const scale = clamp(Math.min(this.s.cols, this.s.rows) / 260, 0.55, 1);
    return scale * (1 - j.depth * 0.55);
  }

  /** Lets its tentacles and arms hang straight down from where it is. */
  private hangLimbs(j: Jelly) {
    const size = this.size(j);
    const w = BELL_W * size;
    j.tentacles = Array.from({ length: TENTACLES }, (_, i) => {
      const x = j.x + (i / (TENTACLES - 1) - 0.5) * 2 * w * 0.9;
      return Array.from({ length: TENTACLE_LINKS }, (__, k) => ({
        x,
        y: j.y + k * TENTACLE_LINK * size,
      }));
    });
    j.arms = Array.from({ length: ARMS }, (_, i) => {
      const x = j.x + (i / (ARMS - 1) - 0.5) * w * 0.5;
      return Array.from({ length: ARM_LINKS }, (__, k) => ({ x, y: j.y + k * ARM_LINK * size }));
    });
  }

  frame(dt: number, pointer: Pointer): FrameResult {
    const { cols, rows, rng, icon, words } = this.s;
    this.t += dt;
    let nod = false;
    for (const j of this.jellies) {
      const size = this.size(j);
      const w = BELL_W * size;
      const h = BELL_H * size;
      const before = j.pulse;
      j.pulse = (j.pulse + dt / j.period) % 1;
      // Wander a little either side of straight up; keep off the sides.
      j.wander = clamp(j.wander + (rng() - 0.5) * dt * 0.8, -0.5, 0.5);
      let want = -Math.PI / 2 + j.wander;
      if (j.x < w * 1.5) want += 0.5;
      if (j.x > cols - w * 1.5) want -= 0.5;
      // Steer round the icon and words.
      for (const box of [icon, words]) {
        if (!box || !near(box, j.x, j.y, w * 1.4)) continue;
        want += j.x < (box.x0 + box.x1) / 2 ? -0.7 : 0.7;
        if (box === icon && near(box, j.x, j.y, w * 0.6) && this.t - this.lastNod > 6) {
          this.lastNod = this.t;
          nod = true;
        }
      }
      // The pointer startles it: a pulse now, away from the pointer.
      if (pointer && Math.hypot(pointer.x - j.x, pointer.y - j.y) < w * 1.8) {
        want = Math.atan2(j.y - pointer.y, j.x - pointer.x);
        if (j.pulse > 0.4) j.pulse = 0;
      }
      let diff = want - j.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      j.heading += clamp(diff, -dt * 0.9, dt * 0.9);
      // Each pulse's contraction pushes it along its heading; then it drifts.
      const c = contraction(j.pulse);
      const thrust = j.pulse < 0.25 || j.pulse < before ? 26 * size : 0;
      j.vx += Math.cos(j.heading) * thrust * dt;
      j.vy += Math.sin(j.heading) * thrust * dt;
      const drag = Math.exp(-dt * 1.1);
      j.vx *= drag;
      j.vy = j.vy * drag + 1.2 * size * dt; // sinks a little between pulses
      j.x += j.vx * dt;
      j.y += j.vy * dt;
      // Gone off the top (tentacles and all): back in from below.
      if (j.y < -h - TENTACLE_LINKS * TENTACLE_LINK * size) {
        j.y = rows + h;
        j.x = cols * (0.12 + rng() * 0.76);
        this.hangLimbs(j);
      }
      if (j.y > rows + h * 3) j.y = rows + h;
      this.trail(j, c, size, dt);
    }
    return { nod };
  }

  /**
   * The tentacles and arms: each root follows its place on the rim, and
   * every point after follows the one before at a fixed spacing, sinking a
   * little and rippling side to side, so they trail as the jelly swims.
   */
  private trail(j: Jelly, c: number, size: number, dt: number) {
    const w = BELL_W * size * (1 - 0.2 * c);
    const tilt = j.heading + Math.PI / 2;
    const cos = Math.cos(tilt);
    const sin = Math.sin(tilt);
    const rim = (u: number, down: number) => ({
      x: j.x + u * cos - down * sin,
      y: j.y + u * sin + down * cos,
    });
    const follow = (chain: Point[], root: Point, link: number, ripple: number, i: number) => {
      chain[0]!.x = root.x;
      chain[0]!.y = root.y;
      for (let k = 1; k < chain.length; k++) {
        const a = chain[k - 1]!;
        const b = chain[k]!;
        // They hang, and a slow wave runs down them.
        b.y += 30 * size * dt;
        b.x += Math.sin(this.t * 1.4 + j.phase + i * 0.9 - k * 0.32) * ripple * size * dt;
        const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        b.x = a.x + ((b.x - a.x) / d) * link;
        b.y = a.y + ((b.y - a.y) / d) * link;
      }
    };
    j.tentacles.forEach((chain, i) =>
      follow(chain, rim((i / (TENTACLES - 1) - 0.5) * 2 * w * 0.9, 0), TENTACLE_LINK * size, 7, i),
    );
    j.arms.forEach((chain, i) =>
      follow(chain, rim((i / (ARMS - 1) - 0.5) * w * 0.5, -2 * size), ARM_LINK * size, 12, i + 3),
    );
  }

  draw(out: Uint8Array, opacity: Uint8Array) {
    out.fill(0);
    // Farthest first, so nearer jellies swim over them.
    const order = this.jellies.toSorted((a, b) => b.depth - a.depth);
    for (const j of order) this.drawJelly(out, opacity, j);
  }

  private put(out: Uint8Array, opacity: Uint8Array, x: number, y: number, v: number, a: number) {
    const { cols, rows } = this.s;
    const cx = Math.round(x);
    const cy = Math.round(y);
    if (cx < 0 || cx >= cols || cy < 0 || cy >= rows || a <= 0) return;
    out[cy * cols + cx] = v;
    opacity[cy * cols + cx] = Math.round(clamp(a, 0, 1) * 255);
  }

  private drawJelly(out: Uint8Array, opacity: Uint8Array, j: Jelly) {
    const size = this.size(j);
    const fade = 1 - j.depth * 0.6;
    const c = contraction(j.pulse);

    // Tentacles: thin, fading towards their tips.
    for (const chain of j.tentacles)
      for (let k = 1; k < chain.length; k++) {
        const a = chain[k - 1]!;
        const b = chain[k]!;
        const along = k / chain.length;
        for (let s = 0; s < 3; s++) {
          const t = s / 3;
          this.put(
            out,
            opacity,
            a.x + (b.x - a.x) * t,
            a.y + (b.y - a.y) * t,
            blend(j.body, SLOT.mid, along * 0.5),
            (0.75 - along * 0.6) * fade,
          );
        }
      }
    // The frilly arms: wider ribbons, tinted by the glow.
    for (const chain of j.arms)
      for (let k = 1; k < chain.length; k++) {
        const a = chain[k - 1]!;
        const b = chain[k]!;
        const along = k / chain.length;
        const wide = Math.max(1, Math.round((1 - along) * 2.5 * size + 0.5));
        for (let s = 0; s < 3; s++) {
          const t = s / 3;
          const x = a.x + (b.x - a.x) * t;
          const y = a.y + (b.y - a.y) * t;
          // Frills: the ribbon's width wavers along it.
          const frill = wide + (Math.sin(k * 1.7 + this.t * 3 + j.phase) > 0.3 ? 1 : 0);
          for (let dx = -frill; dx <= frill; dx++)
            this.put(
              out,
              opacity,
              x + dx,
              y,
              blend(j.body, j.glow, 0.15 + along * 0.15),
              (0.6 - along * 0.4 - Math.abs(dx) * 0.08) * fade,
            );
        }
      }

    // The bell: a dome over a scalloped rim, narrower and taller as it
    // contracts, tilted to its heading.
    const w = BELL_W * size * (1 - 0.2 * c);
    const h = BELL_H * size * (1 + 0.14 * c);
    const tilt = j.heading + Math.PI / 2;
    const cos = Math.cos(tilt);
    const sin = Math.sin(tilt);
    const reach = Math.ceil(Math.max(w, h) + 2);
    for (let dy = -reach; dy <= reach; dy++)
      for (let dx = -reach; dx <= reach; dx++) {
        // Into the bell's own frame: u across, v up from the rim.
        const u = (dx * cos + dy * sin) / w;
        const up = -(-dx * sin + dy * cos) / h;
        const scallop = 0.05 * Math.sin(u * Math.PI * 4 + j.phase) * (1 - c * 0.5);
        if (up < -0.08 + scallop || Math.abs(u) > 1) continue;
        const r = Math.hypot(u, Math.max(0, up));
        if (r > 1) continue;
        let v: number;
        let a: number;
        if (r > 0.86) {
          // Its edge, brighter, like glass seen side-on.
          v = blend(j.body, SLOT.bright, 0.4);
          a = 0.85;
        } else if (up < 0.1) {
          // The rim's underside, a thin darker band.
          v = blend(j.body, SLOT.mid, 0.3);
          a = 0.6;
        } else {
          // A curved highlight along the dome's upper left, and a soft
          // glow deep inside. (Rings and a round glint there looked like
          // eyes.)
          const highlight = r > 0.66 && r < 0.8 && u < -0.1 && up > 0.45;
          const core = Math.hypot(u / 0.55, (up - 0.38) / 0.4);
          if (highlight) {
            v = ink(SLOT.bright, 3);
            a = 0.55;
          } else if (core < 1) {
            v = blend(j.glow, j.body, 0.35 + core * 0.4);
            a = 0.18 + (1 - core) * 0.3;
          } else {
            // See-through inside, a little more solid towards the edge.
            v = blend(j.body, SLOT.bright, 0.1);
            a = 0.22 + r * r * 0.35;
          }
        }
        this.put(out, opacity, j.x + dx, j.y + dy, v, a * fade);
      }
  }
}

/** Whether (x, y) is within `pad` cells of the box. */
function near(box: Rect, x: number, y: number, pad: number): boolean {
  return x > box.x0 - pad && x < box.x1 + pad && y > box.y0 - pad && y < box.y1 + pad;
}
