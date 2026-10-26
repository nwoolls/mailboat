import {
  type FrameResult,
  ink,
  plot,
  type Pointer,
  type Scene,
  type SceneSetup,
  SLOT,
  type Slot,
} from "./scene";

/**
 * A koi pond under the words. A few koi glide and turn; now and then one
 * swims up to a letter (or the icon box, which nods) and nibbles at it.
 * The pointer sends out ripples, and the koi dart away from it.
 */

type Fish = {
  /** Spine points, head first. */
  spine: { x: number; y: number }[];
  heading: number;
  speed: number;
  turn: number;
  body: Slot;
  spots: Slot;
  /** Where it wanders between nibbles: a nearby spot off the words. */
  goal: { x: number; y: number };
  /** A letter or icon cell it's heading for, and how long it nibbles. */
  target: { x: number; y: number; icon: boolean } | null;
  nibble: number;
  rest: number;
};
type Ripple = { x: number; y: number; r: number; life: number };

const COUNT = 5;
const SEGMENTS = 11;
const GAP = 2;
/** Half-widths along the body, head to tail. */
const WIDTH = [2, 2.8, 3.2, 3.2, 3, 2.6, 2.1, 1.6, 1.1, 0.7, 0.5];
/** Which segments carry each fish's patches. */
const SPOTS = [
  [1, 2, 6],
  [3, 4],
  [2, 5, 6, 7],
  [1, 4, 5],
  [2, 3, 7],
];
const LOOKS: [Slot, Slot][] = [
  [SLOT.bright, SLOT.accent],
  [SLOT.accent, SLOT.bright],
  [SLOT.light, SLOT.dark],
  [SLOT.bright, SLOT.dark],
  [SLOT.mid, SLOT.bright],
];

export class KoiScene implements Scene {
  readonly fish: Fish[] = [];
  readonly ripples: Ripple[] = [];
  private last: Pointer = null;
  private sinceRipple = 0;
  private t = 0;
  private lastNod = -Infinity;
  private readonly letterCells: number[] = [];

  constructor(private readonly s: SceneSetup) {
    const { cols, rows, rng } = s;
    s.letters.forEach((v, i) => v && this.letterCells.push(i));
    for (let i = 0; i < COUNT; i++) {
      const x = cols * (0.15 + rng() * 0.7);
      const y = rows * (0.15 + rng() * 0.7);
      const heading = rng() * Math.PI * 2;
      const [body, spots] = LOOKS[i % LOOKS.length]!;
      this.fish.push({
        spine: Array.from({ length: SEGMENTS }, (_, k) => ({
          x: x - Math.cos(heading) * k * GAP,
          y: y - Math.sin(heading) * k * GAP,
        })),
        heading,
        goal: this.nearby(x, y),
        speed: 9 + rng() * 5,
        turn: 0,
        body,
        spots,
        target: null,
        nibble: 0,
        rest: 6 + rng() * 14,
      });
    }
  }

  frame(dt: number, pointer: Pointer): FrameResult {
    const { s } = this;
    const { cols, rows, rng } = s;
    this.t += dt;
    let nod = false;
    if (
      pointer &&
      this.last &&
      Math.hypot(pointer.x - this.last.x, pointer.y - this.last.y) > 0.5
    ) {
      this.sinceRipple += dt;
      if (this.sinceRipple > 0.25) {
        this.sinceRipple = 0;
        this.ripples.push({ x: pointer.x, y: pointer.y, r: 1, life: 1 });
      }
    }
    this.last = pointer;

    for (const f of this.fish) {
      const head = f.spine[0]!;
      // Between nibbles, wander from spot to nearby spot. Swimming straight,
      // wall to wall, or between random spots anywhere, they kept crossing
      // the middle together (owner, 2026-10-26).
      if (Math.hypot(f.goal.x - head.x, f.goal.y - head.y) < 8)
        f.goal = this.nearby(head.x, head.y);
      let want = Math.atan2(f.goal.y - head.y, f.goal.x - head.x) + f.turn;
      f.turn += (rng() - 0.5) * dt * 2;
      f.turn *= 0.97;
      let speed = f.speed;
      if (f.nibble > 0) {
        f.nibble -= dt;
        speed = 1.5;
        want = f.heading + Math.sin(this.t * 14) * 0.3;
        if (f.nibble <= 0) {
          f.target = null;
          f.rest = 10 + rng() * 20;
          f.goal = this.nearby(head.x, head.y);
        }
      } else if (f.target) {
        const dx = f.target.x - head.x;
        const dy = f.target.y - head.y;
        want = Math.atan2(dy, dx);
        if (Math.hypot(dx, dy) < 2) {
          f.nibble = 1.6;
          this.ripples.push({ x: head.x, y: head.y, r: 1, life: 0.7 });
          if (f.target.icon && this.t - this.lastNod > 4) {
            this.lastNod = this.t;
            nod = true;
          }
        }
      } else if ((f.rest -= dt) <= 0) this.pickTarget(f);
      // Keep off the edges, turning back toward its own spot (always inside),
      // not the middle, where every koi met.
      const m = 8;
      if (head.x < m || head.x > cols - m || head.y < m || head.y > rows - m)
        want = Math.atan2(f.goal.y - head.y, f.goal.x - head.x);
      if (pointer) {
        const dx = head.x - pointer.x;
        const dy = head.y - pointer.y;
        if (Math.hypot(dx, dy) < 18) {
          want = Math.atan2(dy, dx);
          speed = f.speed * 2.6;
          f.target = null;
          f.nibble = 0;
        }
      }
      let diff = want - f.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      f.heading += Math.max(-2.5 * dt, Math.min(2.5 * dt, diff));
      head.x += Math.cos(f.heading) * speed * dt;
      head.y += Math.sin(f.heading) * speed * dt;
      // The rest of the body follows at a fixed spacing.
      for (let k = 1; k < f.spine.length; k++) {
        const a = f.spine[k - 1]!;
        const b = f.spine[k]!;
        const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        b.x = a.x + ((b.x - a.x) / d) * GAP;
        b.y = a.y + ((b.y - a.y) / d) * GAP;
      }
    }
    for (const r of this.ripples) {
      r.r += dt * 11;
      r.life -= dt * 0.7;
    }
    const kept = this.ripples.filter((r) => r.life > 0);
    this.ripples.length = 0;
    this.ripples.push(...kept);
    return { nod };
  }

  /**
   * A random spot within reach of (x, y), clear of the edges and, if it
   * can be, of the icon and words, so the koi spread over the whole pond.
   */
  private nearby(x: number, y: number) {
    const { cols, rows, rng, icon, words } = this.s;
    const m = 14;
    const reach = Math.max(40, cols * 0.3);
    const pad = 12;
    const onWords = (p: { x: number; y: number }) =>
      [icon, words].some(
        (r) => r && p.x > r.x0 - pad && p.x < r.x1 + pad && p.y > r.y0 - pad && p.y < r.y1 + pad,
      );
    let p = { x, y };
    for (let i = 0; i < 8; i++) {
      p = {
        x: Math.min(cols - m, Math.max(m, x + (rng() * 2 - 1) * reach)),
        y: Math.min(rows - m, Math.max(m, y + (rng() * 2 - 1) * reach)),
      };
      if (!onWords(p)) break;
    }
    return p;
  }

  private pickTarget(f: Fish) {
    const { s } = this;
    // One koi at the letters at a time; the others wait their turn.
    if (this.fish.some((o) => o !== f && (o.target || o.nibble > 0))) {
      f.rest = 3 + s.rng() * 6;
      return;
    }
    const toIcon = s.icon && (s.rng() < 0.25 || !this.letterCells.length);
    if (toIcon && s.icon) {
      const top = s.rng() < 0.5;
      f.target = {
        x: s.icon.x0 + s.rng() * (s.icon.x1 - s.icon.x0),
        y: top ? s.icon.y0 - 1 : s.icon.y1 + 1,
        icon: true,
      };
    } else if (this.letterCells.length) {
      const i = this.letterCells[Math.floor(s.rng() * this.letterCells.length)]!;
      f.target = { x: i % s.cols, y: Math.floor(i / s.cols), icon: false };
    }
  }

  draw(out: Uint8Array) {
    out.fill(0);
    const { cols, rows } = this.s;
    for (const r of this.ripples) {
      const shade = r.life > 0.6 ? 2 : r.life > 0.3 ? 1 : 0;
      const steps = Math.max(8, Math.ceil(r.r * 6));
      for (let k = 0; k < steps; k++) {
        const a = (k / steps) * Math.PI * 2;
        plot(
          out,
          cols,
          rows,
          r.x + Math.cos(a) * r.r,
          r.y + Math.sin(a) * r.r,
          ink(SLOT.mid, shade),
        );
      }
    }
    this.fish.forEach((f, n) => {
      f.spine.forEach((p, k) => {
        const w = WIDTH[k] ?? 0.3;
        const spot = SPOTS[n % SPOTS.length]!.includes(k);
        const v = ink(spot ? f.spots : f.body, k === 0 ? 3 : 2);
        for (let dy = -Math.ceil(w); dy <= Math.ceil(w); dy++)
          for (let dx = -Math.ceil(w); dx <= Math.ceil(w); dx++)
            if (dx * dx + dy * dy <= w * w + 0.3) plot(out, cols, rows, p.x + dx, p.y + dy, v);
      });
      // Fins behind the head, and a forked tail.
      const [a, b] = [f.spine[2]!, f.spine[3]!];
      const nx = -(a.y - b.y);
      const ny = a.x - b.x;
      const len = Math.hypot(nx, ny) || 1;
      for (const side of [-1, 1])
        plot(
          out,
          cols,
          rows,
          a.x + (nx / len) * 3.2 * side,
          a.y + (ny / len) * 3.2 * side,
          ink(f.body, 1),
        );
      const tail = f.spine[SEGMENTS - 1]!;
      const pre = f.spine[SEGMENTS - 2]!;
      const tx = tail.x - pre.x;
      const ty = tail.y - pre.y;
      for (const side of [-1, 1])
        for (const k of [1, 1.6])
          plot(
            out,
            cols,
            rows,
            tail.x + (tx - ty * side) * k,
            tail.y + (ty + tx * side) * k,
            ink(f.body, 1),
          );
    });
  }
}
