import type { Rgb } from "./palettes";

/**
 * The jellyfish screensaver in the Toybox's styles (owner, 2026-11-13,
 * after ASCII jellyfish and manta ray examples: "the first jellyfish and
 * rays were more what I was thinking"). A few big jellies drift up through
 * a deep sea: a dense bell with a band of light near its rim and a soft
 * glow behind, a thick column of frilly oral arms, and long, thin
 * tentacles. Each has its own tint, and farther ones are smaller and
 * dimmer. Glowing specks drift among them.
 *
 * How they move (after the owner found turning them read as "a clock arm"
 * and formula-drawn tentacles didn't behave): a jelly leans very slowly
 * within a narrow range and surges the way it leans only while its bell
 * squeezes, coasting otherwise; the pointer and the icon push it, never
 * turn it. Its tentacles are chains of points hanging from the rim, each
 * point keeping a little of its momentum and held at a fixed distance from
 * the one before, so they trail behind any movement on their own, flaring
 * out as the bell squeezes and swaying gently. (Tentacles as chains is an
 * idea from a reference the owner shared; this is written from scratch.)
 *
 * Pure motion and shape here, in pixels of the area; drawn in chunky pixel
 * art or ASCII art by `ui/deepJelliesDraw.ts`. The numbers are in
 * `DeepJellyTuning`, for the playground; the app uses `DEEP_JELLY_DEFAULTS`.
 */
export type DeepJellyTuning = {
  /** How many jellies. */
  count: number;
  /** The nearest bell's radius, as a share of the area's smaller side. */
  size: number;
  /** Tentacle length, in bell radii, and how strongly they undulate (1 is normal). */
  tentacleLength: number;
  sway: number;
  /** How many tentacles a jelly has. */
  tentacles: number;
  /** Oral arms' length, in bell radii. */
  armLength: number;
  /** Seconds per pulse, and how hard a squeeze pushes (px/s at the front). */
  pulseSeconds: number;
  drift: number;
  /** How much dimmer and smaller the farthest jelly is (0 is the same as the nearest). */
  depthFade: number;
  /** Glowing specks drifting in the water. */
  motes: number;
  /** The soft glow behind a bell (0 is none). */
  glow: number;
  /** How warm a bell's core glows (0 is none). */
  core: number;
  /** Pixel art's block size, in screen pixels. */
  pixel: number;
};

export const DEEP_JELLY_DEFAULTS: DeepJellyTuning = {
  count: 4,
  size: 0.13,
  tentacleLength: 3.6,
  sway: 1,
  tentacles: 9,
  armLength: 1.9,
  pulseSeconds: 3.4,
  drift: 18,
  depthFade: 0.6,
  motes: 36,
  glow: 0.28,
  core: 0.55,
  pixel: 5,
};

let tuning: DeepJellyTuning = DEEP_JELLY_DEFAULTS;

/** What the jellies use; the defaults unless the playground changed it. */
export function deepJellyTuning(): DeepJellyTuning {
  return tuning;
}

/** For the playground only. */
export function setDeepJellyTuning(next: DeepJellyTuning) {
  tuning = next;
}

/** A point of a tentacle's chain, with where it was a step ago (its momentum). */
export type Link = { x: number; y: number; px: number; py: number };

/** A tentacle: where on the rim it hangs from (−1 to 1), its links, and its own phase and length. */
/**
 * A tentacle or an oral arm: where on the rim it hangs from (−1 to 1), its
 * links, its own phase, length and sway, and how wide it's drawn at its
 * root and tip (in bell radii): thick at the bell, thinning to the tip.
 */
export type Tentacle = {
  u: number;
  links: Link[];
  seed: number;
  length: number;
  sway: number;
  arm: boolean;
  w0: number;
  w1: number;
};

export type Jelly = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 0 near, 1 far. */
  depth: number;
  /** Where in its pulse it is (0–1), and how squeezed it was last step. */
  pulse: number;
  squeeze: number;
  /** Its own rhythm, a little different from the others'. */
  rate: number;
  /** Which tint (0 up), and its own phase for wandering. */
  tint: number;
  phase: number;
  /** Its lean from upright (radians, clockwise on screen): slow and narrow. */
  lean: number;
  /** Where it sits between its two hues (0–1): a swarm isn't one color. */
  hue: number;
  tentacles: Tentacle[];
};

export type Mote = { x: number; y: number; vy: number; phase: number; size: number };

export type Swarm = {
  jellies: Jelly[];
  motes: Mote[];
  width: number;
  height: number;
  time: number;
  /** Time not yet simulated (the chains step at a fixed rate). */
  owed: number;
};

/** A box to keep clear of (the icon, the words), in pixels of the area. */
export type Box = { x0: number; y0: number; x1: number; y1: number };

/** The chains step this many times a second, whatever the frame rate. */
const STEPS = 60;
/** Links per tentacle. */
const LINKS = 26;

/** A swarm for an area `width` × `height`, jellies spread out and at different depths. */
export function makeSwarm(
  width: number,
  height: number,
  t: DeepJellyTuning,
  rng: () => number,
): Swarm {
  const s: Swarm = { jellies: [], motes: [], width, height, time: 0, owed: 0 };
  for (let i = 0; i < t.count; i++) {
    const depth = t.count > 1 ? i / (t.count - 1) : 0;
    const j: Jelly = {
      x: width * ((i + 0.5) / t.count) + (rng() - 0.5) * width * 0.1,
      y: height * (0.3 + rng() * 0.6),
      vx: 0,
      vy: 0,
      depth,
      pulse: rng(),
      squeeze: 0,
      rate: 0.85 + rng() * 0.3,
      tint: i,
      phase: rng() * Math.PI * 2,
      lean: (rng() - 0.5) * 0.4,
      hue: (i * 0.37 + rng() * 0.2) % 1,
      tentacles: [],
    };
    hangTentacles(s, j, t, rng);
    s.jellies.push(j);
  }
  for (let i = 0; i < t.motes; i++)
    s.motes.push({
      x: rng() * width,
      y: rng() * height,
      vy: -(4 + rng() * 10),
      phase: rng() * Math.PI * 2,
      size: rng(),
    });
  return s;
}

/** Hangs a jelly's tentacles straight down from its rim (at the start, or coming back in). */
function hangTentacles(s: Swarm, j: Jelly, t: DeepJellyTuning, rng: () => number) {
  const r = bellRadius(s, j, t);
  j.tentacles = [];
  const add = (u: number, length: number, links: number, arm: boolean) => {
    const tentacle: Tentacle = {
      u,
      links: [],
      seed: rng() * Math.PI * 2,
      length,
      // Each its own: the arms a little stronger.
      sway: arm ? 1.1 + rng() * 0.5 : 0.6 + rng() * 0.8,
      arm,
      w0: arm ? 0.17 : 0.075,
      w1: arm ? 0.05 : 0.022,
    };
    const root = rimPoint(s, j, u, t);
    for (let k = 0; k < links; k++) {
      const y = root.y + (k * length) / (links - 1);
      tentacle.links.push({ x: root.x, y, px: root.x, py: y });
    }
    j.tentacles.push(tentacle);
  };
  // Long, thin tentacles from all along the rim.
  for (let n = 0; n < t.tentacles; n++) {
    const u = t.tentacles > 1 ? -0.92 + (1.84 * n) / (t.tentacles - 1) : 0;
    add(u, r * t.tentacleLength * (0.75 + 0.25 * rng()), LINKS, false);
  }
  // Four thick oral arms from the middle, shorter.
  for (const u of [-0.3, -0.1, 0.1, 0.3]) add(u, r * t.armLength * (0.85 + 0.3 * rng()), 12, true);
}

/** A jelly's scale for its depth: 1 at the front, smaller farther back. */
export function depthScale(j: Jelly, t: DeepJellyTuning): number {
  return 1 - j.depth * t.depthFade * 0.55;
}

/** How bright a jelly is for its depth: 1 at the front, dimmer farther back. */
export function depthLight(j: Jelly, t: DeepJellyTuning): number {
  return 1 - j.depth * t.depthFade;
}

/** The bell's radius, in pixels. */
export function bellRadius(s: Swarm, j: Jelly, t: DeepJellyTuning): number {
  return Math.min(s.width, s.height) * t.size * depthScale(j, t);
}

/**
 * How contracted the bell is now, 0 (relaxed) to 1: a quick squeeze in the
 * first fifth of the pulse, easing back over the rest.
 */
export function contraction(pulse: number): number {
  if (pulse < 0.2) return Math.sin((pulse / 0.2) * (Math.PI / 2));
  return Math.max(0, 1 - (pulse - 0.2) / 0.8) ** 2;
}

/** The bell's half-width and height now (narrower and taller while squeezed). */
function bellSize(s: Swarm, j: Jelly, t: DeepJellyTuning) {
  const r = bellRadius(s, j, t);
  const c = contraction(j.pulse);
  return { r, rw: r * (1 - 0.16 * c), rh: r * 0.95 * (1 + 0.12 * c), c };
}

/** A point on the bell's rim, `u` from −1 (left) to 1 (right), turned with its lean. */
export function rimPoint(s: Swarm, j: Jelly, u: number, t: DeepJellyTuning) {
  const { rw, rh } = bellSize(s, j, t);
  const lx = u * rw * 0.92;
  const ly = rh * 0.08;
  const cos = Math.cos(j.lean);
  const sin = Math.sin(j.lean);
  return { x: j.x + lx * cos - ly * sin, y: j.y + lx * sin + ly * cos };
}

/**
 * Moves the swarm on by `dt`. `pointer` is in pixels of the area (or
 * null); `keepClear` are the icon and words. Returns whether a jelly
 * bumped the icon (to nod it).
 */
export function step(
  s: Swarm,
  dt: number,
  pointer: { x: number; y: number } | null,
  keepClear: Box[],
  t: DeepJellyTuning,
  rng: () => number,
): boolean {
  let bumped = false;
  s.owed += Math.min(dt, 0.25);
  const h = 1 / STEPS;
  while (s.owed >= h) {
    s.owed -= h;
    s.time += h;
    for (const j of s.jellies) if (stepJelly(s, j, h, pointer, keepClear, t, rng)) bumped = true;
  }
  for (const m of s.motes) {
    m.y += m.vy * dt;
    m.x += Math.sin(s.time * 0.6 + m.phase) * 6 * dt;
    if (m.y < -4) {
      m.y = s.height + 4;
      m.x = rng() * s.width;
    }
  }
  return bumped;
}

function stepJelly(
  s: Swarm,
  j: Jelly,
  h: number,
  pointer: { x: number; y: number } | null,
  keepClear: Box[],
  t: DeepJellyTuning,
  rng: () => number,
): boolean {
  const { r } = bellSize(s, j, t);
  const scale = depthScale(j, t);
  let bumped = false;
  // The pulse: while the bell squeezes, it surges the way it leans.
  j.pulse = (j.pulse + (h * j.rate) / t.pulseSeconds) % 1;
  const c = contraction(j.pulse);
  const squeezing = c - j.squeeze;
  j.squeeze = c;
  const ux = Math.sin(j.lean);
  const uy = -Math.cos(j.lean);
  if (squeezing > 0) {
    const thrust = t.drift * 2.6 * scale;
    j.vx += ux * squeezing * thrust;
    j.vy += uy * squeezing * thrust;
  }
  // The pointer pushes it away (never turns it), and hurries a pulse.
  if (pointer) {
    const dx = j.x - pointer.x;
    const dy = j.y - pointer.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d < r * 2.2) {
      const push = (1 - d / (r * 2.2)) * t.drift * 1.8 * h;
      j.vx += (dx / d) * push;
      j.vy += (dy / d) * push;
      if (j.pulse > 0.4) j.pulse = 0.999;
    }
  }
  // Eased aside round the icon and words.
  for (const b of keepClear) {
    if (j.x < b.x0 - r || j.x > b.x1 + r || j.y < b.y0 - r * 0.6 || j.y > b.y1 + r * 1.5) continue;
    j.vx += (j.x < (b.x0 + b.x1) / 2 ? -1 : 1) * t.drift * 0.6 * h;
    if (j.y - r * 0.8 < b.y1 && j.y > b.y0 && j.vy < -t.drift * 0.4) bumped = true;
  }
  // Near a side, drift back in.
  if (j.x < r) j.vx += t.drift * 0.15 * h;
  if (j.x > s.width - r) j.vx -= t.drift * 0.15 * h;
  // Water drag; the slightest sideways wander.
  const drag = Math.exp(-h * 1.1);
  j.vx = j.vx * drag + Math.sin(s.time * 0.07 + j.phase) * 1.4 * h;
  j.vy *= drag;
  j.x += j.vx * h;
  j.y += j.vy * h;
  // Its lean: a slow wander within a narrow range, eased very gently.
  const want = Math.sin(s.time * 0.1 + j.phase) * 0.35;
  j.lean += (want - j.lean) * Math.min(1, h * 0.3);

  // The tentacles: each link keeps most of its momentum, is drawn back the
  // way the jelly came, sways, flares out as the bell squeezes, and is held
  // a link's length from the one before.
  const cos = Math.cos(j.lean);
  const sin = Math.sin(j.lean);
  for (const tentacle of j.tentacles) {
    const links = tentacle.links;
    const root = rimPoint(s, j, tentacle.u, t);
    links[0]!.x = root.x;
    links[0]!.y = root.y;
    links[0]!.px = root.x;
    links[0]!.py = root.y;
    const seg = tentacle.length / (links.length - 1);
    // Each push here builds up (a link keeps most of its motion), so they're small.
    const flare = tentacle.arm ? 0 : tentacle.u * c * 0.5;
    for (let k = 1; k < links.length; k++) {
      const q = links[k]!;
      const prev = links[k - 1]!;
      const f = k / links.length;
      // Water drag: a link keeps most, not all, of its motion.
      const vx = (q.x - q.px) * 0.86;
      const vy = (q.y - q.py) * 0.86;
      q.px = q.x;
      q.py = q.y;
      // Across the jelly (its own sideways): a wave travelling down the
      // tentacle (each link a little behind the one above), swinging more
      // toward the tip; and the flare.
      const across =
        Math.sin(s.time * 1.5 - k * 0.42 + tentacle.seed) *
          tentacle.sway *
          t.sway *
          (0.25 + f) *
          0.55 +
        flare * (1 - f);
      // Drawn back the way it came: harder while relaxed, coasting.
      const trail = (0.42 + 0.25 * (1 - c)) * scale;
      q.x += vx - ux * trail + cos * across;
      q.y += vy - uy * trail + sin * across;
      // The pointer brushes them aside a little.
      if (pointer) {
        const ex = q.x - pointer.x;
        const ey = q.y - pointer.y;
        const ed = Math.hypot(ex, ey) || 1;
        if (ed < 90) {
          q.x += (ex / ed) * (1 - ed / 90) * 2;
          q.y += (ey / ed) * (1 - ed / 90) * 2;
        }
      }
      const dx = q.x - prev.x;
      const dy = q.y - prev.y;
      const d = Math.hypot(dx, dy) || 1;
      q.x = prev.x + (dx / d) * seg;
      q.y = prev.y + (dy / d) * seg;
    }
  }

  // Gone off an edge, tentacles and all: back in from below.
  const tail = r * (t.tentacleLength + 1.2);
  if (j.y + tail < 0 || j.y - tail > s.height || j.x + tail < 0 || j.x - tail > s.width) {
    j.y = s.height + r * 1.2;
    j.x = s.width * (0.12 + rng() * 0.76);
    j.vx = 0;
    j.vy = 0;
    j.lean = (rng() - 0.5) * 0.3;
    hangTentacles(s, j, t, rng);
  }
  return bumped;
}

/** The bell now: where, how wide and tall (narrower and taller while squeezed), its lean. */
export function bellShape(s: Swarm, j: Jelly, t: DeepJellyTuning) {
  const { r, rw, rh, c } = bellSize(s, j, t);
  return { x: j.x, y: j.y, r, rw, rh, squeeze: c, lean: j.lean };
}

/** A jelly's box in pixels of the area: its bell, arms and every tentacle link lie inside. */
export function jellyBounds(s: Swarm, j: Jelly, t: DeepJellyTuning): Box {
  const r = bellRadius(s, j, t);
  const arm = r * (t.armLength + 0.4);
  let x0 = j.x - r * 1.3;
  let x1 = j.x + r * 1.3;
  let y0 = j.y - r * 1.3;
  let y1 = j.y + arm;
  // The arms, turned with the lean.
  const ax = j.x - Math.sin(j.lean) * arm;
  x0 = Math.min(x0, ax - r * 0.5);
  x1 = Math.max(x1, ax + r * 0.5);
  for (const tentacle of j.tentacles)
    for (const q of tentacle.links) {
      x0 = Math.min(x0, q.x);
      x1 = Math.max(x1, q.x);
      y0 = Math.min(y0, q.y);
      y1 = Math.max(y1, q.y);
    }
  return { x0, y0, x1, y1 };
}

/**
 * The two hues every jelly blends between (each its own blend, `Jelly.hue`),
 * from the palette: its accent, and its light color leaning to its mid.
 */
export function jellyHues(slots: readonly Rgb[]): [Rgb, Rgb] {
  const [, mid, light, , accent] = slots;
  return [
    accent ?? [92, 200, 230],
    light && mid ? mix(light, mid, 0.3) : (light ?? [160, 140, 250]),
  ];
}

export function mix(a: Rgb, b: Rgb, k: number): Rgb {
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
  ];
}
