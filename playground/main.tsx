/**
 * The Toybox playground (`bun run playground`): the app's real empty view in
 * a browser, with dials for every number its look depends on, to tune by
 * eye and copy the values back into the code. Development only; nothing
 * here ships, and the app always draws with the defaults in the code.
 *
 * Each look has a panel: its tuning object's defaults, its setter, and its
 * dials (`ASCII_GLOW_DEFAULTS`, `ASCII_POND_DEFAULTS`). Another joins by
 * exporting the same from its model and adding a `Panel` below.
 */
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../src/styles/index.css";
import { EmptyState } from "../src/features/mailbox/ui/EmptyState";
import {
  ASCII_GLOW_DEFAULTS,
  type AsciiGlowTuning,
  setAsciiGlowTuning,
} from "../src/features/mailbox/model/asciiGlow";
import {
  GLOW_MOTION_DEFAULTS,
  type GlowMotion,
  setGlowMotion,
} from "../src/features/mailbox/model/glow";
import {
  PIXEL_GLOW_DEFAULTS,
  type PixelGlowTuning,
  setPixelGlowTuning,
} from "../src/features/mailbox/model/pixelGlow";
import {
  PIXEL_POND_DEFAULTS,
  type PixelPondTuning,
  setPixelPondTuning,
} from "../src/features/emptyToys/model/pixelPond";
import {
  ASCII_POND_DEFAULTS,
  type AsciiPondTuning,
  setAsciiPondTuning,
} from "../src/features/emptyToys/model/asciiPond";
import {
  POND_STIR_DEFAULTS,
  type PondStir,
  setPondStir,
} from "../src/features/emptyToys/model/pond";
import {
  ASCII_SKY_DEFAULTS,
  type AsciiSkyTuning,
  setAsciiSkyTuning,
} from "../src/features/emptyToys/model/asciiSky";
import { setSkyHourOverride } from "../src/features/emptyToys/model/sky";
import {
  SKY_SCENE_DEFAULTS,
  type SkySceneTuning,
  setSkySceneTuning,
} from "../src/features/emptyToys/model/skyScene";
import {
  BUBBLE_DEFAULTS,
  type BubbleTuning,
  setBubbleTuning,
} from "../src/features/emptyToys/model/bubblePop";
import { emptyToy, toyboxStyle } from "../src/features/emptyToys/ui/prefs";
import {
  SCREENSAVER_EVENT,
  SCREENSAVER_STOP_EVENT,
  SCREENSAVERS,
  type SceneId,
  setScreensaverSticky,
} from "../src/features/screensaver/model/catalog";
import { PALETTES } from "../src/features/screensaver/model/palettes";
import { screensaverPrefs } from "../src/features/screensaver/ui/prefs";
import {
  DEEP_JELLY_DEFAULTS,
  type DeepJellyTuning,
  setDeepJellyTuning,
} from "../src/features/screensaver/model/deepJellies";
import {
  DEEP_STAR_DEFAULTS,
  type DeepStarTuning,
  setDeepStarTuning,
} from "../src/features/screensaver/model/deepStars";
import {
  RESTYLED,
  SCREENSAVER_LOOK_DEFAULTS,
  type ScreensaverLookTuning,
  setScreensaverLookTuning,
} from "../src/features/screensaver/model/looks";
import { setFeatureFlag } from "../src/shared/lib/featureFlags";
import { ACCENTS } from "../src/features/settings/model/appearance";

// ASCII art, and no screensaver taking over after a minute.
setFeatureFlag("screensavers", false);
// A screensaver keeps playing through clicks here, so its controls work.
setScreensaverSticky(true);
toyboxStyle.set("ascii");

/** One dial: a number in a tuning, its range and what it does. */
type Dial<T> = { key: keyof T & string; min: number; max: number; step: number; hint: string };
type Sections<T> = readonly { title: string; dials: readonly Dial<T>[] }[];
/** A text field in a tuning (a character ramp, a single character). */
type Field<T> = { key: keyof T & string; hint: string };

const GLOW_DIALS: Sections<AsciiGlowTuning> = [
  {
    title: "Grid",
    dials: [
      { key: "fontPx", min: 8, max: 20, step: 1, hint: "character size, px" },
      { key: "lineHeight", min: 1, max: 2, step: 0.05, hint: "cell height ÷ size" },
      { key: "gridDark", min: 0, max: 0.1, step: 0.005, hint: "grid lines, dark" },
      { key: "gridLight", min: 0, max: 0.1, step: 0.005, hint: "grid lines, light" },
    ],
  },
  {
    title: "Shape",
    dials: [
      { key: "radiusScale", min: 0.4, max: 2, step: 0.05, hint: "size, × the glow's" },
      { key: "reach", min: 0.8, max: 1.6, step: 0.05, hint: "edge reach" },
      { key: "wobble", min: 0, max: 0.3, step: 0.01, hint: "edge breathing" },
      { key: "cutoff", min: 0, max: 0.4, step: 0.01, hint: "faintest cell drawn" },
    ],
  },
  {
    title: "Motion",
    dials: [
      { key: "wakeSeconds", min: 0, max: 3, step: 0.05, hint: "trail fade, s" },
      { key: "wakeStrength", min: 0, max: 1, step: 0.05, hint: "trail brightness" },
      { key: "jitter", min: 0, max: 4, step: 0.1, hint: "character scatter" },
      { key: "shimmerBase", min: 0, max: 3, step: 0.05, hint: "shimmer, dim cells" },
      { key: "shimmerGain", min: 0, max: 6, step: 0.1, hint: "shimmer, bright cells" },
    ],
  },
  {
    title: "Hot core",
    dials: [
      { key: "hotAt", min: 0.5, max: 1.01, step: 0.01, hint: "flip above (1.01 = never)" },
      { key: "hotShare", min: 0, max: 1, step: 0.05, hint: "share that flips" },
      { key: "hotTileDark", min: 0, max: 1, step: 0.05, hint: "flipped tile, dark" },
      { key: "hotTileLight", min: 0, max: 1, step: 0.05, hint: "flipped tile, light" },
      { key: "hotMixDark", min: 0, max: 1, step: 0.05, hint: "accent → text, dark" },
      { key: "hotMixLight", min: 0, max: 1, step: 0.05, hint: "accent → text, light" },
    ],
  },
  {
    title: "Tiles and characters",
    dials: [
      { key: "tileBaseDark", min: 0, max: 0.6, step: 0.01, hint: "tile, dim, dark" },
      { key: "tileGainDark", min: 0, max: 1, step: 0.01, hint: "tile, bright, dark" },
      { key: "tileBaseLight", min: 0, max: 0.6, step: 0.01, hint: "tile, dim, light" },
      { key: "tileGainLight", min: 0, max: 1, step: 0.01, hint: "tile, bright, light" },
      { key: "glyphBase", min: 0, max: 1, step: 0.05, hint: "character, dim" },
      { key: "glyphGain", min: 0, max: 1, step: 0.05, hint: "character, bright" },
    ],
  },
  {
    title: "Clearing round the icon",
    dials: [
      { key: "iconPad", min: 0, max: 40, step: 1, hint: "fully clear within, px" },
      { key: "iconFeather", min: 0, max: 120, step: 1, hint: "soft edge, px" },
      { key: "iconFloor", min: 0, max: 1, step: 0.05, hint: "left inside (0 = none)" },
      { key: "iconRadius", min: 0, max: 40, step: 1, hint: "corner roundness, px" },
    ],
  },
  {
    title: "Clearing round the words",
    dials: [
      { key: "wordsPad", min: 0, max: 30, step: 1, hint: "fully clear within, px" },
      { key: "wordsFeather", min: 0, max: 80, step: 1, hint: "soft edge, px" },
      { key: "wordsFloor", min: 0, max: 1, step: 0.05, hint: "left inside (0 = none)" },
      { key: "wordsRadius", min: 0, max: 30, step: 1, hint: "corner roundness, px" },
      { key: "thin", min: 0, max: 1, step: 0.05, hint: "thin (1) or fade (0), both" },
    ],
  },
];

const MOTION_DIALS: Sections<GlowMotion> = [
  {
    title: "Following the pointer",
    dials: [
      { key: "glideSeconds", min: 0.02, max: 0.6, step: 0.01, hint: "arriving: glide, s" },
      { key: "holdSeconds", min: 0, max: 0.3, step: 0.005, hint: "holding: looseness, s" },
      { key: "catchSeconds", min: 0, max: 2, step: 0.05, hint: "glide → hold over, s" },
      { key: "lingerSeconds", min: 0, max: 5, step: 0.1, hint: "lingers after leaving, s" },
      { key: "returnSeconds", min: 0.1, max: 3, step: 0.05, hint: "drifting home, s" },
    ],
  },
];

const PIXEL_GLOW_DIALS: Sections<PixelGlowTuning> = [
  {
    title: "Pixels",
    dials: [
      { key: "pixel", min: 2, max: 14, step: 1, hint: "pixel size, px" },
      { key: "bands", min: 2, max: 12, step: 1, hint: "bands" },
      { key: "dither", min: 0, max: 1.5, step: 0.05, hint: "dithering" },
      { key: "peakDark", min: 0, max: 1, step: 0.01, hint: "brightest, dark" },
      { key: "peakLight", min: 0, max: 1, step: 0.01, hint: "brightest, light" },
      { key: "radiusScale", min: 0.4, max: 2, step: 0.05, hint: "size, × the glow's" },
      { key: "bloom", min: 0, max: 1.5, step: 0.05, hint: "soft glow underneath" },
      { key: "wakeSeconds", min: 0, max: 3, step: 0.05, hint: "trail fade, s" },
      { key: "wakeStrength", min: 0, max: 1, step: 0.05, hint: "trail brightness" },
    ],
  },
];

const GLOW_FIELDS: readonly Field<AsciiGlowTuning>[] = [
  { key: "ramp", hint: "ramp, faint → dense (first is empty)" },
];

const POND_DIALS: Sections<AsciiPondTuning> = [
  {
    title: "Water",
    dials: [
      { key: "crestGain", min: 0.5, max: 10, step: 0.1, hint: "lit slopes, brightness" },
      { key: "troughGain", min: 0, max: 10, step: 0.1, hint: "dark slopes, strength" },
      { key: "cutoff", min: 0, max: 0.5, step: 0.01, hint: "calmest water drawn" },
      { key: "jitter", min: 0, max: 4, step: 0.1, hint: "character scatter" },
      { key: "troughAlpha", min: 0, max: 1, step: 0.05, hint: "dark slope characters" },
    ],
  },
  {
    title: "Hot crests",
    dials: [
      { key: "hotAt", min: 0.3, max: 1.01, step: 0.01, hint: "flip above (1.01 = never)" },
      { key: "hotShare", min: 0, max: 1, step: 0.05, hint: "share that flips" },
    ],
  },
  {
    title: "Tiles and characters",
    dials: [
      { key: "tileBaseDark", min: 0, max: 0.6, step: 0.01, hint: "tile, dim, dark" },
      { key: "tileGainDark", min: 0, max: 1, step: 0.01, hint: "tile, bright, dark" },
      { key: "tileBaseLight", min: 0, max: 0.6, step: 0.01, hint: "tile, dim, light" },
      { key: "tileGainLight", min: 0, max: 1, step: 0.01, hint: "tile, bright, light" },
      { key: "glyphBase", min: 0, max: 1, step: 0.05, hint: "character, dim" },
      { key: "glyphGain", min: 0, max: 1, step: 0.05, hint: "character, bright" },
    ],
  },
  {
    title: "Splash",
    dials: [
      { key: "plopCols", min: 0, max: 8, step: 1, hint: "plop, cells across" },
      { key: "plopRows", min: 0, max: 4, step: 1, hint: "plop, cells down" },
    ],
  },
];

const SCENE_DIALS: Sections<SkySceneTuning> = [
  {
    title: "Pixels",
    dials: [
      { key: "pixel", min: 2, max: 12, step: 1, hint: "pixel size, px (pixel art)" },
      { key: "opacityDark", min: 0.2, max: 1, step: 0.02, hint: "how solid, dark" },
      { key: "opacityLight", min: 0.2, max: 1, step: 0.02, hint: "how solid, light" },
      { key: "skyBands", min: 2, max: 16, step: 1, hint: "sky bands" },
      { key: "dither", min: 0, max: 1.5, step: 0.05, hint: "dithering" },
      { key: "bloom", min: 0, max: 1.5, step: 0.05, hint: "glow around lights" },
    ],
  },
  {
    title: "Land",
    dials: [
      { key: "mountainsAt", min: 0.3, max: 0.95, step: 0.01, hint: "mountains begin, from top" },
      { key: "mountainHeight", min: 0, max: 0.4, step: 0.01, hint: "mountain height" },
      { key: "hillsAt", min: 0.3, max: 0.98, step: 0.01, hint: "hills begin" },
      { key: "grassAt", min: 0.3, max: 1, step: 0.01, hint: "grass begins" },
      { key: "parallax", min: 0, max: 8, step: 0.25, hint: "depth with the pointer, cells" },
    ],
  },
  {
    title: "Sky",
    dials: [
      { key: "clouds", min: 0, max: 14, step: 1, hint: "clouds" },
      { key: "cloudSize", min: 6, max: 80, step: 1, hint: "cloud size, cells" },
      { key: "cloudWind", min: 0, max: 6, step: 0.1, hint: "drift, cells/s" },
      { key: "stars", min: 0, max: 80, step: 1, hint: "stars per 1000 cells" },
      { key: "sparkles", min: 0, max: 1, step: 0.02, hint: "share that sparkle" },
      { key: "sunRadius", min: 2, max: 16, step: 0.5, hint: "sun radius, cells" },
      { key: "moonRadius", min: 2, max: 16, step: 0.5, hint: "moon radius, cells" },
    ],
  },
];

const SKY_DIALS: Sections<AsciiSkyTuning> = [
  {
    title: "ASCII",
    dials: [
      { key: "washDark", min: 0, max: 1, step: 0.02, hint: "sky wash, dark" },
      { key: "washLight", min: 0, max: 1, step: 0.02, hint: "sky wash, light" },
      { key: "tileDark", min: 0, max: 1, step: 0.02, hint: "tiles, dark" },
      { key: "tileLight", min: 0, max: 1, step: 0.02, hint: "tiles, light" },
      { key: "glyphLift", min: 0, max: 1, step: 0.05, hint: "characters, toward the text color" },
    ],
  },
];

const PIXEL_POND_DIALS: Sections<PixelPondTuning> = [
  {
    title: "Pixels",
    dials: [
      { key: "pixel", min: 2, max: 14, step: 1, hint: "pixel size, px" },
      { key: "crestBands", min: 1, max: 10, step: 1, hint: "lit water, bands" },
      { key: "troughBands", min: 0, max: 6, step: 1, hint: "dark water, bands" },
      { key: "crestGain", min: 0.5, max: 12, step: 0.1, hint: "lit slopes, brightness" },
      { key: "troughGain", min: 0, max: 12, step: 0.1, hint: "dark slopes, strength" },
      { key: "cutoff", min: 0, max: 0.5, step: 0.01, hint: "calmest water drawn" },
      { key: "dither", min: 0, max: 1.5, step: 0.05, hint: "dithering" },
      { key: "crestPeak", min: 0, max: 1, step: 0.01, hint: "brightest lit band" },
      { key: "troughPeak", min: 0, max: 1, step: 0.01, hint: "darkest dark band" },
      { key: "bloom", min: 0, max: 1.5, step: 0.05, hint: "glow around the splash" },
    ],
  },
];

const BUBBLE_DIALS: Sections<BubbleTuning> = [
  {
    title: "The pop",
    dials: [
      { key: "pixel", min: 2, max: 14, step: 1, hint: "pixel size, px (pixel art)" },
      { key: "squashSeconds", min: 0, max: 0.3, step: 0.01, hint: "squash before bursting, s" },
      { key: "flashSeconds", min: 0.02, max: 1, step: 0.01, hint: "flash ring, s" },
      { key: "bloom", min: 0, max: 1.5, step: 0.05, hint: "glow around the burst" },
    ],
  },
  {
    title: "Confetti",
    dials: [
      { key: "confetti", min: 0, max: 40, step: 1, hint: "pieces per pop" },
      { key: "speed", min: 50, max: 800, step: 10, hint: "thrown out, px/s" },
      { key: "gravity", min: 0, max: 3000, step: 50, hint: "gravity, px/s²" },
      { key: "confettiSeconds", min: 0.2, max: 3, step: 0.05, hint: "lasts, s" },
      { key: "puffs", min: 0, max: 10, step: 1, hint: "puffs of air" },
    ],
  },
  {
    title: "Neighbors and streaks",
    dials: [
      { key: "jiggle", min: 0, max: 0.5, step: 0.01, hint: "neighbors wobble" },
      { key: "jiggleReach", min: 0, max: 6, step: 0.25, hint: "wobble reaches, spacings" },
      { key: "streakSeconds", min: 0, max: 2, step: 0.05, hint: "a streak keeps going within, s" },
      { key: "streakBoost", min: 0, max: 1, step: 0.02, hint: "bigger per streak step" },
      { key: "streakMax", min: 0, max: 15, step: 1, hint: "streak steps, at most" },
    ],
  },
  {
    title: "Finale",
    dials: [
      { key: "refillSeconds", min: 0.2, max: 4, step: 0.1, hint: "fresh sheet after, s" },
      { key: "inflateSeconds", min: 0.1, max: 3, step: 0.05, hint: "inflating ripple, s" },
    ],
  },
];

const JELLY_DIALS: Sections<DeepJellyTuning> = [
  {
    title: "Jellyfish (restart to see some)",
    dials: [
      { key: "count", min: 1, max: 10, step: 1, hint: "how many (restart)" },
      { key: "size", min: 0.04, max: 0.3, step: 0.005, hint: "bell size" },
      { key: "tentacles", min: 0, max: 20, step: 1, hint: "tentacles" },
      { key: "tentacleLength", min: 0.5, max: 8, step: 0.1, hint: "tentacle length, bells" },
      { key: "sway", min: 0, max: 80, step: 1, hint: "tentacle sway, px" },
      { key: "armLength", min: 0, max: 4, step: 0.1, hint: "oral arms, bells" },
      { key: "pulseSeconds", min: 1, max: 10, step: 0.1, hint: "pulse, s" },
      { key: "drift", min: 0, max: 60, step: 1, hint: "rising, px/s" },
      { key: "depthFade", min: 0, max: 1, step: 0.05, hint: "farther dimmer, smaller" },
      { key: "motes", min: 0, max: 200, step: 2, hint: "glowing specks (restart)" },
      { key: "glow", min: 0, max: 1, step: 0.02, hint: "glow behind bells" },
      { key: "core", min: 0, max: 1, step: 0.05, hint: "warm core" },
      { key: "pixel", min: 2, max: 14, step: 1, hint: "pixel size (pixel art)" },
    ],
  },
];

const STAR_DIALS: Sections<DeepStarTuning> = [
  {
    title: "Starfield (restart to see some)",
    dials: [
      { key: "stars", min: 20, max: 800, step: 10, hint: "stars (restart)" },
      { key: "dust", min: 0, max: 400, step: 10, hint: "still dust (restart)" },
      { key: "speed", min: 0.02, max: 1, step: 0.01, hint: "cruising speed" },
      { key: "warpSpeed", min: 0.2, max: 4, step: 0.05, hint: "warp speed" },
      { key: "warpEvery", min: 3, max: 120, step: 1, hint: "a warp every, s" },
      { key: "warpSeconds", min: 1, max: 20, step: 0.5, hint: "warp lasts, s" },
      { key: "streak", min: 0, max: 30, step: 0.5, hint: "streak length" },
      { key: "steer", min: 0, max: 1, step: 0.05, hint: "steering with the pointer" },
      { key: "glow", min: 0, max: 1.5, step: 0.05, hint: "glow round the nearest" },
      { key: "nebula", min: 0, max: 0.6, step: 0.01, hint: "nebulas" },
      { key: "pixel", min: 2, max: 12, step: 1, hint: "pixel size (pixel art)" },
    ],
  },
];

const LOOK_DIALS: Sections<ScreensaverLookTuning> = [
  {
    title: "Pixel art",
    dials: [
      { key: "solidity", min: 0.1, max: 1, step: 0.05, hint: "how solid (restart to see)" },
      { key: "chunkPx", min: 2, max: 14, step: 1, hint: "block size, px" },
    ],
  },
  {
    title: "ASCII art",
    dials: [
      { key: "cutoff", min: 0, max: 0.5, step: 0.01, hint: "faintest cell drawn" },
      { key: "gain", min: 0.3, max: 4, step: 0.05, hint: "coverage boost" },
      { key: "tileBaseDark", min: 0, max: 0.6, step: 0.01, hint: "tile, faint, dark" },
      { key: "tileGainDark", min: 0, max: 1, step: 0.01, hint: "tile, covered, dark" },
      { key: "tileBaseLight", min: 0, max: 0.6, step: 0.01, hint: "tile, faint, light" },
      { key: "tileGainLight", min: 0, max: 1, step: 0.01, hint: "tile, covered, light" },
      { key: "hotAt", min: 0.3, max: 1.5, step: 0.01, hint: "flip above coverage" },
      { key: "hotBright", min: 0, max: 1, step: 0.02, hint: "flip only if this bright" },
      { key: "glyphLift", min: 0, max: 1, step: 0.05, hint: "characters, toward the text color" },
    ],
  },
];

const POND_FIELDS: readonly Field<AsciiPondTuning>[] = [
  { key: "crestRamp", hint: "lit water, faint → dense (first is empty)" },
  { key: "troughRamp", hint: "dark water, faint → dense (first is empty)" },
  { key: "dropletChar", hint: "droplet" },
  { key: "trailChar", hint: "droplet's trail" },
  { key: "plopChar", hint: "plop" },
];

const STIR_DIALS: Sections<PondStir> = [
  {
    title: "Following the pointer",
    dials: [
      { key: "stirDepth", min: 0, max: 3, step: 0.05, hint: "depth at full speed (0 = off)" },
      { key: "stirRadius", min: 0.5, max: 6, step: 0.1, hint: "width, cells" },
      { key: "stirEvery", min: 1, max: 30, step: 1, hint: "a stir every, cells moved" },
      { key: "stirFullSpeed", min: 50, max: 2000, step: 25, hint: "full depth at, cells/s" },
    ],
  },
];

/** Light or dark without touching the system setting: the same tokens `index.css` sets. */
const THEMES = {
  dark: {
    "--background-lightness": "9%",
    "--raised-lightness": "12%",
    "--content-lightness": "92%",
  },
  light: {
    "--background-lightness": "99%",
    "--raised-lightness": "97%",
    "--content-lightness": "12%",
  },
} as const;
type Theme = keyof typeof THEMES;

function applyTheme(theme: Theme, accent: string) {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(THEMES[theme])) root.style.setProperty(k, v);
  root.style.setProperty("--color-accent", accent);
  root.style.colorScheme = theme;
  document.body.style.background = theme === "dark" ? "hsl(240 4% 6%)" : "hsl(240 4% 93%)";
}

/** A tuning saved from an earlier visit, over the defaults; applied at once. */
function saved<T extends object>(key: string, defaults: T, apply: (t: T) => void): T {
  let t = defaults;
  try {
    const raw = localStorage.getItem(key);
    if (raw) t = { ...defaults, ...(JSON.parse(raw) as Partial<T>) };
  } catch {
    // The defaults.
  }
  apply(t);
  return t;
}

const glowStart = saved("playground.asciiGlow", ASCII_GLOW_DEFAULTS, setAsciiGlowTuning);
const pixelGlowStart = saved("playground.pixelGlow", PIXEL_GLOW_DEFAULTS, setPixelGlowTuning);
const motionStart = saved("playground.glowMotion", GLOW_MOTION_DEFAULTS, setGlowMotion);
const pondStart = saved("playground.asciiPond", ASCII_POND_DEFAULTS, setAsciiPondTuning);
const stirStart = saved("playground.pondStir", POND_STIR_DEFAULTS, setPondStir);
const bubbleStart = saved("playground.bubbles", BUBBLE_DEFAULTS, setBubbleTuning);
const jellyStart = saved("playground.deepJellies", DEEP_JELLY_DEFAULTS, setDeepJellyTuning);
const starStart = saved("playground.deepStars", DEEP_STAR_DEFAULTS, setDeepStarTuning);
const looksStart = saved(
  "playground.screensaverLooks",
  SCREENSAVER_LOOK_DEFAULTS,
  setScreensaverLookTuning,
);
const pixelPondStart = saved("playground.pixelPond", PIXEL_POND_DEFAULTS, setPixelPondTuning);
// The hour is the playground's own (`SkyHour`), never saved.
const skyStart = saved("playground.asciiSky", ASCII_SKY_DEFAULTS, setAsciiSkyTuning);
const sceneStart = saved("playground.skyScene", SKY_SCENE_DEFAULTS, setSkySceneTuning);

type Look = "glow" | "pond" | "sky" | "bubbles" | "screensavers";
const TOY_FOR: Record<Look, "glow" | "ripples" | "sky" | "bubbles" | "none"> = {
  glow: "glow",
  pond: "ripples",
  sky: "sky",
  bubbles: "bubbles",
  screensavers: "none",
};

function Playground() {
  const [look, setLook] = useState<Look>("glow");
  // Pixel or ASCII art, as Settings → Toybox → Style, to compare the two.
  const style = toyboxStyle.use();
  const { palette } = screensaverPrefs.use();
  // The screensaver playing, to highlight its button.
  const [playing, setPlaying] = useState<SceneId | null>(null);
  const [theme, setTheme] = useState<Theme>(() =>
    window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark",
  );
  const [accent, setAccent] = useState<string>(ACCENTS[0].color);
  // Hide the icon or words to see the clearing's shape on its own; the
  // glow still clears around them, as they're only made invisible.
  const [show, setShow] = useState({ icon: true, words: true, detail: false });
  // The pond: stones dropped every so often, so tuning needs no clicking.
  const [stones, setStones] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => applyTheme(theme, accent), [theme, accent]);
  useEffect(() => {
    // One look at a time: the glow, or the pond on its own.
    emptyToy.set(TOY_FOR[look]);
    // Screensavers only on their own tab, so one doesn't start over a toy after a minute.
    setFeatureFlag("screensavers", look === "screensavers");
  }, [look]);
  useEffect(() => {
    if (look !== "pond" || !stones) return;
    const drop = () => {
      const area = cardRef.current?.querySelector<HTMLElement>(".panel > div:last-child");
      if (!area) return;
      const r = area.getBoundingClientRect();
      area.dispatchEvent(
        new PointerEvent("pointerdown", {
          button: 0,
          clientX: r.left + r.width * (0.15 + Math.random() * 0.7),
          clientY: r.top + r.height * (0.15 + Math.random() * 0.7),
        }),
      );
    };
    drop();
    const timer = window.setInterval(drop, 1800);
    return () => window.clearInterval(timer);
  }, [look, stones]);

  return (
    <div
      className="playground flex h-full gap-4 p-4 text-[12px] text-content"
      data-hide-icon={!show.icon || undefined}
      data-hide-words={!show.words || undefined}
    >
      <style>{`
        .playground[data-hide-icon] .empty-rise > div:first-child,
        .playground[data-hide-words] .empty-words { visibility: hidden; }
      `}</style>
      <div ref={cardRef} className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {(["glow", "pond", "sky", "bubbles", "screensavers"] as const).map((l) => (
            <button key={l} type="button" className={chip(look === l)} onClick={() => setLook(l)}>
              {
                {
                  glow: "Glow",
                  pond: "Pond",
                  sky: "Sky",
                  bubbles: "Bubbles",
                  screensavers: "Screensavers",
                }[l]
              }
            </button>
          ))}
          <span className="w-2" />
          {(["pixel", "ascii"] as const).map((st) => (
            <button
              key={st}
              type="button"
              className={chip(style === st)}
              onClick={() => toyboxStyle.set(st)}
            >
              {st === "pixel" ? "Pixel" : "ASCII"}
            </button>
          ))}
          <span className="w-2" />
          {(["dark", "light"] as const).map((t) => (
            <button key={t} type="button" className={chip(theme === t)} onClick={() => setTheme(t)}>
              {t === "dark" ? "Dark" : "Light"}
            </button>
          ))}
          <span className="w-2" />
          {(
            [
              ["icon", "Icon"],
              ["words", "Words"],
              ["detail", "Second line"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={chip(show[k])}
              onClick={() => setShow({ ...show, [k]: !show[k] })}
            >
              {label}
            </button>
          ))}
          {look === "pond" && (
            <>
              <span className="w-2" />
              <button type="button" className={chip(stones)} onClick={() => setStones(!stones)}>
                Drop stones
              </button>
            </>
          )}
          <span className="w-2" />
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              type="button"
              title={a.label}
              aria-label={a.label}
              onClick={() => setAccent(a.color)}
              className="size-5 rounded-full"
              style={{
                background: a.color,
                outline: accent === a.color ? "2px solid var(--color-content)" : "none",
                outlineOffset: 2,
              }}
            />
          ))}
        </div>
        {/* The list card, as in the app; drag its corner to resize. */}
        <div
          className="panel"
          style={{
            display: "flex",
            flexDirection: "column",
            width: 760,
            height: 620,
            maxWidth: "100%",
            resize: "both",
            overflow: "hidden",
          }}
        >
          <div className="flex h-11 shrink-0 items-center px-4">
            <h2 data-card-title className="text-[14px] font-semibold">
              Inbox
            </h2>
          </div>
          <EmptyState
            state={{
              icon: "caughtUp",
              title: "All caught up",
              detail: show.detail ? "Nothing new in your Inbox." : undefined,
            }}
            swapKey="inbox"
          />
        </div>
      </div>

      <aside className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto">
        {look === "glow" && style === "pixel" ? (
          <Panel
            key="pixelGlow"
            title="Pixel glow"
            storageKey="playground.pixelGlow"
            defaults={PIXEL_GLOW_DEFAULTS}
            start={pixelGlowStart}
            apply={setPixelGlowTuning}
            fields={[]}
            sections={PIXEL_GLOW_DIALS}
          />
        ) : look === "glow" ? (
          <Panel
            key="glow"
            title="ASCII glow"
            storageKey="playground.asciiGlow"
            defaults={ASCII_GLOW_DEFAULTS}
            start={glowStart}
            apply={setAsciiGlowTuning}
            fields={GLOW_FIELDS}
            sections={GLOW_DIALS}
          />
        ) : look === "screensavers" ? (
          <>
            <section className="flex flex-col gap-2">
              <h2 className="text-[11px] tracking-wide text-content/50 uppercase">Start one</h2>
              <div className="flex flex-wrap gap-1">
                {SCREENSAVERS.map((sv) => (
                  <button
                    key={sv.id}
                    type="button"
                    className={chip(playing === sv.id)}
                    onClick={() => {
                      setPlaying(sv.id);
                      window.dispatchEvent(new CustomEvent(SCREENSAVER_EVENT, { detail: sv.id }));
                    }}
                  >
                    {sv.label}
                    {RESTYLED.has(sv.id) ? " ✦" : ""}
                  </button>
                ))}
                <button
                  type="button"
                  className={chip(false)}
                  onClick={() => {
                    setPlaying(null);
                    window.dispatchEvent(new Event(SCREENSAVER_STOP_EVENT));
                  }}
                >
                  Stop
                </button>
              </div>
              <div className="flex flex-wrap gap-1">
                {PALETTES.map((pal) => (
                  <button
                    key={pal.id}
                    type="button"
                    className={chip(palette === pal.id)}
                    onClick={() =>
                      screensaverPrefs.set({ ...screensaverPrefs.get(), palette: pal.id })
                    }
                  >
                    {pal.label}
                  </button>
                ))}
              </div>
              <p className="text-content/50">
                ✦ marks the restyled ones; the rest draw as before in either style. Here a
                screensaver keeps playing through clicks; Stop ends it.
              </p>
            </section>
            {playing === "jellyfish" && (
              <Panel
                key="jellies"
                title="Jellyfish"
                storageKey="playground.deepJellies"
                defaults={DEEP_JELLY_DEFAULTS}
                start={jellyStart}
                apply={setDeepJellyTuning}
                fields={[]}
                sections={JELLY_DIALS}
              />
            )}
            {playing === "starfield" && (
              <Panel
                key="stars"
                title="Starfield"
                storageKey="playground.deepStars"
                defaults={DEEP_STAR_DEFAULTS}
                start={starStart}
                apply={setDeepStarTuning}
                fields={[]}
                sections={STAR_DIALS}
              />
            )}
            <Panel
              key="looks"
              title="Screensaver looks"
              storageKey="playground.screensaverLooks"
              defaults={SCREENSAVER_LOOK_DEFAULTS}
              start={looksStart}
              apply={setScreensaverLookTuning}
              fields={[{ key: "ramp", hint: "ASCII ramp, faint → dense (first is empty)" }]}
              sections={LOOK_DIALS}
            />
          </>
        ) : look === "bubbles" ? (
          <Panel
            key="bubbles"
            title="Bubble wrap"
            note="Click a bubble, or hold and drag across a row. Pop them all for the finale. Pixel size is for pixel art; ASCII uses the glow's grid."
            storageKey="playground.bubbles"
            defaults={BUBBLE_DEFAULTS}
            start={bubbleStart}
            apply={setBubbleTuning}
            fields={[]}
            sections={BUBBLE_DIALS}
          />
        ) : look === "sky" ? (
          <>
            <SkyHour />
            <Panel
              key="scene"
              title="Sky scene"
              note="The scene both styles draw. Click for a shooting star at night, or a small cloud by day."
              storageKey="playground.skyScene"
              defaults={SKY_SCENE_DEFAULTS}
              start={sceneStart}
              apply={setSkySceneTuning}
              fields={[]}
              sections={SCENE_DIALS}
            />
            <Panel
              key="sky"
              title="ASCII sky"
              note="The character size and grid are the glow's (Glow → Grid)."
              storageKey="playground.asciiSky"
              defaults={ASCII_SKY_DEFAULTS}
              start={skyStart}
              apply={setAsciiSkyTuning}
              fields={[]}
              sections={SKY_DIALS}
            />
          </>
        ) : style === "pixel" ? (
          <Panel
            key="pixelPond"
            title="Pixel pond"
            storageKey="playground.pixelPond"
            defaults={PIXEL_POND_DEFAULTS}
            start={pixelPondStart}
            apply={setPixelPondTuning}
            fields={[]}
            sections={PIXEL_POND_DIALS}
          />
        ) : (
          <Panel
            key="pond"
            title="ASCII pond"
            note="The character size and grid are the glow's (Glow → Grid)."
            storageKey="playground.asciiPond"
            defaults={ASCII_POND_DEFAULTS}
            start={pondStart}
            apply={setAsciiPondTuning}
            fields={POND_FIELDS}
            sections={POND_DIALS}
          />
        )}
        {look === "glow" && (
          <Panel
            key="motion"
            title="Glow motion"
            note="How the glow moves, in every style: on a spring that glides over to the pointer, then tightens to hold on. Smaller is tighter."
            storageKey="playground.glowMotion"
            defaults={GLOW_MOTION_DEFAULTS}
            start={motionStart}
            apply={setGlowMotion}
            fields={[]}
            sections={MOTION_DIALS}
          />
        )}
        {look === "pond" && (
          <Panel
            key="stir"
            title="Pointer ripples"
            note="The water stirs faintly where the pointer moves, in pixel and ASCII art alike; a click still drops a stone. A depth of 0 turns it off."
            storageKey="playground.pondStir"
            defaults={POND_STIR_DEFAULTS}
            start={stirStart}
            apply={setPondStir}
            fields={[]}
            sections={STIR_DIALS}
          />
        )}
      </aside>
    </div>
  );
}

/** The time of day the sky shows: now, or an hour picked to see dawn, noon, dusk or night. */
function SkyHour() {
  const [hour, setHour] = useState<number | null>(null);
  // The real hour when the page opened, for the slider's place while it's "Now".
  const [opened] = useState(() => {
    const d = new Date();
    return d.getHours() + d.getMinutes() / 60;
  });
  const pick = (h: number | null) => {
    setHour(h);
    setSkyHourOverride(h);
  };
  const shown = hour ?? opened;
  const clock = `${Math.floor(shown)}:${String(Math.round((shown % 1) * 60) % 60).padStart(2, "0")}`;
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] tracking-wide text-content/50 uppercase">Time of day</h2>
        <button type="button" className={chip(hour === null)} onClick={() => pick(null)}>
          Now
        </button>
      </div>
      <label className="grid grid-cols-[1fr_auto] items-center gap-x-2">
        <span className="text-content/70">hour</span>
        <span className="font-mono text-content/50 tabular-nums">{clock}</span>
        <input
          className="col-span-2"
          type="range"
          min={0}
          max={23.75}
          step={0.25}
          value={shown}
          onChange={(e) => pick(Number(e.target.value))}
        />
      </label>
      <div className="flex flex-wrap gap-1">
        {(
          [
            ["Dawn", 6.5],
            ["Noon", 12.5],
            ["Dusk", 19.25],
            ["Night", 23],
          ] as const
        ).map(([label, h]) => (
          <button key={label} type="button" className={chip(hour === h)} onClick={() => pick(h)}>
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}

/** One look's dials, text fields and the values changed from its defaults. */
function Panel<T extends object>({
  title,
  note,
  storageKey,
  defaults,
  start,
  apply,
  fields,
  sections,
}: {
  title: string;
  note?: string;
  storageKey: string;
  defaults: T;
  start: T;
  apply: (t: T) => void;
  fields: readonly Field<T>[];
  sections: Sections<T>;
}) {
  const [tuning, setTuning] = useState(start);
  const values = tuning as Record<string, unknown>;
  const change = (next: T) => {
    setTuning(next);
    apply(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Not remembered; still applied.
    }
  };
  const changed = Object.fromEntries(
    Object.entries(tuning).filter(([k, v]) => (defaults as Record<string, unknown>)[k] !== v),
  );
  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-[14px] font-semibold">{title}</h1>
        <button type="button" className={chip(false)} onClick={() => change(defaults)}>
          Reset
        </button>
      </div>
      {note && <p className="text-content/50">{note}</p>}
      {fields.map((f) => (
        <label key={f.key} className="flex flex-col gap-1">
          <span className="text-content/60">{f.hint}</span>
          <input
            className="rounded border border-stroke bg-selection-subtle px-2 py-1 font-mono"
            value={String(values[f.key])}
            onChange={(e) => change({ ...tuning, [f.key]: e.target.value })}
          />
        </label>
      ))}
      {sections.map((section) => (
        <section key={section.title} className="flex flex-col gap-2">
          <h2 className="text-[11px] tracking-wide text-content/50 uppercase">{section.title}</h2>
          {section.dials.map((d) => (
            <label key={d.key} className="grid grid-cols-[1fr_auto] items-center gap-x-2">
              <span className="text-content/70">{d.hint}</span>
              <span className="font-mono text-content/50 tabular-nums">
                {Number(values[d.key])
                  .toFixed(3)
                  .replace(/\.?0+$/, "")}
              </span>
              <input
                className="col-span-2"
                type="range"
                min={d.min}
                max={d.max}
                step={d.step}
                value={Number(values[d.key])}
                onChange={(e) => change({ ...tuning, [d.key]: Number(e.target.value) })}
              />
            </label>
          ))}
        </section>
      ))}
      <section className="flex flex-col gap-1">
        <h2 className="text-[11px] tracking-wide text-content/50 uppercase">
          Changed from the defaults
        </h2>
        <textarea
          readOnly
          rows={6}
          className="rounded border border-stroke bg-selection-subtle p-2 font-mono text-[11px]"
          value={Object.keys(changed).length ? JSON.stringify(changed, null, 2) : "(nothing)"}
        />
        <span className="text-content/50">
          Paste this to the agent to make it the app's defaults.
        </span>
      </section>
    </>
  );
}

function chip(on: boolean): string {
  return `rounded-md border border-stroke px-2.5 py-1 ${on ? "bg-selection-strong" : "bg-selection-subtle"}`;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Playground />
  </StrictMode>,
);
