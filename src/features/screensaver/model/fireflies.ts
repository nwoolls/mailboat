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
 * Fireflies at dusk. They drift and blink, and nudge each other's timing
 * whenever one flashes, so the swarm slowly falls into step. They drift
 * towards the pointer. Every so often they gather into the app icon's boat above
 * the icon, glow there a few seconds (the icon nods), and scatter again.
 */

/** A fly: where it is and goes, where it is in its flash cycle, and how far away (0 near, 1 far). */
type Fly = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
  rate: number;
  far: number;
};

const COUNT = 38;
const NUDGE = 0.07;
const REACH = 45;
const GATHER_EVERY = 45;
const GATHER_SECONDS = 9;

export class FireflyScene implements Scene {
  readonly flies: Fly[] = [];
  private t = 0;
  private gatherAt = GATHER_EVERY * 0.6;
  private nodded = false;
  /** Scratch for the glows' light, one per cell. */
  private light = new Float32Array(0);
  /** Points of the boat, one per fly, while they gather. */
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
        far: rng(),
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
      this.targets = logoPoints(s, COUNT);
      this.nodded = false;
    } else if (this.targets && this.t >= this.gatherAt + GATHER_SECONDS) {
      this.targets = null;
      this.gatherAt = this.t + GATHER_EVERY;
      for (const f of this.flies) {
        f.vx = (rng() - 0.5) * 45;
        f.vy = (rng() - 0.5) * 45;
      }
    }
    const flashed: Fly[] = [];
    this.flies.forEach((f, i) => {
      f.phase += f.rate * dt;
      if (f.phase >= 1) {
        f.phase -= 1;
        flashed.push(f);
      }
      let ax = (rng() - 0.5) * 27;
      let ay = (rng() - 0.5) * 27;
      const target = this.targets?.[i];
      if (target) {
        ax = (target.x - f.x) * 6 - f.vx * 3;
        ay = (target.y - f.y) * 6 - f.vy * 3;
      } else if (pointer) {
        const dx = pointer.x - f.x;
        const dy = pointer.y - f.y;
        const d = Math.hypot(dx, dy);
        if (d < 105 && d > 6) {
          ax += (dx / d) * 9;
          ay += (dy / d) * 9;
        }
      }
      f.vx = (f.vx + ax * dt) * 0.98;
      f.vy = (f.vy + ay * dt) * 0.98;
      const max = target ? 60 : 10;
      const sp = Math.hypot(f.vx, f.vy);
      if (sp > max) {
        f.vx *= max / sp;
        f.vy *= max / sp;
      }
      f.x = clamp(f.x + f.vx * dt, 2, cols - 3);
      f.y = clamp(f.y + f.vy * dt, 2, rows - 3);
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
      if (off / COUNT < 2.2) {
        this.nodded = true;
        nod = true;
      }
    }
    return { nod };
  }

  /**
   * How bright a fly is now, 0 to 1: a flash that swells quickly and fades,
   * then dark. Gathered in the boat, they glow steadily, shimmering a little.
   */
  private glow(f: Fly): number {
    if (this.targets) return 0.75 + 0.25 * Math.sin(this.t * 3 + f.x);
    if (f.phase < 0.05) return f.phase / 0.05;
    return Math.max(0, 1 - (f.phase - 0.05) * 2.6) ** 1.5;
  }

  /**
   * Each lit fly casts a round glow that fades smoothly into the dusk,
   * smaller and dimmer the farther away it is; where glows overlap their
   * light adds up. The glow runs from the accent at its rim to a pale
   * accent at its heart. Between flashes a fly is a barely seen speck.
   */
  draw(out: Uint8Array, opacity: Uint8Array) {
    out.fill(0);
    const { cols, rows } = this.s;
    if (this.light.length !== cols * rows) this.light = new Float32Array(cols * rows);
    const light = this.light;
    light.fill(0);
    for (const f of this.flies) {
      const b = this.glow(f);
      const near = 1 - f.far * 0.45;
      if (b < 0.04) {
        const x = Math.round(f.x);
        const y = Math.round(f.y);
        if (x >= 0 && x < cols && y >= 0 && y < rows && !out[y * cols + x]) {
          out[y * cols + x] = ink(SLOT.mid, 0);
          opacity[y * cols + x] = Math.round(110 * near);
        }
        continue;
      }
      const reach = (3 + 9 * b) * near;
      for (let y = Math.floor(f.y - reach); y <= Math.ceil(f.y + reach); y++)
        for (let x = Math.floor(f.x - reach); x <= Math.ceil(f.x + reach); x++) {
          if (x < 0 || x >= cols || y < 0 || y >= rows) continue;
          const d = Math.hypot(x - f.x, y - f.y) / reach;
          if (d >= 1) continue;
          light[y * cols + x]! += (1 - d) ** 1.9 * b * near;
        }
    }
    for (let i = 0; i < light.length; i++) {
      const g = light[i]!;
      if (g < 0.03) continue;
      // Never quite white, so the heart still shows on a light background.
      out[i] = blend(SLOT.accent, SLOT.bright, Math.min(0.6, (g - 0.3) * 0.9));
      opacity[i] = Math.round(Math.min(1, g * 1.5) * 255);
    }
  }
}

/**
 * `n` points evenly around the app icon's paper boat (the hull and the
 * sail rising from it), centred above the icon box, or high in the area
 * without one.
 */
export function logoPoints(s: SceneSetup, n: number): { x: number; y: number }[] {
  const w = Math.min(66, s.cols * 0.5);
  const h = w * 0.8;
  const cx = s.icon ? (s.icon.x0 + s.icon.x1) / 2 : s.cols / 2;
  const bottom = s.icon ? s.icon.y0 - 12 : s.rows * 0.4;
  const top = Math.max(3, bottom - h);
  // The outline in the icon's own units (design/icon/app-icon.svg, the
  // boat 684 wide and 468 high), scaled into the box.
  const at = (x: number, y: number) =>
    [cx - w / 2 + ((x - 170) / 684) * w, top + ((y - 282) / 468) * (bottom - top)] as const;
  const path = [
    at(170, 570),
    at(360.5, 570),
    at(512, 282),
    at(663.5, 570),
    at(854, 570),
    at(709, 750),
    at(315, 750),
    at(170, 570),
  ] as const;
  const lengths = path.slice(1).map((p, i) => Math.hypot(p[0] - path[i]![0], p[1] - path[i]![1]));
  const total = lengths.reduce((a, b) => a + b, 0);
  const out: { x: number; y: number }[] = [];
  for (let k = 0; k < n; k++) {
    // A closed outline: spread around it, so the last point isn't the first.
    let d = (k / n) * total;
    let seg = 0;
    while (seg < lengths.length - 1 && d > lengths[seg]!) d -= lengths[seg++]!;
    const a = path[seg]!;
    const b = path[seg + 1]!;
    const t = d / lengths[seg]!;
    out.push({ x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t });
  }
  return out;
}
