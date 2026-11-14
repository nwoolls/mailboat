import { blend, type FrameResult, type Pointer, type Scene, type SceneSetup, SLOT } from "./scene";

/**
 * The envelope flock, reworked as a murmuration (owner, 2026-11-13, of the
 * old flock of envelope icons: "any ideas to make the envelope flock not
 * suck"). Hundreds of tiny birds flock like starlings: each keeps its
 * distance from those closest, turns with its neighbors and keeps near
 * them, and the whole flock wheels around a point that wanders slowly,
 * splitting in two now and then. The pointer, the icon and the words
 * scatter the birds that come near. Every so often the flock pours down
 * into the icon to roost (the icon nods) and
 * bursts out again. The flock has volume (owner, 2026-11-13: "some depth
 * when they gather and pass over and by each other"): the birds fly in
 * three dimensions, so parts of the flock pass in front of and behind
 * others, nearer birds drawn bigger and bolder over the farther ones.
 * (The flock began as envelope icons, then a few envelopes among the
 * birds, and a falcon cut through now and then; the owner dropped them:
 * "let's keep this as flock", and the falcons "are just confusing at this
 * resolution".)
 *
 * Its motion is in pixels of the area; `ui/murmurationDraw.ts` draws it in
 * chunky pixel art or ASCII art. The numbers are in `MurmurationTuning`,
 * for the playground; the app uses `MURMURATION_DEFAULTS`.
 */
export type MurmurationTuning = {
  /** How many birds (a restart shows a change). */
  count: number;
  /** Cruising speed, in pixels a second. */
  speed: number;
  /** How far a bird sees its neighbors, and keeps its distance, in pixels. */
  sight: number;
  spacing: number;
  /** How strongly it turns with its neighbors, keeps near them, and keeps to the flock's wandering point. */
  align: number;
  cohere: number;
  home: number;
  /** How far birds flee the pointer, in pixels (and shy of the icon and words, a little less). */
  fear: number;
  /** Seconds between roosts in the icon (about). */
  roostEvery: number;
  /** How many of its nearest neighbors a bird follows. */
  neighbors: number;
  /** Seconds between the flock splitting in two for a while (about). */
  splitEvery: number;
  /** How restless each bird is: a random push, as a share of its speed. */
  jitter: number;
  /** Pixel art's block size, in screen pixels. */
  pixel: number;
};

export const MURMURATION_DEFAULTS: MurmurationTuning = {
  count: 2000,
  speed: 130,
  sight: 42,
  spacing: 12,
  align: 4,
  cohere: 0.8,
  home: 0.35,
  fear: 90,
  roostEvery: 60,
  neighbors: 7,
  splitEvery: 18,
  jitter: 3,
  pixel: 3,
};

let tuning: MurmurationTuning = MURMURATION_DEFAULTS;

/** What the murmuration uses; the defaults unless the playground changed it. */
export function murmurationTuning(): MurmurationTuning {
  return tuning;
}

/** For the playground only. */
export function setMurmurationTuning(next: MurmurationTuning) {
  tuning = next;
}

/**
 * A bird: where it is and how fast it flies, across, down and into the
 * distance (`z`, 0 nearest to `DEPTH`), how far away that is (0 near, 1
 * far), and whether it is in the roost.
 */
export type Bird = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  depth: number;
  roosting: boolean;
};

/** How deep the flock's space is, in pixels: about a third of its width. */
export const DEPTH = 260;

export type Murmuration = {
  birds: Bird[];
  width: number;
  height: number;
  time: number;
  /** The point the flock wheels around now. */
  homeX: number;
  homeY: number;
  homeZ: number;
  /** When it next goes to roost, and until when it roosts (while it does). */
  nextRoost: number;
  roostUntil: number;
  /** When the flock next splits in two, and until when it is split. */
  nextSplit: number;
  splitUntil: number;
  /** Whether the icon has nodded for this roost. */
  nodded: boolean;
  /** Seed for the wandering point's path. */
  seed: number;
};

export function makeMurmuration(
  width: number,
  height: number,
  t: MurmurationTuning,
  rng: () => number,
): Murmuration {
  const cx = width / 2;
  const cy = height * 0.4;
  const spread = Math.min(width, height) * 0.25;
  return {
    birds: Array.from({ length: Math.max(1, Math.round(t.count)) }, () => {
      const a = rng() * Math.PI * 2;
      const z = DEPTH * (0.2 + rng() * 0.6);
      return {
        x: cx + (rng() - 0.5) * spread * 2,
        y: cy + (rng() - 0.5) * spread,
        z,
        vx: Math.cos(a) * t.speed,
        vy: Math.sin(a) * t.speed * 0.5,
        vz: (rng() - 0.5) * t.speed * 0.4,
        depth: z / DEPTH,
        roosting: false,
      };
    }),
    width,
    height,
    time: 0,
    homeX: cx,
    homeY: cy,
    homeZ: DEPTH / 2,
    nextRoost: t.roostEvery * (0.6 + rng() * 0.4),
    roostUntil: -1,
    nodded: false,
    nextSplit: t.splitEvery * (0.4 + rng() * 0.6),
    splitUntil: -1,
    seed: rng() * 100,
  };
}

/** Whether it is roosting now. */
export function roosting(m: Murmuration): boolean {
  return m.time < m.roostUntil;
}

/** Seconds a roost lasts: the flock pours in, rests, and bursts out. */
export const ROOST_SECONDS = 7;

/**
 * Moves the flock on by `dt`. `pointer` (pixels of the area) scatters
 * the birds near it while it is over the area; `roost` is the icon's middle, where the flock
 * roosts. Returns whether the flock has just settled into the roost (to
 * nod the icon).
 */
export function stepMurmuration(
  m: Murmuration,
  dt: number,
  pointer: { x: number; y: number } | null,
  roost: { x: number; y: number } | null,
  t: MurmurationTuning,
  rng: () => number,
  obstacles: readonly { x0: number; y0: number; x1: number; y1: number }[] = [],
): boolean {
  m.time += dt;
  const { width: W, height: H } = m;
  // The wandering point: a slow figure that crosses the middle, so the
  // flock keeps meeting the icon and words and parting round them.
  const k = m.time * 0.05 + m.seed;
  m.homeX = W * (0.5 + 0.36 * Math.sin(k * 1.3));
  m.homeY = H * (0.48 + 0.3 * Math.sin(k * 2.1 + 1.2));
  // Now and then the flock splits, half of it after a second point across
  // from the first, and joins up again.
  if (m.time >= m.nextSplit) {
    m.splitUntil = m.time + 5 + rng() * 4;
    m.nextSplit = m.splitUntil + t.splitEvery * (0.6 + rng() * 0.8);
  }
  const split = m.time < m.splitUntil;
  const otherX = W - m.homeX;
  const otherY = H - m.homeY;
  // It also swings nearer and farther, so the flock turns through itself.
  m.homeZ = DEPTH * (0.5 + 0.35 * Math.sin(k * 1.7 + 0.4));
  // Roosting: now and then, for a few seconds, into the icon.
  let nod = false;
  if (roost && m.time >= m.nextRoost && !roosting(m)) {
    m.roostUntil = m.time + ROOST_SECONDS;
    m.nextRoost = m.time + t.roostEvery * (0.8 + rng() * 0.4);
  }
  const inRoost = roosting(m) && roost;
  const settled = inRoost && m.roostUntil - m.time < ROOST_SECONDS * 0.75;
  const leaving = inRoost && m.roostUntil - m.time < ROOST_SECONDS * 0.15;
  // Neighbors through a grid of cells as wide as the birds see: each
  // cell's birds lie together in `order`, from `starts[cell]` (plain
  // arrays, rebuilt each step; with thousands of birds, lists of objects
  // took longer than a frame).
  const cell = Math.max(8, t.sight);
  const gw = Math.ceil(W / cell) + 2;
  const gh = Math.ceil(H / cell) + 2;
  const N = m.birds.length;
  const cellOf = new Int32Array(N);
  const starts = new Int32Array(gw * gh + 1);
  for (let i = 0; i < N; i++) {
    const b = m.birds[i]!;
    if (b.roosting) {
      cellOf[i] = -1;
      continue;
    }
    const key =
      Math.min(gh - 1, Math.max(0, Math.floor(b.y / cell) + 1)) * gw +
      Math.min(gw - 1, Math.max(0, Math.floor(b.x / cell) + 1));
    cellOf[i] = key;
    starts[key + 1]!++;
  }
  for (let c = 0; c < gw * gh; c++) starts[c + 1]! += starts[c]!;
  const fill = starts.slice(0, gw * gh);
  const order = new Int32Array(N);
  for (let i = 0; i < N; i++) if (cellOf[i]! >= 0) order[fill[cellOf[i]!]!++] = i;
  const sight2 = t.sight * t.sight;
  // The nearest few found so far, nearest first: which bird, how far (squared).
  const K = Math.max(1, Math.round(t.neighbors));
  const kBird = new Int32Array(K);
  const kD2 = new Float64Array(K);
  const space2 = t.spacing * t.spacing;
  for (let bi = 0; bi < m.birds.length; bi++) {
    const b = m.birds[bi]!;
    if (b.roosting) {
      if (leaving) {
        // Bursting out, every which way and up.
        const a = rng() * Math.PI * 2;
        b.vx = Math.cos(a) * t.speed * 1.4;
        b.vy = -Math.abs(Math.sin(a)) * t.speed * 1.4;
        b.vz = (rng() - 0.5) * t.speed;
        b.roosting = false;
      }
      continue;
    }
    let ax = 0;
    let ay = 0;
    let az = 0;
    let n = 0;
    let mx = 0;
    let my = 0;
    let mz = 0;
    let vx = 0;
    let vy = 0;
    let vz = 0;
    let sx = 0;
    let sy = 0;
    let sz = 0;
    const gx = Math.floor(b.x / cell) + 1;
    const gy = Math.floor(b.y / cell) + 1;
    // Only its few nearest neighbors, as a starling watches about seven:
    // following everyone in sight pulled the flock into one tight ball.
    let found = 0;
    for (let yy = gy - 1; yy <= gy + 1; yy++)
      for (let xx = gx - 1; xx <= gx + 1; xx++) {
        if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue;
        const key = yy * gw + xx;
        for (let q = starts[key]!; q < starts[key + 1]!; q++) {
          const j = order[q]!;
          if (j === bi) continue;
          const o = m.birds[j]!;
          const dx = o.x - b.x;
          const dy = o.y - b.y;
          const dz = o.z - b.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > sight2 || (found === K && d2 >= kD2[K - 1]!)) continue;
          // Into the nearest-first list, the farthest dropping off the end.
          let at = found < K ? found++ : K - 1;
          while (at > 0 && kD2[at - 1]! > d2) {
            kD2[at] = kD2[at - 1]!;
            kBird[at] = kBird[at - 1]!;
            at--;
          }
          kD2[at] = d2;
          kBird[at] = j;
        }
      }
    for (let q = 0; q < found; q++) {
      const o = m.birds[kBird[q]!]!;
      const d2 = kD2[q]!;
      n++;
      mx += o.x;
      my += o.y;
      mz += o.z;
      vx += o.vx;
      vy += o.vy;
      vz += o.vz;
      if (d2 < space2 && d2 > 0.01) {
        sx -= (o.x - b.x) / d2;
        sy -= (o.y - b.y) / d2;
        sz -= (o.z - b.z) / d2;
      }
    }
    // Going in to roost, each heads straight for it: keeping their
    // distance from each other pushed them back out of the crowd.
    if (n && !inRoost) {
      ax += (vx / n - b.vx) * t.align;
      ay += (vy / n - b.vy) * t.align;
      ax += (mx / n - b.x) * t.cohere;
      ay += (my / n - b.y) * t.cohere;
      ax += sx * t.speed * t.spacing * 2;
      ay += sy * t.speed * t.spacing * 2;
      az += (vz / n - b.vz) * t.align + (mz / n - b.z) * t.cohere + sz * t.speed * t.spacing * 2;
    }
    // To the wandering point, or into the roost.
    const other = split && bi % 2 === 1;
    const tx = inRoost ? roost.x : other ? otherX : m.homeX;
    const ty = inRoost ? roost.y : other ? otherY : m.homeY;
    const pull = inRoost ? t.home * 6 : t.home;
    ax += (tx - b.x) * pull;
    ay += (ty - b.y) * pull;
    // The roost is at the front; otherwise the wandering point's depth.
    // (Gently in depth, so the flock keeps its volume instead of
    // flattening onto one plane.)
    az += ((inRoost ? DEPTH * 0.3 : m.homeZ) - b.z) * pull * (inRoost ? 1 : 0.3);
    // Fleeing the pointer.
    if (pointer) {
      const dx = b.x - pointer.x;
      const dy = b.y - pointer.y;
      const d = Math.hypot(dx, dy);
      if (d < t.fear && d > 0.01) {
        const push = (1 - d / t.fear) * t.speed * 14;
        ax += (dx / d) * push;
        ay += (dy / d) * push;
      }
    }
    // The icon and words startle the birds that come near, so the flock
    // parts round them rather than flying through.
    if (!inRoost)
      for (const box of obstacles) {
        const nx = Math.max(box.x0, Math.min(b.x, box.x1));
        const ny = Math.max(box.y0, Math.min(b.y, box.y1));
        const dx = b.x - nx;
        const dy = b.y - ny;
        const d = Math.hypot(dx, dy);
        const reach = t.fear * 0.6;
        if (d < reach) {
          const ux = d > 0.01 ? dx / d : b.x < (box.x0 + box.x1) / 2 ? -1 : 1;
          const uy = d > 0.01 ? dy / d : 0;
          const push = (1 - d / reach) * t.speed * 10;
          ax += ux * push;
          ay += uy * push;
        }
      }
    // A little restlessness, so it never settles smooth (but not while
    // going in to roost, where it kept them from settling in).
    if (!inRoost) {
      ax += (rng() - 0.5) * t.speed * t.jitter;
      ay += (rng() - 0.5) * t.speed * t.jitter;
      az += (rng() - 0.5) * t.speed * t.jitter;
    }
    // Back from the edges.
    const edge = 40;
    if (b.x < edge) ax += (edge - b.x) * 6;
    if (b.x > W - edge) ax -= (b.x - (W - edge)) * 6;
    if (b.y < edge) ay += (edge - b.y) * 6;
    if (b.y > H - edge) ay -= (b.y - (H - edge)) * 6;
    if (b.z < 20) az += (20 - b.z) * 6;
    if (b.z > DEPTH - 20) az -= (b.z - (DEPTH - 20)) * 6;
    b.vx += ax * dt;
    b.vy += ay * dt;
    b.vz += az * dt;
    // Starlings never hover: keep to about cruising speed.
    const sp = Math.hypot(b.vx, b.vy, b.vz) || 1;
    // Coming in to roost, they slow right down (else they circle the icon).
    const want = Math.min(t.speed * 1.5, Math.max(t.speed * (inRoost ? 0.25 : 0.7), sp));
    b.vx *= want / sp;
    b.vy *= want / sp;
    b.vz *= want / sp;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z = Math.max(0, Math.min(DEPTH, b.z + b.vz * dt));
    b.depth = b.z / DEPTH;
    // Close enough to the icon, it goes in to roost.
    if (inRoost && settled && Math.hypot(b.x - roost.x, b.y - roost.y) < 48) b.roosting = true;
  }
  // Nod once, as half the flock has gone in.
  if (!inRoost) m.nodded = false;
  else if (
    !m.nodded &&
    !leaving &&
    m.birds.filter((b) => b.roosting).length > m.birds.length * 0.5
  ) {
    m.nodded = true;
    nod = true;
  }
  return nod;
}

/** Fits the flock to a resized area: the birds stay where they are, kept inside it as they fly. */
export function resizeMurmuration(m: Murmuration, width: number, height: number) {
  m.width = width;
  m.height = height;
}

/** A lone bird's ASCII character, by which way it flies. */
export function birdChar(vx: number, vy: number): string {
  const a = Math.atan2(vy, vx);
  const o = Math.round((a / (Math.PI * 2)) * 4 + 4) % 4;
  return [">", "v", "<", "^"][o]!;
}

/** Screen pixels per cell of the fine grid the catalog gives a scene (`cellPx`). */
const FINE_PX = 2;

/**
 * The flock on the fine grid of palette cells, for the scene catalog,
 * which needs every scene to draw that way. The Toybox's styles draw
 * the flock themselves (`ui/murmurationDraw.ts`), so this is only seen if
 * that drawing is unavailable: each bird a cell, nearer ones brighter.
 */
export class FlockScene implements Scene {
  private readonly flock: Murmuration;

  constructor(private readonly s: SceneSetup) {
    const t = murmurationTuning();
    const w = s.cols * FINE_PX;
    const h = s.rows * FINE_PX;
    // As many birds as a list card's area holds, fewer in a smaller one
    // (all of them crowded into a small area, each saw every other).
    const count = Math.max(30, Math.round((t.count * w * h) / (720 * 450)));
    this.flock = makeMurmuration(w, h, { ...t, count: Math.min(t.count, count) }, s.rng);
  }

  frame(dt: number, pointer: Pointer): FrameResult {
    const { icon, words } = this.s;
    const px = (r: { x0: number; y0: number; x1: number; y1: number }) => ({
      x0: r.x0 * FINE_PX,
      y0: r.y0 * FINE_PX,
      x1: r.x1 * FINE_PX,
      y1: r.y1 * FINE_PX,
    });
    const nod = stepMurmuration(
      this.flock,
      dt,
      pointer ? { x: pointer.x * FINE_PX, y: pointer.y * FINE_PX } : null,
      icon
        ? { x: (icon.x0 + icon.x1) * (FINE_PX / 2), y: (icon.y0 + icon.y1) * (FINE_PX / 2) }
        : null,
      murmurationTuning(),
      this.s.rng,
      [icon, words].filter((r): r is NonNullable<typeof r> => r !== null).map(px),
    );
    return { nod };
  }

  draw(out: Uint8Array, opacity: Uint8Array) {
    const { cols, rows } = this.s;
    out.fill(0);
    for (const b of this.flock.birds) {
      if (b.roosting) continue;
      const x = Math.floor(b.x / FINE_PX);
      const y = Math.floor(b.y / FINE_PX);
      if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
      const i = y * cols + x;
      out[i] = blend(SLOT.mid, SLOT.accent, 1 - b.depth);
      opacity[i] = Math.round((0.35 + 0.65 * (1 - b.depth)) * 255);
    }
  }
}
