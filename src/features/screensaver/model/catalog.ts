import { EnvelopeScene } from "./envelopes";
import { FireflyScene } from "./fireflies";
import { KoiScene } from "./koi";
import { LavaScene } from "./lava";
import { LifeScene } from "./life";
import { DEFAULT_PALETTE, type PaletteId, paletteFor } from "./palettes";
import { RainScene } from "./rain";
import { SandscapeScene } from "./sand";
import { type Rng, type Scene, SCENE_CELL_PX, type SceneSetup } from "./scene";

/** The screensavers, in the order Settings and the palette list them. */
export const SCREENSAVERS = [
  { id: "sandscape", label: "Sandscape", make: (s: SceneSetup) => new SandscapeScene(s) },
  {
    id: "envelopes",
    label: "Envelope flock",
    make: (s: SceneSetup) => new EnvelopeScene(s),
    // Finer than the rest: at 3px the flock moved in visible steps.
    cellPx: 2,
  },
  { id: "life", label: "Life", make: (s: SceneSetup) => new LifeScene(s) },
  { id: "rain", label: "Rain on glass", make: (s: SceneSetup) => new RainScene(s) },
  { id: "koi", label: "Koi pond", make: (s: SceneSetup) => new KoiScene(s) },
  { id: "fireflies", label: "Fireflies", make: (s: SceneSetup) => new FireflyScene(s) },
  { id: "lava", label: "Lava lamp", make: (s: SceneSetup) => new LavaScene(s) },
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
export const SCREENSAVER_PREFS_KEY = "mailboat.screensaver";

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
