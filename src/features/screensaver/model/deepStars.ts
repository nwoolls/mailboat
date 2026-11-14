/**
 * The starfield screensaver in the Toybox's styles (UX Spike 5): flying
 * through space. Stars stream out from a vanishing point behind the icon,
 * nearer ones brighter, the fastest leaving streaks; faint dust twinkles in
 * place far behind, and a few very soft nebula clouds drift. Every so often
 * it goes to warp: the speed surges for a few seconds and every streak
 * lengthens (the icon nods as it starts), then eases back. The pointer
 * pulls the vanishing point toward it, like steering.
 *
 * Its own motion here, in pixels of the area (the generic restyle lost the
 * stars, a cell or two each, and kept only the nebula); drawn in chunky
 * pixel art or ASCII art by `ui/deepStarsDraw.ts`. The numbers are in
 * `DeepStarTuning`, for the playground; the app uses `DEEP_STAR_DEFAULTS`.
 */
export type DeepStarTuning = {
  /** How many stars fly past at once, and how many specks of dust stay put. */
  stars: number;
  dust: number;
  /** How fast they come (the far plane's depth per second), and at warp. */
  speed: number;
  warpSpeed: number;
  /** Seconds between warps (about), and how long a warp lasts. */
  warpEvery: number;
  warpSeconds: number;
  /** How long a streak is, as a share of how far the star moved in a frame's worth of time. */
  streak: number;
  /** How strongly the pointer steers the vanishing point (0 is not at all). */
  steer: number;
  /** The soft glow around the nearest stars, and the nebulas' strength (0 is none). */
  glow: number;
  nebula: number;
  /** Pixel art's block size, in screen pixels. */
  pixel: number;
};

export const DEEP_STAR_DEFAULTS: DeepStarTuning = {
  stars: 240,
  dust: 90,
  speed: 0.16,
  warpSpeed: 1.6,
  warpEvery: 45,
  warpSeconds: 6,
  streak: 6,
  steer: 0.35,
  glow: 0.5,
  nebula: 0.12,
  pixel: 4,
};

let tuning: DeepStarTuning = DEEP_STAR_DEFAULTS;

/** What the starfield uses; the defaults unless the playground changed it. */
export function deepStarTuning(): DeepStarTuning {
  return tuning;
}

/** For the playground only. */
export function setDeepStarTuning(next: DeepStarTuning) {
  tuning = next;
}

/** A star: across and up from the line of flight (−1 to 1 of the far plane), and how far (1 far, 0 here). */
export type Star = { x: number; y: number; z: number; tint: number };
export type Dust = { x: number; y: number; phase: number };
export type Nebula = { x: number; y: number; r: number; tint: number; drift: number };

export type Starfield = {
  stars: Star[];
  dust: Dust[];
  nebulas: Nebula[];
  width: number;
  height: number;
  time: number;
  /** The vanishing point now, and where it rests (behind the icon). */
  vx: number;
  vy: number;
  restX: number;
  restY: number;
  /** The speed now, and when the next warp starts and the current one ends. */
  speed: number;
  warpAt: number;
  warpUntil: number;
};

function newStar(rng: () => number, far: boolean): Star {
  return {
    x: (rng() * 2 - 1) * 1.1,
    y: (rng() * 2 - 1) * 1.1,
    z: far ? 0.85 + rng() * 0.15 : 0.05 + rng() * 0.95,
    tint: rng(),
  };
}

/** A starfield for an area `width` × `height`, its vanishing point at (restX, restY). */
export function makeStarfield(
  width: number,
  height: number,
  restX: number,
  restY: number,
  t: DeepStarTuning,
  rng: () => number,
): Starfield {
  return {
    stars: Array.from({ length: t.stars }, () => newStar(rng, false)),
    dust: Array.from({ length: t.dust }, () => ({
      x: rng() * width,
      y: rng() * height,
      phase: rng() * Math.PI * 2,
    })),
    nebulas: Array.from({ length: 3 }, (_, i) => ({
      x: width * (0.2 + rng() * 0.6),
      y: height * (0.2 + rng() * 0.6),
      r: Math.min(width, height) * (0.35 + rng() * 0.25),
      tint: i,
      drift: (rng() - 0.5) * 6,
    })),
    width,
    height,
    time: 0,
    vx: restX,
    vy: restY,
    restX,
    restY,
    speed: t.speed,
    warpAt: t.warpEvery * (0.75 + rng() * 0.5),
    warpUntil: -1,
  };
}

/** Where a star is on screen (and how near, 0–1 brightness-wise), from the vanishing point. */
export function project(f: Starfield, s: Star, z = s.z) {
  const reach = Math.max(f.width, f.height) * 0.55;
  const k = 1 / Math.max(0.02, z);
  return { x: f.vx + s.x * reach * k * 0.35, y: f.vy + s.y * reach * k * 0.35, near: 1 - z };
}

/**
 * Moves the starfield on by `dt`. `pointer` (pixels of the area) steers
 * the vanishing point. Returns whether a warp just began (to nod the icon).
 */
export function stepStars(
  f: Starfield,
  dt: number,
  pointer: { x: number; y: number } | null,
  t: DeepStarTuning,
  rng: () => number,
): boolean {
  f.time += dt;
  let began = false;
  if (f.time >= f.warpAt) {
    f.warpUntil = f.time + t.warpSeconds;
    f.warpAt = f.time + t.warpSeconds + t.warpEvery * (0.75 + rng() * 0.5);
    began = true;
  }
  // The speed eases up into a warp and back out of it.
  const want = f.time < f.warpUntil ? t.warpSpeed : t.speed;
  f.speed += (want - f.speed) * (1 - Math.exp(-dt * (want > f.speed ? 1.6 : 0.8)));
  // Steering: the vanishing point leans toward the pointer.
  const tx = pointer ? f.restX + (pointer.x - f.restX) * t.steer : f.restX;
  const ty = pointer ? f.restY + (pointer.y - f.restY) * t.steer : f.restY;
  f.vx += (tx - f.vx) * (1 - Math.exp(-dt * 1.5));
  f.vy += (ty - f.vy) * (1 - Math.exp(-dt * 1.5));
  for (let i = 0; i < f.stars.length; i++) {
    const s = f.stars[i]!;
    s.z -= f.speed * dt;
    const p = project(f, s);
    // Past us, or off the screen: a new one far away.
    if (s.z <= 0.03 || p.x < -40 || p.x > f.width + 40 || p.y < -40 || p.y > f.height + 40)
      f.stars[i] = newStar(rng, true);
  }
  for (const n of f.nebulas) n.x += n.drift * dt;
  return began;
}

/** How far a star moved on screen over `streak` frames' worth of time: where its streak starts. */
export function streakTail(f: Starfield, s: Star, t: DeepStarTuning) {
  return project(f, s, Math.min(1, s.z + f.speed * (t.streak / 60)));
}

/**
 * Fits the starfield to a resized area without starting over: the stars
 * keep flying (they're placed relative to the vanishing point), which moves
 * with its new rest behind the icon; dust and nebulas keep their place as a
 * share of the area.
 */
export function resizeStarfield(
  f: Starfield,
  width: number,
  height: number,
  restX: number,
  restY: number,
) {
  const kx = width / Math.max(1, f.width);
  const ky = height / Math.max(1, f.height);
  for (const d of f.dust) {
    d.x *= kx;
    d.y *= ky;
  }
  for (const n of f.nebulas) {
    n.x *= kx;
    n.y *= ky;
    n.r *= Math.min(width, height) / Math.max(1, Math.min(f.width, f.height));
  }
  f.vx += restX - f.restX;
  f.vy += restY - f.restY;
  f.restX = restX;
  f.restY = restY;
  f.width = width;
  f.height = height;
}
