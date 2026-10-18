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
 * Fireflies at dusk. They drift and blink, and nudge each other's timing
 * whenever one flashes, so the swarm slowly falls into step. They drift
 * towards the pointer. Every so often they gather into the app's M above
 * the icon, glow there a few seconds (the icon nods), and scatter again.
 */

type Fly = { x: number; y: number; vx: number; vy: number; phase: number; rate: number };

const COUNT = 38;
const NUDGE = 0.07;
const REACH = 30;
const GATHER_EVERY = 45;
const GATHER_SECONDS = 9;

export class FireflyScene implements Scene {
  readonly flies: Fly[] = [];
  private t = 0;
  private gatherAt = GATHER_EVERY * 0.6;
  private nodded = false;
  /** Points of the M, one per fly, while they gather. */
  private targets: { x: number; y: number }[] | null = null;

  constructor(private readonly s: SceneSetup) {
    const { cols, rows, rng } = s;
    for (let i = 0; i < COUNT; i++)
      this.flies.push({
        x: rng() * cols,
        y: rng() * rows,
        vx: 0,
        vy: 0,
        phase: rng(),
        rate: 0.45 + rng() * 0.1,
      });
  }

  get gathering(): boolean {
    return this.targets !== null;
  }

  frame(dt: number, pointer: Pointer): FrameResult {
    const { s } = this;
    const { cols, rows, rng } = s;
    this.t += dt;
    let nod = false;
    if (!this.targets && this.t >= this.gatherAt) {
      this.targets = mPoints(s, COUNT);
      this.nodded = false;
    } else if (this.targets && this.t >= this.gatherAt + GATHER_SECONDS) {
      this.targets = null;
      this.gatherAt = this.t + GATHER_EVERY;
      for (const f of this.flies) {
        f.vx = (rng() - 0.5) * 30;
        f.vy = (rng() - 0.5) * 30;
      }
    }
    const flashed: Fly[] = [];
    this.flies.forEach((f, i) => {
      f.phase += f.rate * dt;
      if (f.phase >= 1) {
        f.phase -= 1;
        flashed.push(f);
      }
      let ax = (rng() - 0.5) * 18;
      let ay = (rng() - 0.5) * 18;
      const target = this.targets?.[i];
      if (target) {
        ax = (target.x - f.x) * 6 - f.vx * 3;
        ay = (target.y - f.y) * 6 - f.vy * 3;
      } else if (pointer) {
        const dx = pointer.x - f.x;
        const dy = pointer.y - f.y;
        const d = Math.hypot(dx, dy);
        if (d < 70 && d > 4) {
          ax += (dx / d) * 6;
          ay += (dy / d) * 6;
        }
      }
      f.vx = (f.vx + ax * dt) * 0.98;
      f.vy = (f.vy + ay * dt) * 0.98;
      const max = target ? 40 : 7;
      const sp = Math.hypot(f.vx, f.vy);
      if (sp > max) {
        f.vx *= max / sp;
        f.vy *= max / sp;
      }
      f.x = clamp(f.x + f.vx * dt, 1, cols - 2);
      f.y = clamp(f.y + f.vy * dt, 1, rows - 2);
    });
    // A flash pulls nearby flies' timing forward: they drift into step.
    for (const a of flashed)
      for (const b of this.flies)
        if (b !== a && Math.hypot(a.x - b.x, a.y - b.y) < REACH)
          b.phase = Math.min(0.999, b.phase + NUDGE);
    if (this.targets && !this.nodded) {
      const off = this.flies.reduce(
        (n, f, i) => n + Math.hypot(f.x - this.targets![i]!.x, f.y - this.targets![i]!.y),
        0,
      );
      if (off / COUNT < 1.5) {
        this.nodded = true;
        nod = true;
      }
    }
    return { nod };
  }

  /** How bright a fly is now, 0 to 1: a quick flash, then dark. */
  private glow(f: Fly): number {
    if (this.targets) return 0.75 + 0.25 * Math.sin(this.t * 3 + f.x);
    return Math.max(0, 1 - f.phase * 2.5);
  }

  draw(out: Uint8Array) {
    out.fill(0);
    const { cols, rows } = this.s;
    for (const f of this.flies) {
      const b = this.glow(f);
      if (b > 0.6) {
        // A lit fly: a bright core, a cross of accent, and a faint halo.
        for (const [dx, dy] of [
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
          [0, -2],
          [-2, 0],
          [2, 0],
          [0, 2],
        ] as const)
          plot(out, cols, rows, f.x + dx, f.y + dy, ink(SLOT.accent, 0));
        for (const [dx, dy] of [
          [0, -1],
          [-1, 0],
          [1, 0],
          [0, 1],
        ] as const)
          plot(out, cols, rows, f.x + dx, f.y + dy, ink(SLOT.accent, 3));
        plot(out, cols, rows, f.x, f.y, ink(SLOT.bright, 3));
      } else if (b > 0.25) {
        for (const [dx, dy] of [
          [0, -1],
          [-1, 0],
          [1, 0],
          [0, 1],
        ] as const)
          plot(out, cols, rows, f.x + dx, f.y + dy, ink(SLOT.accent, 1));
        plot(out, cols, rows, f.x, f.y, ink(SLOT.bright, 2));
      } else plot(out, cols, rows, f.x, f.y, ink(SLOT.light, b > 0.05 ? 2 : 0));
    }
  }
}

/**
 * `n` points evenly along the app icon's M (two sides and the V between),
 * centred above the icon box, or high in the area without one.
 */
export function mPoints(s: SceneSetup, n: number): { x: number; y: number }[] {
  const w = Math.min(44, s.cols * 0.5);
  const h = w * 0.8;
  const cx = s.icon ? (s.icon.x0 + s.icon.x1) / 2 : s.cols / 2;
  const bottom = s.icon ? s.icon.y0 - 8 : s.rows * 0.4;
  const top = Math.max(2, bottom - h);
  const l = cx - w / 2;
  const r = cx + w / 2;
  const path = [
    [l, bottom],
    [l, top],
    [cx, top + h * 0.55],
    [r, top],
    [r, bottom],
  ] as const;
  const lengths = path.slice(1).map((p, i) => Math.hypot(p[0] - path[i]![0], p[1] - path[i]![1]));
  const total = lengths.reduce((a, b) => a + b, 0);
  const out: { x: number; y: number }[] = [];
  for (let k = 0; k < n; k++) {
    let d = (k / (n - 1)) * total;
    let seg = 0;
    while (seg < lengths.length - 1 && d > lengths[seg]!) d -= lengths[seg++]!;
    const a = path[seg]!;
    const b = path[seg + 1]!;
    const t = d / lengths[seg]!;
    out.push({ x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t });
  }
  return out;
}
