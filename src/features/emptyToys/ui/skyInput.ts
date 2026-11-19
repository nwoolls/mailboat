import {
  makeCloud,
  paletteFor,
  type Scene,
  skyIsDark,
  type SkySceneTuning,
} from "../model/skyScene";
import { skyHourOverride } from "../model/sky";
import { readAsciiColors } from "./asciiPaint";
import type { SceneLook } from "../../../shared/lib/sceneLook";

export type Shooting = { x: number; y: number; dx: number; dy: number; age: number };

/**
 * A sky carried through a resize (the layer's effect starts again at a new
 * size, and without this the scene was laid out afresh: clouds jumped back
 * and clicked ones went): the scene, the tuning it was laid out for, and
 * what the pointer added.
 */
export type SkyCarry = { scene: Scene; tunedFor: string; held: SkyHeld };
export type SkyHeld = {
  shooting: Shooting[];
  puffs: { at: number; cloud: Scene["clouds"][number] }[];
};

export const SHOOTING_SECONDS = 0.9;
/** Scene cells per second. */
export const SHOOTING_SPEED = 110;
const PUFF_SECONDS = 16;

/**
 * What the pointer does to the sky, in pixel art and ASCII art alike: the
 * land shifts a little with it (`look`, −1 to 1, eased by the caller), and
 * a click sends a shooting star at night or leaves a small cloud by day,
 * which drifts off with the others and goes after a while.
 */
export class SkyInput {
  readonly look = { x: 0, y: 0, tx: 0, ty: 0 };
  shooting: Shooting[] = [];
  private puffs: SkyHeld["puffs"] = [];

  constructor(
    private readonly card: HTMLElement,
    private readonly area: HTMLElement,
    private readonly layer: HTMLElement,
    /** The scene, its tuning, the screen pixels per scene cell, and whether it's night, now. */
    private readonly now: () => {
      scene: Scene | null;
      t: SkySceneTuning;
      unit: number;
      night: number;
    },
  ) {
    card.addEventListener("pointermove", this.move);
    card.addEventListener("pointerleave", this.leave);
    area.addEventListener("pointerdown", this.down);
  }

  dispose() {
    this.card.removeEventListener("pointermove", this.move);
    this.card.removeEventListener("pointerleave", this.leave);
    this.area.removeEventListener("pointerdown", this.down);
  }

  /** Moves shooting stars on and lets old puffs go; call once a frame. */
  step(dt: number, scene: Scene, nowMs: number) {
    this.shooting = this.shooting.filter((s) => (s.age += dt) < SHOOTING_SECONDS);
    while (this.puffs.length && nowMs - this.puffs[0]!.at > PUFF_SECONDS * 1000) {
      const gone = this.puffs.shift()!.cloud;
      scene.clouds = scene.clouds.filter((c) => c !== gone);
    }
  }

  /** What it holds across a resize: the shooting stars and the clouds left by clicks. */
  held(): SkyHeld {
    return { shooting: this.shooting, puffs: this.puffs };
  }

  /** Takes on what an earlier one held, as the scene carries on through a resize. */
  takeOn(held: SkyHeld) {
    this.shooting = held.shooting;
    this.puffs = held.puffs;
  }

  /** A scene was laid out afresh: earlier puffs are gone with the old one. */
  reset() {
    this.puffs = [];
  }

  private readonly move = (e: PointerEvent) => {
    const r = this.card.getBoundingClientRect();
    this.look.tx = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.look.ty = ((e.clientY - r.top) / r.height) * 2 - 1;
  };

  private readonly leave = () => {
    this.look.tx = 0;
    this.look.ty = 0;
  };

  private readonly down = (e: PointerEvent) => {
    const { scene, t, unit, night } = this.now();
    if (e.button !== 0 || !scene || window.matchMedia("(prefers-reduced-motion: reduce)").matches)
      return;
    const r = this.layer.getBoundingClientRect();
    const x = (e.clientX - r.left) / unit;
    const y = (e.clientY - r.top) / unit;
    if (night > 0.5) {
      const side = Math.random() < 0.5 ? -1 : 1;
      const a = 0.3 + Math.random() * 0.25;
      this.shooting.push({ x, y, dx: Math.cos(a) * side, dy: Math.sin(a), age: 0 });
      if (this.shooting.length > 4) this.shooting.shift();
      return;
    }
    const nowMs = performance.now();
    const cloud = makeCloud(Math.random, scene.rows, { ...t, cloudSize: t.cloudSize * 0.5 }, 0);
    // Under the pointer now; it drifts on from here (`driftClouds`).
    cloud.x = x;
    cloud.y = y;
    scene.clouds.push(cloud);
    this.puffs.push({ at: nowMs, cloud });
  };
}

/**
 * The sky behind the icon, words and title is dark at dusk and night and
 * bright by day (`skyIsDark`), whatever the page's theme, so their text follows the sky: light on
 * a night sky (`data-scene-night`, as the screensavers' night skies do),
 * dark on a day sky (`data-scene-day`). Only where it differs from the
 * page's own text (`shared/lib/sceneLook.ts` sets it).
 */
export function skyLook(skyDark: boolean, pageDark: boolean): SceneLook {
  return skyDark ? (pageDark ? null : "night") : pageDark ? "day" : null;
}

/**
 * The text that follows the sky, found from the sky's own canvas: the
 * card's title, and the wrapper around the empty state's icon and words
 * (`.empty-rise`), not the words themselves. The words are replaced on every
 * switch between empty views (keyed by view), and a new one started in the
 * page's color until the sky set it again; on the wrapper, new words take
 * its look as they appear (owner, 2026-11-19: the label and title went white,
 * black, white while switching).
 */
export function skyTextEls(canvas: HTMLElement | null): (HTMLElement | null)[] {
  const card = canvas?.closest<HTMLElement>(".panel");
  return [
    card?.querySelector<HTMLElement>(".empty-rise") ?? null,
    card?.querySelector<HTMLElement>("[data-card-title]") ?? null,
  ];
}

/** `skyLook` for the sky at this hour, before the first frame is drawn. */
export function skyLookNow(): SceneLook {
  const now = new Date();
  const hour = skyHourOverride() ?? now.getHours() + now.getMinutes() / 60;
  return skyLook(skyIsDark(paletteFor(hour)), readAsciiColors(0.5, 0.5).dark);
}
