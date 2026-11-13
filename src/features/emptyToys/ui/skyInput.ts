import { makeCloud, type Scene, type SkySceneTuning } from "../model/skyScene";

export type Shooting = { x: number; y: number; dx: number; dy: number; age: number };

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
  private puffs: { at: number; cloud: Scene["clouds"][number] }[] = [];

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
    // Clouds drift from the clock's start: place it so it's under the
    // pointer now (`sceneAt` adds the drift and half its width back).
    cloud.x = x + cloud.w - (nowMs / 1000) * cloud.speed;
    cloud.y = y;
    scene.clouds.push(cloud);
    this.puffs.push({ at: nowMs, cloud });
  };
}

/**
 * The sky behind the icon, words and title is dark at night and bright by
 * day, whatever the page's theme, so their text follows the sky: light on
 * a night sky (`data-scene-night`, as the screensavers' night skies do),
 * dark on a day sky (`data-scene-day`). Only where it differs from the
 * page's own text. Returns what it set, to set again only on a change.
 */
export function skyText(
  els: (HTMLElement | null | undefined)[],
  night: number,
  pageDark: boolean,
): "night" | "day" | null {
  const mode = night > 0.5 ? (pageDark ? null : "night") : pageDark ? "day" : null;
  for (const el of els) {
    if (!el) continue;
    if (mode === "night") el.dataset.sceneNight = "";
    else delete el.dataset.sceneNight;
    if (mode === "day") el.dataset.sceneDay = "";
    else delete el.dataset.sceneDay;
  }
  return mode;
}
