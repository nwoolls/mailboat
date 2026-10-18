import {
  clamp,
  type FrameResult,
  ink,
  plot,
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
};

const COUNT = 14;
const SPEED = 26;
const NEAR = 24;
const APART = 9;
const SCARE = 16;
/** Envelope sprite, 7×5: X edge, F flap, . paper. Anchored bottom-centre. */
const ENVELOPE = ["XXXXXXX", "XF...FX", "X.F.F.X", "X..F..X", "XXXXXXX"];
const ENVELOPE_FLAP = ["XXXXXXX", "X.F.F.X", "X..F..X", "X.....X", "XXXXXXX"];
/** Paper plane facing right, 8×4. */
const PLANE = ["X.......", "XXXX....", ".XXXXXXX", "..XX...."];

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
      for (let x = r.x0 + 3; x <= r.x1 - 3; x += 8)
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
      });
    }
  }

  frame(dt: number, pointer: Pointer): FrameResult {
    const { s } = this;
    const { cols, rows, rng } = s;
    this.t += dt;
    for (let i = 0; i < this.birds.length; i++) {
      const b = this.birds[i]!;
      const scared = pointer !== null && Math.hypot(b.x - pointer.x, b.y - 2 - pointer.y) < SCARE;
      if (b.mode === "perched") {
        b.wait -= dt;
        if (b.wait <= 0 || scared) this.takeOff(b, rng);
        continue;
      }
      if (b.mode === "away") {
        if ((b.wait -= dt) <= 0) {
          const left = rng() < 0.5;
          Object.assign(b, { mode: "fly", x: left ? -4 : cols + 4, y: rows * (0.1 + rng() * 0.4) });
          b.vx = left ? SPEED : -SPEED;
          b.vy = 0;
        }
        continue;
      }
      if (b.mode === "plane") {
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        if (b.x < -12 || b.x > cols + 12 || b.y > rows + 6) {
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
        else if (d < 1.2) {
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
        ax += (rng() - 0.5) * 30;
        ay += (rng() - 0.5) * 30;
        const margin = 10;
        if (b.x < margin) ax += (margin - b.x) * 6;
        if (b.x > cols - margin) ax -= (b.x - cols + margin) * 6;
        if (b.y < margin) ay += (margin - b.y) * 6;
        if (b.y > rows * 0.8) ay -= (b.y - rows * 0.8) * 6;
        if (scared && pointer) {
          const dx = b.x - pointer.x;
          const dy = b.y - pointer.y;
          const d = Math.max(1, Math.hypot(dx, dy));
          ax += (dx / d) * 260;
          ay += (dy / d) * 260;
        }
        if (rng() < 0.05 * dt) this.seekPerch(b, i, rng);
        else if (rng() < 0.012 * dt) {
          b.mode = "plane";
          b.vx = b.vx >= 0 ? 34 : -34;
          b.vy = 5;
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
      b.x = clamp(b.x + b.vx * dt, -6, cols + 6);
      b.y = clamp(b.y + b.vy * dt, 3, rows - 1);
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

  draw(out: Uint8Array) {
    out.fill(0);
    const { cols, rows } = this.s;
    for (const b of this.birds) {
      if (b.mode === "away") continue;
      if (b.mode === "plane") {
        const right = b.vx >= 0;
        PLANE.forEach((row, dy) =>
          [...row].forEach((c, dx) => {
            if (c === ".") return;
            const x = right ? b.x - 4 + dx : b.x + 3 - dx;
            plot(out, cols, rows, x, b.y - 3 + dy, ink(dy === 2 ? SLOT.bright : SLOT.light));
          }),
        );
        continue;
      }
      const flapping = b.mode !== "perched" && Math.floor(this.t * 6 + b.x) % 2 === 0;
      const sprite = flapping ? ENVELOPE_FLAP : ENVELOPE;
      const edge = ink(b.accent ? SLOT.accent : SLOT.mid);
      sprite.forEach((row, dy) =>
        [...row].forEach((c, dx) => {
          const v = c === "." ? ink(SLOT.bright) : c === "F" ? ink(SLOT.mid, 1) : edge;
          plot(out, cols, rows, b.x - 3 + dx, b.y - 4 + dy, v);
        }),
      );
    }
  }
}
