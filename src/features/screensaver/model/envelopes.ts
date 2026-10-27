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
 * A flock of pixel envelopes. They fly together (separation, alignment,
 * cohesion), scatter from the pointer, and now and then land along the top
 * of the icon box or the words; enough on the icon and it nods them off.
 * Once in a while one unfolds into a paper plane and glides away, to
 * come back as an envelope later.
 *
 * Drawn on a finer grid than the other scenes (2px cells, `cellPx` in the
 * catalog): at 3px cells and 7×5 envelopes the owner found it jumpy and
 * low-res (2026-10-21). Distances and speeds below are in cells, so
 * they're 1.5× what they were at 3px.
 *
 * Each envelope is drawn, not a fixed picture (UX Spike 4): shaded paper
 * with its back seams, a flap that opens and closes smoothly with each
 * wingbeat, a wax seal on the accent ones, and a soft shadow below.
 * Envelopes farther back are smaller and see-through; one coming in to
 * land moves to the front. A paper plane has a lit and a shaded wing and
 * leaves a fading trail.
 */

type Mode = "fly" | "land" | "perched" | "plane" | "away";
type Bird = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  mode: Mode;
  /** Seconds left perched, or away before coming back. */
  wait: number;
  perch: number;
  accent: boolean;
  /** Where in its wingbeat it is, so each keeps its own steady rhythm. */
  phase: number;
  /** How far back it flies (0 front, 1 back), and how far it is now: it comes to the front to land. */
  far: number;
  depth: number;
};

const COUNT = 8;
const SPEED = 39;
const NEAR = 40;
/** Wider than an envelope, so they don't overlap. */
const APART = 30;
const SCARE = 32;
/** Wingbeats (flap down and up) per second. */
const FLAPS = 3;
/** An envelope's size in cells at the front of the flock. */
const ENV_W = 27;
const ENV_H = 18;
/** How far down the envelope the side flaps' V reaches, as a share of its height. */
const V_DEPTH = 0.55;
/** A paper plane's length and height in cells. */
const PLANE_L = 28;
const PLANE_H = 13;

export class EnvelopeScene implements Scene {
  private readonly birds: Bird[] = [];
  private readonly perches: { x: number; y: number; onIcon: boolean; taken: number }[] = [];
  private t = 0;
  private lastNod = -Infinity;

  constructor(private readonly s: SceneSetup) {
    const { cols, rows, rng } = s;
    for (const [r, onIcon] of [
      [s.icon, true],
      [s.words, false],
    ] as const) {
      if (!r) continue;
      for (let x = r.x0 + 12; x <= r.x1 - 12; x += 29)
        this.perches.push({ x, y: r.y0 - 1, onIcon, taken: -1 });
    }
    for (let i = 0; i < COUNT; i++) {
      const a = rng() * Math.PI * 2;
      this.birds.push({
        x: cols * (0.2 + rng() * 0.6),
        y: rows * (0.15 + rng() * 0.3),
        vx: Math.cos(a) * SPEED,
        vy: Math.sin(a) * SPEED * 0.5,
        mode: "fly",
        wait: 0,
        perch: -1,
        accent: i % 5 === 0,
        phase: rng(),
        far: rng(),
        depth: 0,
      });
    }
  }

  frame(dt: number, pointer: Pointer): FrameResult {
    const { s } = this;
    const { cols, rows, rng } = s;
    this.t += dt;
    for (let i = 0; i < this.birds.length; i++) {
      const b = this.birds[i]!;
      const towards = b.mode === "land" || b.mode === "perched" ? 0 : b.far;
      b.depth += (towards - b.depth) * Math.min(1, dt * 1.5);
      const scared =
        pointer !== null && Math.hypot(b.x - pointer.x, b.y - ENV_H / 2 - pointer.y) < SCARE;
      if (b.mode === "perched") {
        b.wait -= dt;
        if (b.wait <= 0 || scared) this.takeOff(b, rng);
        continue;
      }
      if (b.mode === "away") {
        if ((b.wait -= dt) <= 0) {
          const left = rng() < 0.5;
          Object.assign(b, {
            mode: "fly",
            x: left ? -ENV_W : cols + ENV_W,
            y: rows * (0.1 + rng() * 0.4),
          });
          b.vx = left ? SPEED : -SPEED;
          b.vy = 0;
        }
        continue;
      }
      if (b.mode === "plane") {
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        if (b.x < -PLANE_L * 1.5 || b.x > cols + PLANE_L * 1.5 || b.y > rows + PLANE_H) {
          b.mode = "away";
          b.wait = 4 + rng() * 6;
        }
        continue;
      }
      let ax = 0;
      let ay = 0;
      if (b.mode === "land") {
        const p = this.perches[b.perch]!;
        const dx = p.x - b.x;
        const dy = p.y - b.y;
        const d = Math.hypot(dx, dy);
        if (scared) this.takeOff(b, rng);
        else if (d < 1.8) {
          Object.assign(b, { mode: "perched", x: p.x, y: p.y, vx: 0, vy: 0, wait: 3 + rng() * 7 });
          continue;
        } else {
          // Arrive: aim for a speed that falls off near the perch.
          const want = Math.min(SPEED, d * 2.5);
          ax += ((dx / d) * want - b.vx) * 3;
          ay += ((dy / d) * want - b.vy) * 3;
        }
      }
      if (b.mode === "fly") {
        let n = 0;
        let cx = 0;
        let cy = 0;
        let mx = 0;
        let my = 0;
        for (const o of this.birds) {
          if (o === b || o.mode !== "fly") continue;
          const dx = o.x - b.x;
          const dy = o.y - b.y;
          const d = Math.hypot(dx, dy);
          if (d > NEAR) continue;
          n++;
          cx += o.x;
          cy += o.y;
          mx += o.vx;
          my += o.vy;
          if (d < APART && d > 0) {
            ax -= (dx / d) * (APART - d) * 8;
            ay -= (dy / d) * (APART - d) * 8;
          }
        }
        if (n) {
          ax += (cx / n - b.x) * 0.8 + (mx / n - b.vx) * 0.9;
          ay += (cy / n - b.y) * 0.8 + (my / n - b.vy) * 0.9;
        }
        // Wander, and keep to the upper part of the area, off the edges.
        ax += (rng() - 0.5) * 45;
        ay += (rng() - 0.5) * 45;
        const margin = 15;
        if (b.x < margin) ax += (margin - b.x) * 6;
        if (b.x > cols - margin) ax -= (b.x - cols + margin) * 6;
        if (b.y < margin) ay += (margin - b.y) * 6;
        if (b.y > rows * 0.8) ay -= (b.y - rows * 0.8) * 6;
        if (scared && pointer) {
          const dx = b.x - pointer.x;
          const dy = b.y - pointer.y;
          const d = Math.max(1, Math.hypot(dx, dy));
          ax += (dx / d) * 390;
          ay += (dy / d) * 390;
        }
        if (rng() < 0.05 * dt) this.seekPerch(b, i, rng);
        else if (rng() < 0.012 * dt) {
          b.mode = "plane";
          b.vx = b.vx >= 0 ? 51 : -51;
          b.vy = 7.5;
          continue;
        }
      }
      b.vx += ax * dt;
      b.vy += ay * dt;
      const sp = Math.hypot(b.vx, b.vy);
      const max = scared ? SPEED * 1.8 : SPEED;
      if (sp > max) {
        b.vx *= max / sp;
        b.vy *= max / sp;
      }
      b.x = clamp(b.x + b.vx * dt, -9, cols + 9);
      b.y = clamp(b.y + b.vy * dt, 8, rows - 1);
    }
    return { nod: this.crowdedIcon() };
  }

  private seekPerch(b: Bird, i: number, rng: () => number) {
    const free = this.perches.map((p, k) => (p.taken < 0 ? k : -1)).filter((k) => k >= 0);
    if (!free.length) return;
    const k = free[Math.floor(rng() * free.length)]!;
    this.perches[k]!.taken = i;
    b.perch = k;
    b.mode = "land";
  }

  private takeOff(b: Bird, rng: () => number) {
    if (b.perch >= 0) this.perches[b.perch]!.taken = -1;
    b.perch = -1;
    b.mode = "fly";
    b.vx = (rng() - 0.5) * SPEED * 2;
    b.vy = -SPEED * (0.8 + rng() * 0.4);
    b.y -= 1;
  }

  /** Three or more on the icon: it nods and they all take off. */
  private crowdedIcon(): boolean {
    if (this.t - this.lastNod < 5) return false;
    const on = this.birds.filter(
      (b) => b.mode === "perched" && this.perches[b.perch]?.onIcon === true,
    );
    if (on.length < 3) return false;
    this.lastNod = this.t;
    for (const b of on) this.takeOff(b, this.s.rng);
    return true;
  }

  /** How many are sitting on a perch (for tests). */
  get perched(): number {
    return this.birds.filter((b) => b.mode === "perched").length;
  }

  draw(out: Uint8Array, opacity: Uint8Array) {
    out.fill(0);
    const shown = this.birds.filter((b) => b.mode !== "away");
    // Shadows first, under everything, then the farthest envelopes first.
    for (const b of shown) if (b.mode !== "plane") this.drawShadow(out, opacity, b);
    shown.sort((a, b) => b.depth - a.depth);
    for (const b of shown) {
      if (b.mode === "plane") this.drawPlane(out, opacity, b);
      else this.drawEnvelope(out, opacity, b);
    }
  }

  /** How big (1 at the front) and how solid (0 to 255) a bird is at its depth. */
  private look(b: Bird) {
    return { scale: 1 - b.depth * 0.32, alpha: Math.round(255 * (1 - b.depth * 0.5)) };
  }

  private put(out: Uint8Array, opacity: Uint8Array, x: number, y: number, v: number, a: number) {
    const { cols, rows } = this.s;
    if (x < 0 || x >= cols || y < 0 || y >= rows) return;
    out[y * cols + x] = v;
    opacity[y * cols + x] = a;
  }

  /** A soft shadow, down and to the right; farther when flying than perched. */
  private drawShadow(out: Uint8Array, opacity: Uint8Array, b: Bird) {
    const { scale, alpha } = this.look(b);
    const w = Math.round(ENV_W * scale);
    const h = Math.round(ENV_H * scale);
    const lift = b.mode === "perched" ? 1 : 4;
    const x0 = Math.round(b.x - w / 2) + lift;
    const y0 = Math.round(b.y) - h + 1 + lift;
    for (let y = -1; y <= h; y++)
      for (let x = -1; x <= w; x++) {
        // Softer at its edge.
        const edge = x < 0 || y < 0 || x === w || y === h;
        this.put(
          out,
          opacity,
          x0 + x,
          y0 + y,
          ink(SLOT.dark),
          Math.round(alpha * (edge ? 0.07 : 0.15)),
        );
      }
  }

  private drawEnvelope(out: Uint8Array, opacity: Uint8Array, b: Bird) {
    const { scale, alpha } = this.look(b);
    const w = Math.round(ENV_W * scale);
    const h = Math.round(ENV_H * scale);
    const x0 = Math.round(b.x - w / 2);
    const y0 = Math.round(b.y) - h + 1;
    const mid = (w - 1) / 2;
    // The flap is its wing: its tip swings from folded down over the back
    // (closed, as when perched) to standing up above the envelope (open).
    const beat =
      b.mode === "perched" ? 1 : 0.5 + 0.5 * Math.cos((this.t * FLAPS + b.phase) * Math.PI * 2);
    const tip = -h * 0.75 + beat * h * 1.33;
    const edge = b.accent ? SLOT.accent : SLOT.mid;
    const corner = (x: number, y: number) => (x === 0 || x === w - 1) && (y === 0 || y === h - 1);

    // Open: the flap's inside, standing above the envelope.
    if (tip < 0) {
      for (let y = Math.floor(tip); y < 0; y++)
        for (let x = 0; x < w; x++) {
          const across = Math.abs(x - mid) / mid;
          const top = tip * (1 - across);
          if (y < top) continue;
          const rim = y < top + 1 || x === 0 || x === w - 1;
          this.put(
            out,
            opacity,
            x0 + x,
            y0 + y,
            rim ? ink(edge) : blend(SLOT.light, SLOT.mid, 0.3),
            alpha,
          );
        }
    }

    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (corner(x, y)) continue;
        const across = Math.abs(x - mid) / mid; // 0 centre, 1 sides
        const flapAt = Math.max(0, tip) * (1 - across); // the flap's lower edge, while it covers the back
        // The side flaps rise from the top corners to meet in a V; above it
        // is the opening, which the flap covers when closed. The bottom
        // flap's seams rise from the bottom corners.
        const vAt = V_DEPTH * h * (1 - across);
        const seamAt = h - 1 - (1 - across) * h * 0.45;
        // Paper lit from the left, a little darker to the right and down.
        const paper = (x / w) * 0.18 + (y / h) * 0.14;
        let v: number;
        if (x === 0 || x === w - 1 || y === h - 1 || (y === 0 && tip > 0))
          v = y === h - 1 || x === w - 1 ? blend(edge, SLOT.dark, 0.35) : ink(edge);
        else if (tip > 0 && Math.abs(y - flapAt) < 0.6) v = blend(SLOT.mid, SLOT.dark, 0.2);
        else if (tip > 0 && y < flapAt) v = blend(SLOT.bright, SLOT.light, 0.12 + paper);
        // The V's edge, where the side flaps' paper ends.
        else if (Math.abs(y - vAt) < 0.6)
          v = tip > 0 && flapAt >= vAt ? blend(SLOT.bright, SLOT.mid, 0.3) : ink(edge);
        else if (y < vAt) {
          // The opening: the letter seated inside, its top two rows down,
          // with a line of writing; above it, the pocket in shade.
          const inLetter = y >= 2 && x >= 3 && x <= w - 4;
          const writing = y === 4 && x >= 7 && x <= w - 10;
          v = inLetter
            ? writing
              ? ink(SLOT.light)
              : ink(SLOT.bright, 3)
            : blend(SLOT.light, SLOT.mid, 0.35);
        }
        // Just under the flap's edge, its thickness casts a faint shadow.
        else if (tip > 0 && y > flapAt && y < flapAt + 1.6) v = blend(SLOT.bright, SLOT.light, 0.7);
        else if (Math.abs(y - seamAt) < 0.55) v = blend(SLOT.bright, SLOT.mid, 0.35);
        else v = blend(SLOT.bright, SLOT.light, 0.25 + paper);
        this.put(out, opacity, x0 + x, y0 + y, v, alpha);
      }

    // A wax seal at the closed flap's tip, or where it meets the back.
    if (b.accent) {
      const sx = Math.round(x0 + mid);
      const sy = Math.round(y0 + Math.max(1.5, tip));
      for (let dy = -2; dy <= 1; dy++)
        for (let dx = -2; dx <= 1; dx++) {
          if ((dx === -2 || dx === 1) && (dy === -2 || dy === 1)) continue;
          const lit = dx < 0 && dy < 0;
          this.put(
            out,
            opacity,
            sx + dx,
            sy + dy,
            lit
              ? blend(SLOT.accent, SLOT.bright, 0.35)
              : dy === 1
                ? blend(SLOT.accent, SLOT.dark, 0.3)
                : ink(SLOT.accent),
            alpha,
          );
        }
    }
  }

  /** A paper plane: the upper wing lit, the lower in shade, a bright crease, a fading trail. */
  private drawPlane(out: Uint8Array, opacity: Uint8Array, b: Bird) {
    const { alpha } = this.look(b);
    const dir = b.vx >= 0 ? 1 : -1;
    const speed = Math.hypot(b.vx, b.vy) || 1;
    for (let k = 1; k <= 18; k++) {
      const x = Math.round(b.x - (b.vx / speed) * (PLANE_L * 0.5 + k * 1.8));
      const y = Math.round(b.y - PLANE_H / 2 - (b.vy / speed) * (PLANE_L * 0.5 + k * 1.8));
      this.put(out, opacity, x, y, ink(SLOT.light), Math.round(alpha * 0.32 * (1 - k / 19)));
    }
    // In the plane's own frame, facing right, from the tail's top corner.
    const L = PLANE_L;
    const H = PLANE_H;
    const nose = { x: L, y: H * 0.45 };
    const top = { x: 0, y: 0 };
    const crease = { x: L * 0.2, y: H * 0.55 };
    const keel = { x: L * 0.14, y: H };
    const inside = (
      p: { x: number; y: number },
      a: { x: number; y: number },
      c: { x: number; y: number },
      d: { x: number; y: number },
    ) => {
      const s1 = (c.x - a.x) * (p.y - a.y) - (c.y - a.y) * (p.x - a.x);
      const s2 = (d.x - c.x) * (p.y - c.y) - (d.y - c.y) * (p.x - c.x);
      const s3 = (a.x - d.x) * (p.y - d.y) - (a.y - d.y) * (p.x - d.x);
      return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
    };
    const ox = Math.round(b.x - (dir * L) / 2);
    const oy = Math.round(b.y - H);
    const shape = new Int32Array((L + 1) * (H + 1));
    for (let y = 0; y <= H; y++)
      for (let x = 0; x <= L; x++) {
        const p = { x: x + 0.5, y: y + 0.5 };
        let v = 0;
        // The crease: the line from the tail to the nose between the wings.
        const t = (p.x - crease.x) / (nose.x - crease.x);
        const onCrease =
          t >= 0 && t <= 1 && Math.abs(p.y - (crease.y + (nose.y - crease.y) * t)) < 0.6;
        if (onCrease) v = ink(SLOT.bright, 3);
        else if (inside(p, top, nose, crease))
          v = blend(SLOT.bright, SLOT.light, 0.15 + (x / L) * 0.2);
        else if (inside(p, crease, nose, keel))
          v = blend(SLOT.light, SLOT.mid, 0.4 + (y / H) * 0.25);
        shape[y * (L + 1) + x] = v;
      }
    // A darker edge all round, so it shows on a light background too.
    const at = (x: number, y: number) =>
      x < 0 || x > L || y < 0 || y > H ? 0 : shape[y * (L + 1) + x]!;
    for (let y = 0; y <= H; y++)
      for (let x = 0; x <= L; x++) {
        const v = at(x, y);
        if (!v) continue;
        const rim = !at(x - 1, y) || !at(x + 1, y) || !at(x, y - 1) || !at(x, y + 1);
        this.put(out, opacity, ox + dir * x, oy + y, rim ? ink(SLOT.mid) : v, alpha);
      }
  }
}
