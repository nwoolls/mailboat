import { type RefObject, useEffect, useRef } from "react";
import {
  bodyAt,
  buildScene,
  paletteFor,
  skyIsDark,
  type Scene,
  sceneAt,
  type SceneState,
  sceneKey,
  sceneTuningKey,
  resizeScene,
  driftClouds,
  skySceneTuning,
} from "../model/skyScene";
import { moonPhase, skyHourOverride } from "../model/sky";
import { approach } from "../../mailbox/model/glow";
import { readAsciiColors } from "./asciiPaint";
import { SHOOTING_SECONDS, SHOOTING_SPEED, type SkyCarry, SkyInput, skyText } from "./skyInput";

/**
 * The sky in pixel art (`model/skyScene.ts`): the scene drawn one cell per
 * block of `pixel` screen pixels, sharp-edged like a retro console's, with
 * a soft glow added around the sun, moon, sparkles and shooting stars (the
 * light of HD-2D games), and the land shifting slightly with the pointer,
 * for depth. A click sends a shooting star at night, or a small cloud by day.
 */
export function PixelSkyLayer({
  areaRef,
  iconRef,
  wordsRef,
  width,
  height,
}: {
  areaRef: RefObject<HTMLElement | null>;
  /** The icon and words, whose text follows the sky (`skyText`), with the card's title. */
  iconRef: RefObject<HTMLElement | null>;
  wordsRef: RefObject<HTMLElement | null>;
  width: number;
  height: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  // The sky carried from one size to the next (`SkyCarry`).
  const carryRef = useRef<SkyCarry | null>(null);

  useEffect(() => {
    const area = areaRef.current;
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    const card = area?.closest<HTMLElement>(".panel");
    const low = document.createElement("canvas");
    const lowCtx = low.getContext("2d");
    if (!area || !canvas || !ctx || !card || !lowCtx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

    const carried = carryRef.current;
    let scene: Scene | null = carried?.scene ?? null;
    let image: ImageData | null = null;
    let pixels = new Uint32Array(0);
    let builtFor = "";
    let tunedFor = carried?.tunedFor ?? "";
    let night = 0;
    let frame = 0;
    let last = performance.now();
    let count = 0;
    const unitNow = () => Math.max(1, Math.round(skySceneTuning().pixel));
    const input = new SkyInput(card, area, canvas, () => ({
      scene,
      t: skySceneTuning(),
      unit: unitNow(),
      night,
    }));
    if (carried) input.takeOn(carried.held);

    const textEls = () => [
      iconRef.current,
      wordsRef.current,
      card.querySelector<HTMLElement>("[data-card-title]"),
    ];
    let textMode: string | null = "unset";

    const tick = (nowMs: number) => {
      frame = requestAnimationFrame(tick);
      const dt = Math.min(0.1, (nowMs - last) / 1000);
      last = nowMs;
      const t = skySceneTuning();
      const px = unitNow();
      const cols = Math.ceil(width / px);
      const rows = Math.ceil(height / px);
      const key = sceneKey(cols, rows, t);
      if (key !== builtFor || !scene || !image) {
        builtFor = key;
        // A new size carries the scene on; new tuning starts it over.
        const tuning = sceneTuningKey(t);
        if (scene && tuning === tunedFor) scene = resizeScene(scene, cols, rows, t);
        else {
          scene = buildScene(cols, rows, t);
          input.reset();
        }
        tunedFor = tuning;
        low.width = cols;
        low.height = rows;
        image = lowCtx.createImageData(cols, rows);
        pixels = new Uint32Array(image.data.buffer);
      }
      driftClouds(scene, reduce.matches ? 0 : dt);
      if (count++ % 30 === 0)
        canvas.style.opacity = String(
          readAsciiColors(0.5, 0.5).dark ? t.opacityDark : t.opacityLight,
        );
      const now = new Date();
      const hour = skyHourOverride() ?? now.getHours() + now.getMinutes() / 60;
      const still = reduce.matches;
      const look = input.look;
      look.x = still ? 0 : approach(look.x, look.tx, dt, 0.8);
      look.y = still ? 0 : approach(look.y, look.ty, dt, 0.8);
      const state: SceneState = {
        hour,
        phase: moonPhase(now),
        seconds: still ? 0 : nowMs / 1000,
        lookX: look.x,
        lookY: look.y,
        body: bodyAt(scene, hour, t),
      };
      const palette = paletteFor(hour);
      night = palette.night;
      input.step(dt, scene, nowMs);
      const mode = skyIsDark(palette) ? "night" : "day";
      // Again now and then too, should the page's theme change.
      if (mode !== textMode || count % 30 === 1) {
        textMode = mode;
        skyText(textEls(), mode === "night", readAsciiColors(0.5, 0.5).dark);
      }

      for (let y = 0; y < rows; y++)
        for (let x = 0; x < cols; x++) {
          const c = sceneAt(scene, x + 0.5, y + 0.5, state, palette, t).color;
          pixels[y * cols + x] = (255 << 24) | (c[2] << 16) | (c[1] << 8) | c[0];
        }
      // Shooting stars: a bright head and a fading streak, in whole cells.
      for (const s of input.shooting) {
        const life = s.age / SHOOTING_SECONDS;
        const hx = s.x + s.dx * s.age * SHOOTING_SPEED;
        const hy = s.y + s.dy * s.age * SHOOTING_SPEED;
        for (let k = 0; k < 14; k++) {
          const cx = Math.round(hx - s.dx * k);
          const cy = Math.round(hy - s.dy * k);
          if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) continue;
          const a = (1 - k / 14) * (1 - life);
          const i = cy * cols + cx;
          const old = pixels[i]!;
          const blend = (shift: number, to: number) =>
            Math.round(((old >>> shift) & 255) * (1 - a) + to * a);
          pixels[i] = (255 << 24) | (blend(16, 236) << 16) | (blend(8, 248) << 8) | blend(0, 255);
        }
      }
      lowCtx.putImageData(image, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(low, 0, 0, cols * px * dpr, rows * px * dpr);

      // The light: soft glows around the sun, moon, sparkles and shooting stars.
      if (t.bloom <= 0) return;
      ctx.globalCompositeOperation = "lighter";
      const glow = (gx: number, gy: number, r: number, rgb: string, a: number) => {
        if (a <= 0.005) return;
        const cx = gx * px * dpr;
        const cy = gy * px * dpr;
        const rr = r * px * dpr;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
        g.addColorStop(0, `rgb(${rgb} / ${a})`);
        g.addColorStop(1, `rgb(${rgb} / 0)`);
        ctx.fillStyle = g;
        ctx.fillRect(cx - rr, cy - rr, rr * 2, rr * 2);
      };
      const b = state.body;
      if (b.body === "sun")
        glow(
          b.x,
          b.y,
          t.sunRadius * (3.5 + b.low * 2),
          b.low > 0.5 ? "255 170 110" : "255 240 190",
          0.45 * t.bloom,
        );
      else
        glow(
          b.x,
          b.y,
          t.moonRadius * 3,
          "200 214 255",
          0.25 * t.bloom * Math.sin(state.phase * Math.PI),
        );
      if (night > 0) {
        const share = (t.stars / 1000) * t.sparkles;
        const seeds = scene.starSeed;
        for (let i = 0; i < seeds.length; i++) {
          if (seeds[i]! >= share) continue;
          const sy = Math.floor(i / cols);
          if (sy >= rows * t.mountainsAt) continue;
          const tw = 0.5 + 0.5 * Math.sin(state.seconds * (1 + seeds[i]! * 40) + seeds[i]! * 900);
          glow((i % cols) + 0.5, sy + 0.5, 3.5, "190 214 255", 0.35 * t.bloom * night * tw);
        }
      }
      for (const s of input.shooting)
        glow(
          s.x + s.dx * s.age * SHOOTING_SPEED,
          s.y + s.dy * s.age * SHOOTING_SPEED,
          4,
          "236 248 255",
          0.5 * t.bloom * (1 - s.age / SHOOTING_SECONDS),
        );
      ctx.globalCompositeOperation = "source-over";
    };
    frame = requestAnimationFrame(tick);
    return () => {
      carryRef.current = scene ? { scene, tunedFor, held: input.held() } : null;
      input.dispose();
      cancelAnimationFrame(frame);
      skyText(textEls(), false, false);
    };
  }, [areaRef, iconRef, wordsRef, width, height]);

  return <canvas ref={ref} style={{ width, height }} />;
}
