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
 * A koi pond under the words. A few koi glide and turn; now and then one
 * swims up to a letter (or the icon box, which nods) and nibbles at it.
 * The pointer sends out ripples, and the koi dart away from it.
 *
 * Drawn finer than the other scenes (2px cells, see the catalog), and each
 * koi as a shape rather than a row of dots: a body that is round at the
 * nose and thins to the tail, shaded darker at its sides, patches that
 * move with it, flapping fins and a forked tail that ripple as waves run
 * along them (owner, 2026-11-13), and eyes. It swims with a
 * slight side-to-side wave that runs down the body.
 */

/** A patch on a koi, in its own frame: along (0 nose, 1 tail), across (-1..1), size in cells. */
type Blob = { u: number; v: number; r: number };
type Look = { body: Slot; patch: Slot | null; speck: Slot | null; fin: Slot };

type Fish = {
  /** Spine points, head first. */
  spine: { x: number; y: number }[];
  heading: number;
  speed: number;
  turn: number;
  /** Scales the whole koi (and its spine spacing). */
  size: number;
  /**
   * How deep it swims, 0 at the surface to 1 at the bottom, and the depth
   * it's heading for: deeper koi show more of the pond through them.
   */
  depth: number;
  dive: number;
  /** The swimming wave's phase, and each fin's flap. */
  wave: number;
  flap: number;
  look: Look;
  patches: Blob[];
  specks: Blob[];
  /** Where it wanders between nibbles: a nearby spot off the words. */
  goal: { x: number; y: number };
  /** A letter or icon cell it's heading for, and how long it nibbles. */
  target: { x: number; y: number; icon: boolean } | null;
  nibble: number;
  rest: number;
  /**
   * How far the tail swings past the body's bend, eased: set at once, it
   * flicked with every turn (owner, 2026-11-13: "koi are a little more
   * chill").
   */
  tailBend: number;
};
/** A ripple: its centre, how far its front has spread, how much is left of it (1 to 0), and how strong it started. */
type Ripple = { x: number; y: number; r: number; life: number; strength: number };

const COUNT = 5;
const SEGMENTS = 17;
/** Spine spacing at size 1, in cells: a koi is about 48 cells (96px) long. */
const GAP = 3;
/** Half the body's widest width at size 1, in cells. */
const BODY_W = 6.5;
/** Tail and fin lengths at size 1, in cells. */
const TAIL = 11;
const FIN = 6.5;
/** How far each joint of the spine may bend, so a koi arcs rather than folds. */
const MAX_BEND = 0.17;

/** Traditional koi, in palette slots: kohaku, sanke, showa, ogon, and an orange one. */
const LOOKS: Look[] = [
  { body: SLOT.bright, patch: SLOT.accent, speck: null, fin: SLOT.light },
  { body: SLOT.bright, patch: SLOT.accent, speck: SLOT.dark, fin: SLOT.light },
  { body: SLOT.dark, patch: SLOT.accent, speck: SLOT.bright, fin: SLOT.mid },
  { body: SLOT.light, patch: null, speck: null, fin: SLOT.mid },
  { body: SLOT.accent, patch: SLOT.bright, speck: null, fin: SLOT.light },
];

/**
 * Shading by blending palette colours, by slot (dark, mid, light, bright,
 * accent): what each darkens towards at the body's sides and how far, and
 * what it lightens towards down the back and how far.
 */
const SHADOW: readonly Slot[] = [SLOT.dark, SLOT.dark, SLOT.dark, SLOT.mid, SLOT.dark];
const SHADOW_BY = [0, 0.6, 0.55, 0.6, 0.5];
const HIGHLIGHT: readonly Slot[] = [SLOT.mid, SLOT.bright, SLOT.bright, SLOT.bright, SLOT.bright];
const HIGHLIGHT_BY = [0.4, 0.3, 0.35, 0, 0.3];

/**
 * A body cell's colour `v` of the way from the spine (0) to the edge (1):
 * lit down the back, darkening ever faster towards the sides, as a rounded
 * body would. A dark body, with nothing darker to go to, gets a darker shade
 * at its very edge instead.
 */
function tone(slot: Slot, v: number): number {
  if (v < 0.3) return blend(slot, HIGHLIGHT[slot]!, ((0.3 - v) / 0.3) * HIGHLIGHT_BY[slot]!);
  if (slot === SLOT.dark) return ink(slot, v > 0.8 ? 0 : 2);
  const round = 1 - Math.sqrt(1 - v * v);
  return blend(slot, SHADOW[slot]!, round * SHADOW_BY[slot]!);
}

/**
 * A fin or tail cell: the body's colour at the base turning to the fin's,
 * every other ray a little darker, and a darker edge.
 */
function finTone(fin: Slot, body: Slot, r: number, ray: boolean, edge: boolean): number {
  if (edge) return blend(fin, SHADOW[fin]!, 0.45);
  if (r < 0.3) return blend(body, fin, r / 0.3);
  return blend(fin, SHADOW[fin]!, ray ? 0.25 : 0);
}

/** The body's half-width at `u` (0 nose, 1 tail), as a share of its widest. */
export function bodyWidth(u: number): number {
  const front = u < 0.28 ? Math.sqrt(Math.max(0, 1 - ((0.28 - u) / 0.31) ** 2)) : 1;
  const back = u > 0.28 ? 1 - 0.8 * ((u - 0.28) / 0.72) ** 1.3 : 1;
  return front * back;
}

export class KoiScene implements Scene {
  readonly fish: Fish[] = [];
  readonly ripples: Ripple[] = [];
  private last: Pointer = null;
  private sinceRipple = 0;
  private t = 0;
  private lastNod = -Infinity;
  /** Scratch for the ripples' waves, one per cell. */
  private wave = new Float32Array(0);
  private readonly letterCells: number[] = [];

  constructor(private readonly s: SceneSetup) {
    const { cols, rows, rng } = s;
    s.letters.forEach((v, i) => v && this.letterCells.push(i));
    // Smaller in a small pond, so a narrow list still has room to swim.
    // (In cells of its usual size, however zoomed it is drawn.)
    const scale = clamp((Math.min(cols, rows) * (s.zoom ?? 1)) / 200, 0.55, 1);
    for (let i = 0; i < COUNT; i++) {
      const x = cols * (0.15 + rng() * 0.7);
      const y = rows * (0.15 + rng() * 0.7);
      const heading = rng() * Math.PI * 2;
      const size = scale * (0.8 + rng() * 0.35);
      const look = LOOKS[i % LOOKS.length]!;
      this.fish.push({
        spine: Array.from({ length: SEGMENTS }, (_, k) => ({
          x: x - Math.cos(heading) * k * GAP * size,
          y: y - Math.sin(heading) * k * GAP * size,
        })),
        heading,
        goal: this.nearby(x, y),
        speed: (13 + rng() * 7) * size,
        turn: 0,
        size,
        wave: rng() * Math.PI * 2,
        flap: rng() * Math.PI * 2,
        look,
        patches: look.patch ? blobs(rng, 2 + Math.floor(rng() * 3), 3, 7) : [],
        specks: look.speck ? blobs(rng, 3 + Math.floor(rng() * 4), 1.2, 2.4) : [],
        depth: rng(),
        dive: rng(),
        target: null,
        nibble: 0,
        rest: 6 + rng() * 14,
        tailBend: 0,
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
        this.ripples.push({ x: pointer.x, y: pointer.y, r: 0, life: 1, strength: 1 });
      }
    }
    this.last = pointer;

    for (const f of this.fish) {
      const head = f.spine[0]!;
      // Between nibbles, wander from spot to nearby spot. Swimming straight,
      // wall to wall, or between random spots anywhere, they kept crossing
      // the middle together (owner, 2026-10-26).
      if (Math.hypot(f.goal.x - head.x, f.goal.y - head.y) < 12)
        f.goal = this.nearby(head.x, head.y);
      let want = Math.atan2(f.goal.y - head.y, f.goal.x - head.x) + f.turn;
      f.turn += (rng() - 0.5) * dt * 2;
      f.turn *= 0.97;
      let speed = f.speed;
      // Unhurried koi turn in wide, slow arcs; a startled one turns faster.
      let turnRate = 1.1;
      if (f.nibble > 0) {
        f.nibble -= dt;
        speed = 2;
        // A gentle sway while it nibbles; a quick wiggle read as a flick.
        want = f.heading + Math.sin(this.t * 4) * 0.12;
        if (f.nibble <= 0) {
          f.target = null;
          f.rest = 10 + rng() * 20;
          f.goal = this.nearby(head.x, head.y);
        }
      } else if (f.target) {
        const dx = f.target.x - head.x;
        const dy = f.target.y - head.y;
        const d = Math.hypot(dx, dy);
        want = Math.atan2(dy, dx);
        // Slows as it comes close, so it doesn't circle the letter.
        speed = Math.min(speed, 3 + d * 0.8);
        if (d < 3) {
          f.nibble = 1.6;
          this.ripples.push({ x: head.x, y: head.y, r: 0, life: 1, strength: 0.6 });
          if (f.target.icon && this.t - this.lastNod > 4) {
            this.lastNod = this.t;
            nod = true;
          }
        }
      } else if ((f.rest -= dt) <= 0) this.pickTarget(f);
      // Now and then it rises or sinks a little; it comes up to nibble.
      if (f.target || f.nibble > 0) f.dive = 0;
      else if (rng() < dt / 9) f.dive = rng();
      let sink = 0.12;
      // Keep off the edges, turning back toward its own spot (always inside),
      // not the middle, where every koi met.
      const m = 12;
      if (head.x < m || head.x > cols - m || head.y < m || head.y > rows - m)
        want = Math.atan2(f.goal.y - head.y, f.goal.x - head.x);
      if (pointer) {
        const dx = head.x - pointer.x;
        const dy = head.y - pointer.y;
        if (Math.hypot(dx, dy) < 28) {
          want = Math.atan2(dy, dx);
          speed = f.speed * 2.6;
          turnRate = 2.2;
          // A startled koi dives.
          f.dive = 1;
          sink = 0.6;
          f.target = null;
          f.nibble = 0;
        }
      }
      f.depth += clamp(f.dive - f.depth, -sink * dt, sink * dt);
      let diff = want - f.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      f.heading += clamp(diff, -turnRate * dt, turnRate * dt);
      // The head sways a little either side of its heading, faster when it
      // hurries; the body following it carries the sway down to the tail.
      // Capped, so a darting koi swims harder without thrashing.
      const pace = Math.min(speed / f.size, 24);
      f.wave += dt * (2 + pace / 8);
      f.flap += dt * (1.5 + pace / 12);
      const sway = f.heading + Math.sin(f.wave) * 0.28;
      head.x += Math.cos(sway) * speed * dt;
      head.y += Math.sin(sway) * speed * dt;
      // The rest of the body follows at a fixed spacing, each joint bending
      // only so far from the one in front.
      const gap = GAP * f.size;
      let ahead = sway;
      for (let k = 1; k < f.spine.length; k++) {
        const a = f.spine[k - 1]!;
        const b = f.spine[k]!;
        let bend = Math.atan2(a.y - b.y, a.x - b.x) - ahead;
        bend = Math.atan2(Math.sin(bend), Math.cos(bend));
        const angle = ahead + clamp(bend, -MAX_BEND, MAX_BEND);
        b.x = a.x - Math.cos(angle) * gap;
        b.y = a.y - Math.sin(angle) * gap;
        ahead = angle;
      }
      // The tail follows the body's bend near it, a little behind.
      const sp = f.spine;
      const n = sp.length - 1;
      const back = Math.atan2(sp[n]!.y - sp[n - 2]!.y, sp[n]!.x - sp[n - 2]!.x);
      const before = Math.atan2(sp[n - 2]!.y - sp[n - 5]!.y, sp[n - 2]!.x - sp[n - 5]!.x);
      const bend = Math.atan2(Math.sin(back - before), Math.cos(back - before));
      f.tailBend += (bend - f.tailBend) * Math.min(1, dt * 2.5);
    }
    for (const r of this.ripples) {
      r.r += dt * 13;
      r.life -= dt * 0.45;
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
    const m = 22;
    const reach = Math.max(60, cols * 0.3);
    const pad = 18;
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

  /**
   * Draws the pond; `parts` leaves out the ripples or the koi, for a
   * drawing that treats them differently (ASCII art's koi).
   */
  draw(out: Uint8Array, opacity: Uint8Array, parts = { ripples: true, koi: true }) {
    out.fill(0);
    const { cols, rows } = this.s;
    if (parts.ripples) this.drawRipples(out, opacity);
    if (!parts.koi) return;
    // Deepest first, so the koi nearer the surface swim over them.
    const order = this.fish
      .map((_, n) => n)
      .toSorted((a, b) => this.fish[b]!.depth - this.fish[a]!.depth);
    for (const n of order) drawKoi(out, opacity, cols, rows, this.fish[n]!, n);
  }

  /**
   * Each ripple is a train of three waves spreading out, the first the
   * strongest: a light crest with a faint dark trough behind it, weaker as
   * it spreads and as it ages. Where ripples cross, their waves add up.
   */
  private drawRipples(out: Uint8Array, opacity: Uint8Array) {
    const { cols, rows } = this.s;
    if (!this.ripples.length) return;
    if (this.wave.length !== cols * rows) this.wave = new Float32Array(cols * rows);
    const wave = this.wave;
    wave.fill(0);
    for (const r of this.ripples) {
      const amp = r.strength * r.life * r.life * (1 / Math.sqrt(1 + r.r / 12));
      const x0 = Math.max(0, Math.floor(r.x - r.r - 2));
      const x1 = Math.min(cols - 1, Math.ceil(r.x + r.r + 2));
      const y0 = Math.max(0, Math.floor(r.y - r.r - 2));
      const y1 = Math.min(rows - 1, Math.ceil(r.y + r.r + 2));
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const d = Math.hypot(x - r.x, y - r.y);
          let h = 0;
          for (const [behind, share] of WAVES) {
            const front = r.r - behind;
            if (front <= 0) continue;
            const crest = d - front;
            const trough = d - (front - 1.8);
            h += share * (Math.exp(-crest * crest * 1.4) - 0.55 * Math.exp(-trough * trough * 0.9));
          }
          wave[y * cols + x]! += h * amp;
        }
    }
    for (let i = 0; i < wave.length; i++) {
      const h = wave[i]!;
      if (Math.abs(h) < 0.04) continue;
      out[i] = h > 0 ? ink(SLOT.light) : ink(SLOT.dark);
      opacity[i] = Math.round(Math.min(1, Math.abs(h) * 0.9) * 255);
    }
  }
}

/** A ripple's waves: how far each trails the front, and its share of the strength. */
const WAVES: readonly (readonly [number, number])[] = [
  [0, 1],
  [4.5, 0.55],
  [9, 0.25],
];

/** `count` patches with radii between `lo` and `hi` cells, on the body's front 85%. */
function blobs(rng: () => number, count: number, lo: number, hi: number): Blob[] {
  return Array.from({ length: count }, () => ({
    u: 0.05 + rng() * 0.75,
    v: (rng() * 2 - 1) * 0.7,
    r: lo + rng() * (hi - lo),
  }));
}

/** A steady pseudo-random number in [0, 1) for a few integers. */
function hash(a: number, b: number, c: number): number {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Whether a cell at (u, v) of a koi `len` cells long and `w` half-wide falls in one of `bs`. */
function inBlob(bs: Blob[], u: number, v: number, len: number, w: number, size: number, n: number) {
  // Ragged edges, fixed to the body so they don't flicker as it swims.
  const jitter = (hash(n, Math.round(u * len), Math.round(v * w)) - 0.5) * 1.6;
  return bs.some((b) => {
    const du = (u - b.u) * len;
    const dv = (v - b.v) * w;
    const r = b.r * size + jitter;
    return du * du + dv * dv < r * r;
  });
}

/** The unit vector from `b` to `a`. */
function dir(a: { x: number; y: number }, b: { x: number; y: number }) {
  const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
  return { x: (a.x - b.x) / d, y: (a.y - b.y) / d };
}

/**
 * Paints one koi: for every cell near it, the nearest point of its spine
 * says how far along and across the body the cell is; that picks body,
 * patch, fin or tail, and how dark (the sides are darker, so it looks round).
 */
function drawKoi(
  out: Uint8Array,
  opacity: Uint8Array,
  cols: number,
  rows: number,
  f: Fish,
  n: number,
) {
  // At the bottom a koi is a third as solid as at the surface.
  const alpha = Math.round(255 * (1 - f.depth * 0.68));
  const sp = f.spine;
  const segs = sp.length - 1;
  const len = segs * GAP * f.size;
  const W = BODY_W * f.size;

  // Fins: pectoral (big, near the head) and pelvic (small, mid-body), each
  // side, swept back and flapping.
  const fins: {
    x: number;
    y: number;
    dx: number;
    dy: number;
    len: number;
    w: number;
    phase: number;
  }[] = [];
  for (const [u, l, wide, beat] of [
    [0.22, FIN, 2.3, 0],
    [0.5, FIN * 0.55, 1.4, 1.3],
  ] as const) {
    const k = Math.round(u * segs);
    const p = sp[k]!;
    const fwd = dir(sp[k - 1]!, sp[k + 1]!);
    for (const side of [-1, 1]) {
      const nx = -fwd.y * side;
      const ny = fwd.x * side;
      const a = 0.95 + Math.sin(f.flap + beat + (side > 0 ? 0 : 0.6)) * 0.3;
      const edge = bodyWidth(u) * W * 0.7;
      fins.push({
        x: p.x + nx * edge,
        y: p.y + ny * edge,
        dx: -fwd.x * Math.cos(a) + nx * Math.sin(a),
        dy: -fwd.y * Math.cos(a) + ny * Math.sin(a),
        len: l * f.size,
        w: wide * f.size,
        phase: beat + (side > 0 ? 0 : 0.8),
      });
    }
  }
  // The tail swings a little further than the body bends, like a trailing
  // veil, easing after it (`tailBend`).
  const tip = sp[segs]!;
  const back = dir(tip, sp[segs - 2]!);
  const swing = Math.atan2(back.y, back.x) + f.tailBend * 0.45;
  const tail = { x: Math.cos(swing), y: Math.sin(swing), len: TAIL * f.size };

  const pad = W + FIN * f.size + tail.len;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of sp) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  const cx0 = Math.max(0, Math.floor(x0 - pad));
  const cy0 = Math.max(0, Math.floor(y0 - pad));
  const cx1 = Math.min(cols - 1, Math.ceil(x1 + pad));
  const cy1 = Math.min(rows - 1, Math.ceil(y1 + pad));
  const { body, patch, speck, fin } = f.look;

  for (let cy = cy0; cy <= cy1; cy++)
    for (let cx = cx0; cx <= cx1; cx++) {
      let best = Infinity;
      let u = 0;
      let side = 1;
      for (let k = 0; k < segs; k++) {
        const a = sp[k]!;
        const b = sp[k + 1]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const t = clamp(((cx - a.x) * dx + (cy - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
        const ex = cx - (a.x + dx * t);
        const ey = cy - (a.y + dy * t);
        const d2 = ex * ex + ey * ey;
        if (d2 < best) {
          best = d2;
          u = (k + t) / segs;
          side = dx * ey - dy * ex >= 0 ? 1 : -1;
        }
      }
      const d = Math.sqrt(best);
      const w = bodyWidth(u) * W;
      let value = 0;
      if (d <= w) {
        const v = d / w;
        let slot = body;
        if (speck !== null && inBlob(f.specks, u, side * v, len, w, f.size, n * 7 + 3))
          slot = speck;
        else if (patch !== null && inBlob(f.patches, u, side * v, len, w, f.size, n * 7))
          slot = patch;
        // The dorsal fin: a darker line down the middle of the back.
        const dorsal = v < 0.12 && u > 0.32 && u < 0.62;
        value = dorsal ? blend(slot, SHADOW[slot]!, 0.35) : tone(slot, v);
      } else {
        // The tail: a fan behind the last spine point, forked in the middle.
        const tx = cx - tip.x;
        const ty = cy - tip.y;
        const s = tx * tail.x + ty * tail.y;
        // A wave runs out along the tail, so it ripples like a veil.
        const ripple = Math.sin(f.wave - (s / tail.len) * 2.6) * Math.max(0, s) * 0.12;
        const q = Math.abs(ty * tail.x - tx * tail.y - ripple);
        if (s > -1 && q <= 1 + Math.max(0, s) * 1.05) {
          const reach = tail.len * (0.6 + 0.4 * Math.min(1, q / (tail.len * 0.6)));
          if (s <= reach) {
            const ray = Math.floor(Math.atan2(q, Math.max(0.5, s)) * 9) % 2 === 1;
            value = finTone(fin, body, Math.max(0, s) / tail.len, ray, s > reach - 1.5);
          }
        }
        if (!value)
          for (const fn of fins) {
            const px = cx - fn.x;
            const py = cy - fn.y;
            const along = px * fn.dx + py * fn.dy;
            if (along < 0 || along > fn.len) continue;
            const r = along / fn.len;
            // A wave runs out along the fin as it flaps, the tip moving most.
            const wave = Math.sin(f.flap * 2.2 - r * 4.5 + fn.phase) * r * r * fn.w * 0.9;
            const across = Math.abs(py * fn.dx - px * fn.dy - wave);
            const half = fn.w * Math.sqrt(r) * (1 - r ** 3) + 0.5;
            if (across <= half) {
              const ray = Math.floor((across / half) * 3) % 2 === 1;
              value = finTone(fin, body, r, ray, r > 0.85 || across > half - 0.8);
              break;
            }
          }
      }
      if (value) {
        out[cy * cols + cx] = value;
        opacity[cy * cols + cx] = alpha;
      }
    }

  // Eyes, either side of the head.
  const k = Math.max(1, Math.round(0.07 * segs));
  const fwd = dir(sp[k - 1]!, sp[k + 1]!);
  const e = bodyWidth(0.07) * W * 0.62;
  const eye = body === SLOT.dark ? ink(SLOT.light, 0) : ink(SLOT.dark, 0);
  for (const side of [-1, 1]) {
    const x = Math.round(sp[k]!.x - fwd.y * side * e);
    const y = Math.round(sp[k]!.y + fwd.x * side * e);
    if (x < 0 || x >= cols || y < 0 || y >= rows) continue;
    out[y * cols + x] = eye;
    opacity[y * cols + x] = alpha;
  }
}
