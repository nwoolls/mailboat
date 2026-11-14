import { logoPoints } from "./fireflies";
import {
  blend,
  clamp,
  type FrameResult,
  ink,
  type Pointer,
  type Scene,
  type SceneSetup,
  SLOT,
  type Slot,
} from "./scene";

/**
 * Fireworks (owner, 2026-10-27). Rockets climb from the bottom trailing
 * golden sparks, slow, and burst at the top: a peony (a round burst,
 * denser at the rim, like a sphere seen from the front), a chrysanthemum
 * (its sparks draw trails), a ring, a willow (long drooping golden trails),
 * a weeping willow (its sparks sink slowly, trailing long glittering
 * strands most of the way to the ground; owner, 2026-11-13)
 * or a crackle (its sparks pop into tiny flashes as they die). Sparks
 * start white-hot, cool to the shell's colour and fade; each burst lights
 * a brief soft flash and leaves faint smoke drifting up. Farther shells are
 * smaller and dimmer, behind the nearer ones. Now and then one bursts into
 * the app icon's boat above the icon, which nods. Moving the pointer aims the next
 * rocket at it. On a light page it asks for a night sky (`night`).
 *
 * Drawn on 2px cells (see the catalog). Distances are in cells.
 */

export type Shell = "peony" | "chrysanthemum" | "ring" | "willow" | "weeping" | "crackle" | "logo";
export type Spark = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds left, and how many it started with. */
  life: number;
  max: number;
  slot: Slot;
  /** How much it slows (per second) and falls (cells/s²). */
  drag: number;
  fall: number;
  /** Where it's been, newest first, for its trail; how long that trail is. */
  trail: { x: number; y: number }[];
  tail: number;
  /** 0 near, 1 far. */
  depth: number;
  /** It pops into tiny flashes as it dies. */
  crackle: boolean;
  /** For the boat: where it settles, while it holds the shape. */
  to?: { x: number; y: number };
  /** A tiny flash or rocket trail: no glow, quick. */
  small: boolean;
};
export type Rocket = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  shell: Shell;
  depth: number;
  slots: [Slot, Slot];
};
/** A soft round glow: a burst's flash, or its smoke. */
export type Puff = {
  x: number;
  y: number;
  r: number;
  grow: number;
  rise: number;
  life: number;
  max: number;
  strength: number;
  smoke: boolean;
  depth: number;
};

const SHELLS: Shell[] = ["peony", "chrysanthemum", "ring", "willow", "weeping", "crackle"];
/** Each shell's two colours: mostly the accent, sometimes plain. */
const COLOURS: [Slot, Slot][] = [
  [SLOT.accent, SLOT.accent],
  [SLOT.bright, SLOT.accent],
  [SLOT.accent, SLOT.accent],
  [SLOT.light, SLOT.light],
  [SLOT.accent, SLOT.bright],
  [SLOT.bright, SLOT.bright],
];
/** Seconds between the app icon's boat bursts. */
const LOGO_EVERY = 45;

export class FireworksScene implements Scene {
  readonly night = true;
  readonly rockets: Rocket[] = [];
  readonly sparks: Spark[] = [];
  readonly puffs: Puff[] = [];
  private t = 0;
  private nextLaunch = 0.4;
  private nextLogo = LOGO_EVERY * 0.5;
  private lastAimed = -Infinity;
  private last: Pointer = null;
  private logoFormed = false;
  /** Bursts so far (for tests). */
  bursts = 0;

  constructor(private s: SceneSetup) {}

  /** Seconds since it started. */
  get time(): number {
    return this.t;
  }

  /**
   * Carries on in a resized area (`setup`): rockets, sparks and smoke stay
   * where they are, in cells from the top left, and new rockets fit the new
   * size. For the drawings that carry on through a resize.
   */
  resize(setup: SceneSetup) {
    this.s = setup;
  }

  /** Sizes scale with the pond's height, so a small one still fits. */
  private get scale(): number {
    return clamp(this.s.rows / 300, 0.45, 1.4);
  }

  /** Launches a rocket from below `x` to burst at height `y`. */
  private launch(x: number, y: number, shell: Shell, depth: number) {
    const { rows, rng } = this.s;
    const g = 150 * this.scale;
    const rise = Math.max(20, rows + 4 - y);
    const vy = -Math.sqrt(2 * g * rise);
    this.rockets.push({
      x: x + (rng() - 0.5) * 6,
      y: rows + 4,
      vx: (rng() - 0.5) * 6,
      vy,
      shell,
      depth,
      slots: COLOURS[Math.floor(rng() * COLOURS.length)]!,
    });
  }

  frame(dt: number, pointer: Pointer): FrameResult {
    const { cols, rows, rng } = this.s;
    this.t += dt;
    let nod = false;
    // The pointer, moving, aims the next rocket at itself.
    const moved =
      pointer && this.last && Math.hypot(pointer.x - this.last.x, pointer.y - this.last.y) > 1;
    this.last = pointer;
    if (pointer && moved && this.t - this.lastAimed > 1.1) {
      this.lastAimed = this.t;
      this.launch(pointer.x, pointer.y, SHELLS[Math.floor(rng() * SHELLS.length)]!, 0);
    }
    if (this.t >= this.nextLogo) {
      this.nextLogo = this.t + LOGO_EVERY;
      const at = logoPoints(this.s, 40);
      const cx = at.reduce((n, p) => n + p.x, 0) / at.length;
      const cy = at.reduce((n, p) => n + p.y, 0) / at.length;
      this.launch(cx, cy, "logo", 0);
    } else if (this.t >= this.nextLaunch) {
      // Mostly one at a time; now and then a salvo of three.
      const salvo = rng() < 0.15 ? 3 : 1;
      for (let k = 0; k < salvo; k++)
        this.launch(
          cols * (0.1 + rng() * 0.8),
          rows * (0.12 + rng() * 0.4),
          SHELLS[Math.floor(rng() * SHELLS.length)]!,
          rng(),
        );
      this.nextLaunch = this.t + 0.6 + rng() * 1.2 + (salvo > 1 ? 1.2 : 0);
    }

    const g = 150 * this.scale;
    for (const r of this.rockets) {
      r.vy += g * dt;
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      // A golden trail of quick sparks.
      if (rng() < dt * 40)
        this.sparks.push(
          this.spark(
            r.x,
            r.y + 1,
            (rng() - 0.5) * 8,
            10 + rng() * 10,
            0.35 + rng() * 0.3,
            SLOT.light,
            r.depth,
            { small: true, fall: 30 },
          ),
        );
    }
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i]!;
      if (r.vy < -8) continue;
      this.rockets.splice(i, 1);
      this.burst(r);
    }

    for (const p of this.sparks) {
      p.life -= dt;
      p.trail.unshift({ x: p.x, y: p.y });
      if (p.trail.length > p.tail) p.trail.length = p.tail;
      if (p.to && p.life > 1.2) {
        // The boat: glide into place and hold.
        const k = Math.min(1, dt * 4);
        p.x += (p.to.x - p.x) * k;
        p.y += (p.to.y - p.y) * k;
        continue;
      }
      const drag = Math.exp(-p.drag * dt);
      p.vx *= drag;
      p.vy = p.vy * drag + p.fall * (1 - p.depth * 0.4) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.crackle && p.life <= 0)
        for (let k = 0; k < 3; k++)
          this.sparks.push(
            this.spark(
              p.x,
              p.y,
              (rng() - 0.5) * 30,
              (rng() - 0.5) * 30,
              0.12 + rng() * 0.1,
              SLOT.bright,
              p.depth,
              { small: true },
            ),
          );
    }
    if (!this.logoFormed && this.sparks.some((p) => p.to && p.life < 2.6)) {
      this.logoFormed = true;
      nod = true;
    }
    for (const f of this.puffs) {
      f.life -= dt;
      f.r += f.grow * dt;
      f.y -= f.rise * dt;
    }
    prune(this.sparks, (p) => p.life > 0 && p.y < rows + 20);
    prune(this.puffs, (f) => f.life > 0);
    return { nod };
  }

  private spark(
    x: number,
    y: number,
    vx: number,
    vy: number,
    life: number,
    slot: Slot,
    depth: number,
    more: Partial<Spark> = {},
  ): Spark {
    return {
      x,
      y,
      vx,
      vy,
      life,
      max: life,
      slot,
      drag: 2.2,
      fall: 24 * this.scale,
      trail: [],
      tail: 5,
      depth,
      crackle: false,
      small: false,
      ...more,
    };
  }

  private burst(r: Rocket) {
    const { rng } = this.s;
    this.bursts++;
    const size = this.scale * (1 - r.depth * 0.5);
    const radius = Math.min(this.s.cols, this.s.rows) * 0.2 * (1 - r.depth * 0.5);
    const [a, b] = r.slots;
    const add = (vx: number, vy: number, slot: Slot, more: Partial<Spark>) =>
      this.sparks.push(this.spark(r.x, r.y, vx, vy, 2 + rng() * 0.7, slot, r.depth, more));
    // The flash, and the smoke it leaves.
    this.puffs.push({
      x: r.x,
      y: r.y,
      r: radius * 0.6,
      grow: radius * 1.2,
      rise: 0,
      life: 0.45,
      max: 0.45,
      strength: 0.55,
      smoke: false,
      depth: r.depth,
    });
    for (let k = 0; k < 4; k++)
      this.puffs.push({
        x: r.x + (rng() - 0.5) * radius,
        y: r.y + (rng() - 0.5) * radius * 0.6,
        r: radius * 0.3,
        grow: radius * 0.25,
        rise: 3 * size,
        life: 5 + rng() * 2,
        max: 7,
        strength: 0.035,
        smoke: true,
        depth: r.depth,
      });
    if (r.shell === "logo") {
      this.logoFormed = false;
      for (const p of logoPoints(this.s, 64))
        add(0, 0, rng() < 0.5 ? a : b, { to: p, life: 3.4 + rng() * 0.4, max: 3.8, tail: 4 });
      return;
    }
    const n = Math.round((r.shell === "ring" ? 70 : 150) * (1 - r.depth * 0.35));
    for (let k = 0; k < n; k++) {
      let vx: number;
      let vy: number;
      if (r.shell === "ring") {
        // A ring, tilted a little.
        const t = (k / n) * Math.PI * 2;
        const ex = Math.cos(t);
        const ey = Math.sin(t) * 0.45;
        vx = (ex * 0.94 - ey * 0.34) * radius * 3;
        vy = (ex * 0.34 + ey * 0.94) * radius * 3;
      } else {
        // A point on a sphere, seen from the front: denser towards the rim.
        const t = rng() * Math.PI * 2;
        const z = rng() * 2 - 1;
        const flat = Math.sqrt(1 - z * z) * (0.9 + rng() * 0.1);
        vx = Math.cos(t) * flat * radius * 3;
        vy = Math.sin(t) * flat * radius * 3;
      }
      const slot = k % 2 ? a : b;
      if (r.shell === "weeping") {
        // Heavy drag stops the burst soon; then each spark sinks at a slow,
        // steady pace (fall over drag), its trail hanging above it.
        const sink = this.s.rows * 0.11 * size;
        add(vx * 0.75, vy * 0.75, SLOT.light, {
          life: 4.6 + rng() * 1.4,
          max: 6,
          drag: 1.6,
          fall: sink * 1.6,
          tail: 80,
        });
      } else if (r.shell === "willow")
        add(vx * 0.8, vy * 0.8, SLOT.light, {
          life: 2.8 + rng() * 0.8,
          max: 3.6,
          drag: 2.6,
          fall: 34 * size,
          tail: 12,
        });
      else if (r.shell === "chrysanthemum")
        add(vx, vy, slot, { life: 2.4 + rng() * 0.6, tail: 10 });
      else if (r.shell === "crackle") add(vx, vy, slot, { crackle: true, life: 1.4 + rng() * 0.5 });
      else add(vx, vy, slot, {});
    }
  }

  draw(out: Uint8Array, opacity: Uint8Array) {
    const { cols, rows } = this.s;
    out.fill(0);
    const put = (x: number, y: number, v: number, a: number) => {
      const cx = Math.round(x);
      const cy = Math.round(y);
      if (cx < 0 || cx >= cols || cy < 0 || cy >= rows || a <= 0.02) return;
      const i = cy * cols + cx;
      if (out[i] && opacity[i]! / 255 > a) return;
      out[i] = v;
      opacity[i] = Math.round(clamp(a, 0, 1) * 255);
    };
    // Smoke and flashes, softly, under the sparks; farthest first.
    for (const f of this.puffs.toSorted((p, q) => q.depth - p.depth)) {
      const fade = (f.life / f.max) * f.strength * (1 - f.depth * 0.5);
      const v = f.smoke ? blend(SLOT.mid, SLOT.dark, 0.4) : blend(SLOT.bright, SLOT.accent, 0.4);
      const x0 = Math.floor(f.x - f.r);
      const y0 = Math.floor(f.y - f.r);
      for (let y = y0; y <= f.y + f.r; y++)
        for (let x = x0; x <= f.x + f.r; x++) {
          const d = Math.hypot(x - f.x, y - f.y) / f.r;
          if (d < 1) put(x, y, v, (1 - d * d) ** 2 * fade);
        }
    }
    for (const r of this.rockets) put(r.x, r.y, ink(SLOT.bright, 3), 1 - r.depth * 0.4);
    // Sparks, farthest first: white-hot, cooling to their colour, fading.
    for (const p of this.sparks.toSorted((a, b) => b.depth - a.depth)) {
      const age = 1 - p.life / p.max;
      const fade = Math.min(1, (p.life / p.max) ** 0.6 * 1.3) * (1 - p.depth * 0.45);
      const v =
        age < 0.15
          ? ink(SLOT.bright, 3)
          : blend(SLOT.bright, p.slot, Math.min(1, (age - 0.15) * 3));
      // Glitter: the old ones twinkle.
      const tw = age > 0.7 && !p.to ? 0.6 + 0.4 * Math.sin(this.t * 40 + p.x) : 1;
      p.trail.forEach((q, k) => {
        const prev = k ? p.trail[k - 1]! : { x: p.x, y: p.y };
        const steps = Math.max(1, Math.ceil(Math.hypot(q.x - prev.x, q.y - prev.y)));
        for (let s = 0; s < steps; s++) {
          const t = s / steps;
          put(
            prev.x + (q.x - prev.x) * t,
            prev.y + (q.y - prev.y) * t,
            blend(p.slot, SLOT.mid, k / p.tail),
            fade * (1 - k / p.tail) * 0.75,
          );
        }
      });
      put(p.x, p.y, v, fade * tw);
      if (!p.small && age < 0.75) {
        const glow = fade * (0.75 - age) * 0.8;
        for (const [ox, oy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const)
          put(p.x + ox, p.y + oy, blend(p.slot, SLOT.bright, 0.3), glow);
      }
    }
  }
}

/** Keeps only the items that pass, in place. */
function prune<T>(items: T[], keep: (item: T) => boolean) {
  let n = 0;
  for (const item of items) if (keep(item)) items[n++] = item;
  items.length = n;
}
