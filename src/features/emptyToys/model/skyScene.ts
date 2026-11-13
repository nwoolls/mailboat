import type { Rgb } from "../../screensaver/model/palettes";
import { moonLit, noise } from "./asciiSky";
import { duskiness, nightness, skyAt, skyColorsAt } from "./sky";

/**
 * The Sky toy's scene (owner, 2026-11-13, with two pixel-art references: a
 * sunny valley and a night meadow): a sky in a few dithered bands, the sun
 * or tonight's moon on its arc, stars and sparkles at night, stepped
 * clouds, and land in front: bluish mountains with lit and shaded faces,
 * rolling hills, grass with lighter patches and tufts. Colors follow the
 * time of day.
 *
 * Described once, on a grid of scene cells (`sceneAt`), and drawn two ways:
 * as chunky pixels (`ui/PixelSky.tsx`, one scene cell per pixel block) and
 * as ASCII art (`ui/AsciiSky.tsx`, sampled at each character's cell).
 *
 * Every number the look depends on is in `SkySceneTuning`, for the
 * playground; the app always uses `SKY_SCENE_DEFAULTS`.
 */
export type SkySceneTuning = {
  /** Screen pixels per scene cell, in pixel art: chunkier as it grows. */
  pixel: number;
  /** How solid the scene is over the card, per theme (1 is fully). */
  opacityDark: number;
  opacityLight: number;
  /** Bands in the sky's gradient, and how much they dither into each other. */
  skyBands: number;
  dither: number;
  /** Where the land begins, as a share of the height from the top: mountains, hills, grass. */
  mountainsAt: number;
  hillsAt: number;
  grassAt: number;
  /** How tall the mountains rise above where they begin, as a share of the height. */
  mountainHeight: number;
  /** How far each layer moves with the pointer, in cells: far mountains, hills, grass, clouds. */
  parallax: number;
  /** Clouds: how many, how big (cells across), how fast they drift (cells/s). */
  clouds: number;
  cloudSize: number;
  cloudWind: number;
  /** Stars per 1000 cells, and the share that are four-point sparkles. */
  stars: number;
  sparkles: number;
  /** The sun's and moon's radius, in cells. */
  sunRadius: number;
  moonRadius: number;
  /** The soft glow around the sun, moon and sparkles (HD-2D light), 0 is none. */
  bloom: number;
};

export const SKY_SCENE_DEFAULTS: SkySceneTuning = {
  pixel: 5,
  opacityDark: 0.88,
  opacityLight: 0.92,
  skyBands: 6,
  dither: 1,
  mountainsAt: 0.8,
  hillsAt: 0.87,
  grassAt: 0.92,
  mountainHeight: 0.13,
  parallax: 2,
  clouds: 5,
  cloudSize: 26,
  cloudWind: 0.8,
  stars: 18,
  sparkles: 0.12,
  sunRadius: 6,
  moonRadius: 5,
  bloom: 0.6,
};

let tuning: SkySceneTuning = SKY_SCENE_DEFAULTS;

/** What the sky draws with; the defaults unless the playground changed it. */
export function skySceneTuning(): SkySceneTuning {
  return tuning;
}

/** For the playground only. */
export function setSkySceneTuning(next: SkySceneTuning) {
  tuning = next;
}

/** What a scene cell is made of. */
export type Material =
  | "sky"
  | "star"
  | "sparkle"
  | "sun"
  | "moon"
  | "cloud"
  | "mountain"
  | "hill"
  | "grass"
  | "flower";

export type Cell = {
  material: Material;
  color: Rgb;
  /**
   * The edge facing the sky (mountain, hill or grass top), a lit face (1)
   * or a shaded one (-1), or 0. Lets ASCII pick `^`, `/`, `\`, `"`.
   */
  edge: number;
  /** The slope there: positive rising to the right. */
  slope: number;
  /** How bright, 0–1, for stars, sparkles and the sun's and moon's parts. */
  glow: number;
};

/** The time of day, the moon and the moving parts, for one frame. */
export type SceneState = {
  hour: number;
  phase: number;
  seconds: number;
  /** The pointer's pull for parallax, −1 to 1 each way (0 at rest). */
  lookX: number;
  lookY: number;
  /** The sun or moon and where it is (`bodyAt`), worked out once a frame. */
  body: Body;
};

export type Body = { body: "sun" | "moon"; x: number; y: number; low: number };

export type Cloud = { x: number; y: number; w: number; h: number; speed: number; puffs: Puff[] };
type Puff = { dx: number; dy: number; r: number };

/** What doesn't change from frame to frame: the land's outline, the stars, the clouds. */
export type Scene = {
  cols: number;
  rows: number;
  mountain: Float32Array;
  hill: Float32Array;
  /** Which face of its peak or hill each column is on: 1 the left, −1 the right. */
  mountainFace: Int8Array;
  hillFace: Int8Array;
  grass: Float32Array;
  starSeed: Float32Array;
  clouds: Cloud[];
};

/** A ridge line's height at x (0–1): three layers of noise. */
function ridge(x: number, scale: number, seed: number): number {
  return (
    noise(x / scale, seed) * 0.6 +
    noise((x / scale) * 2.3, seed + 3) * 0.3 +
    noise((x / scale) * 5.1, seed + 7) * 0.1
  );
}

/** What a laid-out scene depends on: when this changes, lay it out again. */
export function sceneKey(cols: number, rows: number, t: SkySceneTuning): string {
  return [
    cols,
    rows,
    t.clouds,
    t.cloudSize,
    t.cloudWind,
    t.mountainsAt,
    t.hillsAt,
    t.grassAt,
    t.mountainHeight,
    t.parallax,
  ].join("/");
}

/** Lays out a scene of `cols` × `rows` cells, the same each time for the same size. */
export function buildScene(cols: number, rows: number, t: SkySceneTuning): Scene {
  const span = cols + t.parallax * 8;
  const mountain = new Float32Array(span);
  const hill = new Float32Array(span);
  const grass = new Float32Array(span);
  const mountainFace = new Int8Array(span);
  const hillFace = new Int8Array(span);
  let seed = 5;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  // Mountains: peaks, each a triangle with two faces, as in pixel art.
  const peaks = Array.from({ length: Math.max(3, Math.round(span / 16)) }, () => ({
    x: rnd() * span,
    h: rows * t.mountainHeight * (0.45 + rnd() * 0.55),
    k: 0.7 + rnd() * 0.5,
  }));
  // Hills: rounded humps.
  const humps = Array.from({ length: Math.max(2, Math.round(span / 26)) }, () => ({
    x: rnd() * span,
    h: rows * (0.03 + rnd() * 0.05),
    w: 14 + rnd() * 22,
  }));
  for (let x = 0; x < span; x++) {
    let top = 0;
    let face = 1;
    for (const p of peaks) {
      const rise = p.h - Math.abs(x - p.x) * p.k;
      if (rise > top) {
        top = rise;
        face = x < p.x ? 1 : -1;
      }
    }
    // A little roughness along the ridges.
    mountain[x] = rows * t.mountainsAt - top - (noise(x * 0.45, 2.5) - 0.5) * 1.6;
    mountainFace[x] = face;
    let bump = 0;
    let side = 1;
    for (const h of humps) {
      const d = (x - h.x) / h.w;
      if (Math.abs(d) >= 1) continue;
      const rise = h.h * (0.5 + 0.5 * Math.cos(d * Math.PI));
      if (rise > bump) {
        bump = rise;
        side = d < 0 ? 1 : -1;
      }
    }
    hill[x] = rows * t.hillsAt - bump;
    hillFace[x] = side;
    // Grass: a gentle swell, with tufts along the top.
    const tuft = noise(x * 0.9, 40.5) > 0.72 ? 1 : 0;
    grass[x] = rows * (t.grassAt - 0.02 * ridge(x, 40, 21.7)) - tuft;
  }
  const starSeed = new Float32Array(cols * rows);
  let s = 11;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  for (let i = 0; i < starSeed.length; i++) starSeed[i] = rand();
  const clouds: Cloud[] = [];
  for (let k = 0; k < t.clouds; k++) clouds.push(makeCloud(rand, rows, t, rand() * cols));
  return { cols, rows, mountain, hill, grass, mountainFace, hillFace, starSeed, clouds };
}

export function makeCloud(rand: () => number, rows: number, t: SkySceneTuning, x: number): Cloud {
  const w = t.cloudSize * (0.6 + rand() * 0.8);
  const h = w * (0.28 + rand() * 0.12);
  const puffs: Puff[] = [];
  const n = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++)
    puffs.push({
      dx: (i / (n - 1) - 0.5) * w * 0.75,
      dy: -rand() * h * 0.4,
      r: h * (0.45 + rand() * 0.4),
    });
  return {
    x,
    y: rows * (0.08 + rand() * (t.mountainsAt - 0.25)),
    w,
    h,
    speed: t.cloudWind * (0.6 + rand() * 0.8),
    puffs,
  };
}

/** Bayer 4×4: ordered dithering's thresholds, 0–1. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

/** The time of day's colors for the land and clouds, from day through dusk to night. */
function landColors(hour: number) {
  const night = nightness(hour);
  const dusk = duskiness(hour);
  const pick = (day: Rgb, warm: Rgb, dark: Rgb): Rgb =>
    mixRgb(mixRgb(day, warm, dusk * 0.55), dark, night);
  return {
    farLit: pick([102, 152, 160], [150, 120, 130], [44, 60, 86]),
    farShade: pick([80, 112, 132], [110, 86, 108], [32, 44, 70]),
    farDeep: pick([58, 72, 100], [76, 60, 86], [24, 32, 54]),
    hillLit: pick([122, 186, 160], [168, 150, 120], [40, 66, 70]),
    hillShade: pick([96, 150, 134], [130, 112, 100], [30, 52, 58]),
    grass: pick([128, 202, 120], [170, 170, 104], [34, 56, 52]),
    grassDark: pick([110, 170, 118], [140, 140, 96], [28, 46, 46]),
    grassLight: pick([182, 230, 136], [210, 200, 120], [48, 74, 66]),
    cloudLit: pick([220, 228, 242], [250, 210, 196], [64, 76, 112]),
    cloudMid: pick([200, 208, 224], [226, 180, 176], [50, 60, 94]),
    cloudShade: pick([172, 180, 198], [190, 146, 150], [38, 46, 78]),
    flower: [214, 220, 246] as Rgb,
  };
}

export type Palette = ReturnType<typeof landColors> & {
  top: Rgb;
  horizon: Rgb;
  night: number;
};

/** The frame's colors (once per frame, not per cell). */
export function paletteFor(hour: number): Palette {
  const { top, horizon } = skyColorsAt(hour);
  return { ...landColors(hour), top, horizon, night: nightness(hour) };
}

function cell(material: Material, color: Rgb, edge = 0, slope = 0, glow = 0): Cell {
  return { material, color, edge, slope, glow };
}

/**
 * What the scene shows at cell (x, y) (fractional, from the top left).
 * `p` is `paletteFor(state.hour)`.
 */
export function sceneAt(
  scene: Scene,
  x: number,
  y: number,
  state: SceneState,
  p: Palette,
  t: SkySceneTuning,
): Cell {
  const { rows, cols } = scene;
  const skyColorAt = (yy: number) =>
    mixRgb(p.top, p.horizon, Math.max(0, Math.min(1, yy / (rows * t.mountainsAt))));
  // The light comes from the sun's or moon's side: its faces are lit.
  const litLeft = state.body.x < cols / 2;
  const at = (heights: Float32Array, depth: number, faces?: Int8Array) => {
    const sx = Math.max(
      0,
      Math.min(heights.length - 2, x + t.parallax * 4 + state.lookX * t.parallax * depth),
    );
    const i = Math.floor(sx);
    const f = sx - i;
    const h = heights[i]! * (1 - f) + heights[i + 1]! * f + state.lookY * t.parallax * depth * 0.5;
    return { h, slope: heights[i]! - heights[i + 1]!, face: faces ? faces[Math.round(sx)]! : 0 };
  };

  // The land, nearest first.
  const g = at(scene.grass, 1.5);
  if (y >= g.h) {
    const top = y - g.h < 1;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    // Wide, flat patches, as grass seen across a field.
    const patch =
      noise(x / 16, y / 3.5 + 50) + (BAYER[(iy % 4) * 4 + (ix % 4)]! - 0.5) * 0.12 * t.dither;
    // Small pale flowers in the grass at night.
    if (p.night > 0.3 && scene.starSeed[(iy * cols + ix) % scene.starSeed.length]! < 0.012 && !top)
      return cell("flower", mixRgb(p.grass, p.flower, p.night * 0.8), 0, 0, p.night);
    const color = top
      ? p.grassLight
      : patch > 0.62
        ? p.grassLight
        : patch < 0.38
          ? p.grassDark
          : p.grass;
    return cell("grass", color, top ? 1 : 0, g.slope);
  }
  const hl = at(scene.hill, 1, scene.hillFace);
  if (y >= hl.h) {
    // Lit along the top, darker below, dithered between: no panels.
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const below = (y - hl.h) / 3;
    const lit = below < BAYER[(iy % 4) * 4 + (ix % 4)]! * t.dither + (1 - t.dither) * 0.5;
    const facing = hl.face > 0 === litLeft ? 1 : -1;
    return cell("hill", lit ? p.hillLit : p.hillShade, y - hl.h < 1 ? facing : 0, hl.slope);
  }
  const m = at(scene.mountain, 0.5, scene.mountainFace);
  if (y >= m.h) {
    const lit = m.face > 0 === litLeft;
    // Lower down, the mountains darken into the distance's haze, dithered.
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const low = (y - rows * (t.mountainsAt - t.mountainHeight * 0.35)) / (rows * 0.08);
    const deep = low > BAYER[(iy % 4) * 4 + (ix % 4)]! * t.dither + (1 - t.dither) * 0.5;
    const color = deep ? p.farDeep : lit ? p.farLit : p.farShade;
    return cell("mountain", color, y - m.h < 1 ? (lit ? 1 : -1) : 0, m.slope);
  }

  // The sun or moon, on its arc.
  const dx = x - state.body.x;
  const dy = y - state.body.y;
  const d = Math.hypot(dx, dy);
  if (state.body.body === "sun" && d < t.sunRadius) {
    const corner = Math.abs(Math.abs(dx) - Math.abs(dy)) < 1.2 && d > t.sunRadius - 1.6;
    const color: Rgb =
      d < t.sunRadius - 2 ? [255, 255, 250] : corner ? [168, 240, 240] : [255, 246, 150];
    return cell("sun", color, 0, 0, 1 - d / t.sunRadius);
  }
  if (state.body.body === "moon" && d < t.moonRadius) {
    const lit = moonLit(dx / t.moonRadius, dy / t.moonRadius, state.phase);
    const crater = noise(x * 0.9 + 300, y * 0.9) > 0.68;
    const color: Rgb = lit ? (crater ? [208, 212, 232] : [238, 240, 250]) : [58, 68, 102];
    return cell("moon", color, 0, 0, lit ? 1 : 0.15);
  }

  // Clouds, drifting and wrapping around.
  for (const c of scene.clouds) {
    const wrap = cols + c.w * 2;
    const cx =
      ((((c.x + state.seconds * c.speed + state.lookX * t.parallax * 0.3) % wrap) + wrap) % wrap) -
      c.w;
    const ux = x - cx;
    if (Math.abs(ux) > c.w) continue;
    const uy = y - c.y;
    let inside = false;
    let lift = 0;
    for (const puff of c.puffs) {
      const ex = (ux - puff.dx) / (puff.r * 1.7);
      const ey = (uy - puff.dy) / puff.r;
      const q = ex * ex + ey * ey;
      if (q < 1) {
        inside = true;
        lift = Math.max(lift, -ey);
      }
    }
    // A flat base, as clouds have.
    if (inside && uy < c.h * 0.35) {
      const shade = lift > 0.35 ? p.cloudLit : lift > -0.25 ? p.cloudMid : p.cloudShade;
      // At night, clouds are faint shapes against the sky.
      return cell("cloud", mixRgb(shade, skyColorAt(y), p.night * 0.45), 0, 0, lift);
    }
  }

  // The sky, in bands from the top's color to the horizon's, dithered.
  const depth = Math.max(0, Math.min(1, y / (rows * t.mountainsAt)));
  const sx = Math.floor(x);
  const sy = Math.floor(y);
  const threshold = (BAYER[(sy % 4) * 4 + (sx % 4)]! - 0.5) * t.dither;
  const band = Math.max(0, Math.min(t.skyBands - 1, Math.floor(depth * t.skyBands + threshold)));
  const skyColor = mixRgb(p.top, p.horizon, band / Math.max(1, t.skyBands - 1));

  // Stars and sparkles at night, fading into the sky as it lightens.
  if (p.night > 0) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const seed = scene.starSeed[iy * cols + ix] ?? 1;
    const share = t.stars / 1000;
    if (seed < share && y < rows * t.mountainsAt) {
      const twinkle = 0.55 + 0.45 * Math.sin(state.seconds * (1 + seed * 40) + seed * 900);
      const sparkle = seed < share * t.sparkles;
      const glow = p.night * twinkle;
      return cell(
        sparkle ? "sparkle" : "star",
        mixRgb(skyColor, [226, 236, 255], glow),
        0,
        0,
        glow,
      );
    }
    // A sparkle's four points, one cell out.
    for (const [ox, oy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const n = scene.starSeed[(iy + oy) * cols + (ix + ox)] ?? 1;
      if (n < share * t.sparkles && iy + oy < rows * t.mountainsAt) {
        const twinkle = 0.5 + 0.5 * Math.sin(state.seconds * (1 + n * 40) + n * 900);
        if (twinkle > 0.55) {
          const glow = p.night * (twinkle - 0.4);
          return cell("sparkle", mixRgb(skyColor, [190, 214, 255], glow * 1.4), 0, 0, glow);
        }
      }
    }
  }

  return cell("sky", skyColor);
}

/** The sky's color at row `y`, without bands or dithering (for drawing behind a star). */
export function skyColorAt(scene: Scene, y: number, p: Palette, t: SkySceneTuning): Rgb {
  return mixRgb(p.top, p.horizon, Math.max(0, Math.min(1, y / (scene.rows * t.mountainsAt))));
}

/** The sun's or moon's place in cells, and how low it is (0 high, 1 on the horizon). */
export function bodyAt(scene: Scene, hour: number, t: SkySceneTuning): Body {
  const sky = skyAt(hour);
  return {
    body: sky.body,
    x: scene.cols * (0.1 + sky.along * 0.8),
    y: scene.rows * (t.mountainsAt + 0.02 - sky.height * (t.mountainsAt - 0.08)),
    low: 1 - Math.min(1, sky.height / 0.35),
  };
}

export function mixRgb(a: Rgb, b: Rgb, k: number): Rgb {
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
  ];
}
