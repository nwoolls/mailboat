import { EnvelopeScene } from "./envelopes";
import { FireflyScene } from "./fireflies";
import { FireworksScene } from "./fireworks";
import { JellyfishScene } from "./jellyfish";
import { KoiScene } from "./koi";
import { LavaScene } from "./lava";
import { LifeScene } from "./life";
import { DEFAULT_PALETTE, type PaletteId, paletteFor } from "./palettes";
import { RainScene } from "./rain";
import { SAND_CELL_PX, SandscapeScene } from "./sand";
import { StarfieldScene } from "./starfield";
import { type Rng, type Scene, SCENE_CELL_PX, type SceneSetup } from "./scene";

/** The screensavers, in the order Settings and the palette list them. */
export const SCREENSAVERS = [
  {
    id: "sandscape",
    label: "Sandscape",
    make: (s: SceneSetup) => new SandscapeScene(s),
    cellPx: SAND_CELL_PX,
  },
  {
    id: "envelopes",
    label: "Envelope flock",
    make: (s: SceneSetup) => new EnvelopeScene(s),
    // Finer than the rest: at 3px the flock moved in visible steps.
    cellPx: 2,
  },
  {
    id: "life",
    label: "Life",
    make: (s: SceneSetup) => new LifeScene(s),
    // Screen-pixel cells, so each Life cell can be a tile with a gap (UX Spike 4).
    cellPx: 1,
  },
  {
    id: "rain",
    label: "Rain on glass",
    make: (s: SceneSetup) => new RainScene(s),
    // Finer, so drops can be drawn as lenses (UX Spike 4).
    cellPx: 2,
  },
  {
    id: "koi",
    label: "Koi pond",
    make: (s: SceneSetup) => new KoiScene(s),
    // Finer, so each koi can be drawn with shading, patches and fins
    // (owner, 2026-10-26: "make the koi pond higher res").
    cellPx: 2,
  },
  {
    id: "fireflies",
    label: "Fireflies",
    make: (s: SceneSetup) => new FireflyScene(s),
    // Finer, so each flash can glow softly (UX Spike 4).
    cellPx: 2,
  },
  {
    id: "lava",
    label: "Lava lamp",
    make: (s: SceneSetup) => new LavaScene(s),
    // Finer, so the wax can be shaded round (UX Spike 4).
    cellPx: 2,
  },
  {
    id: "jellyfish",
    label: "Jellyfish",
    make: (s: SceneSetup) => new JellyfishScene(s),
    // Fine enough for translucent bells and thin tentacles.
    cellPx: 2,
  },
  {
    id: "starfield",
    label: "Starfield",
    make: (s: SceneSetup) => new StarfieldScene(s),
    cellPx: 2,
  },
  {
    id: "fireworks",
    label: "Fireworks",
    make: (s: SceneSetup) => new FireworksScene(s),
    cellPx: 2,
  },
] as const satisfies readonly {
  id: string;
  label: string;
  make: (s: SceneSetup) => Scene;
  cellPx?: number;
}[];

export type SceneId = (typeof SCREENSAVERS)[number]["id"];

export function makeScene(id: SceneId, setup: SceneSetup): Scene {
  return SCREENSAVERS.find((s) => s.id === id)!.make(setup);
}

/** Screen pixels per cell for a scene: SCENE_CELL_PX unless it asks for finer. */
export function cellPxOf(id: SceneId): number {
  const entry = SCREENSAVERS.find((s) => s.id === id)!;
  return "cellPx" in entry ? entry.cellPx : SCENE_CELL_PX;
}

/** How long without input before the screensaver starts. */
export const SCREENSAVER_IDLE_SECONDS = 60;
/** With "Random" chosen, how often a running screensaver changes scene. */
export const SCREENSAVER_ROTATE_MINUTES = 60;
/**
 * Window event that starts the screensaver now (the palette's commands).
 * Its `detail` may name a scene; otherwise the chosen one plays.
 */
export const SCREENSAVER_EVENT = "app:screensaver";

/** Which screensaver plays, and in which colours (Settings → Toybox). */
export type ScreensaverPrefs = { choice: SceneId | "random"; palette: PaletteId };
export const DEFAULT_SCREENSAVER_PREFS: ScreensaverPrefs = {
  choice: "random",
  palette: DEFAULT_PALETTE,
};
export const SCREENSAVER_PREFS_KEY = "prefs.screensaver";

/** Saved preferences; anything missing or unknown is the default. */
export function parsePrefs(raw: string | null): ScreensaverPrefs {
  let saved: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === "object") saved = parsed as Record<string, unknown>;
  } catch {
    // Fall through to the defaults.
  }
  const choice = SCREENSAVERS.find((s) => s.id === saved.choice)?.id ?? "random";
  return { choice, palette: paletteFor(saved.palette) };
}

/**
 * The scene to play: the one asked for, the chosen one, or (for "random")
 * any but the one that played last, so it changes each time.
 */
export function pickScene(
  asked: SceneId | null,
  choice: ScreensaverPrefs["choice"],
  last: SceneId | null,
  rng: Rng,
): SceneId {
  if (asked) return asked;
  if (choice !== "random") return choice;
  const pool = SCREENSAVERS.map((s) => s.id).filter((id) => id !== last);
  return pool[Math.floor(rng() * pool.length)]!;
}

export function isSceneId(v: unknown): v is SceneId {
  return SCREENSAVERS.some((s) => s.id === v);
}
