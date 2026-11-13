import { type RefObject, useEffect, useRef } from "react";
import { asciiSkyTuning, rayChar, SKY_CHARS, skyChar } from "../model/asciiSky";
import {
  bodyAt,
  buildScene,
  mixRgb,
  paletteFor,
  type Scene,
  sceneAt,
  type SceneState,
  sceneKey,
  skyColorAt,
  skySceneTuning,
} from "../model/skyScene";
import { moonPhase, skyHourOverride } from "../model/sky";
import type { Rect } from "../../screensaver/model/scene";
import type { Rgb } from "../../screensaver/model/palettes";
import { approach } from "../../mailbox/model/glow";
import { asciiGlowTuning, type ClearShape, clearing } from "../../mailbox/model/asciiGlow";
import { asciiCell, AsciiPainter, GLYPH_ON_HOT, readAsciiColors } from "./asciiPaint";
import { SHOOTING_SECONDS, SHOOTING_SPEED, SkyInput, skyText } from "./skyInput";

/**
 * The sky in ASCII art (`model/asciiSky.ts`): the same scene as the pixel
 * sky (`model/skyScene.ts`, laid out on the same cells, so its mountains,
 * clouds and grass match), sampled at each character's cell of the glow's
 * grid, lined up with it across the card. The sky is a wash in its banded
 * colors; everything on it is a character on a tile, thinning out around
 * the title, icon and words (`clear`: the icon first, then each line of
 * text) as the glow does.
 */
export function AsciiSkyLayer({
  areaRef,
  iconRef,
  wordsRef,
  width,
  height,
  left,
  top,
  clear,
}: {
  areaRef: RefObject<HTMLElement | null>;
  /** The icon and words, whose text follows the sky (`skyText`), with the card's title. */
  iconRef: RefObject<HTMLElement | null>;
  wordsRef: RefObject<HTMLElement | null>;
  width: number;
  height: number;
  left: number;
  top: number;
  clear: Rect[];
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const placeRef = useRef({ left, top, clear });
  useEffect(() => {
    placeRef.current = { left, top, clear };
  }, [left, top, clear]);

  useEffect(() => {
    const area = areaRef.current;
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    const card = area?.closest<HTMLElement>(".panel");
    if (!area || !canvas || !ctx || !card) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const painter = new AsciiPainter(ctx);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let scene: Scene | null = null;
    let builtFor = "";
    let seeds = new Float32Array(0);
    let night = 0;
    let frame = 0;
    let last = performance.now();
    let count = 0;
    // Laid out on the same cells as the pixel sky, so the two match.
    const unitNow = () => Math.max(1, Math.round(skySceneTuning().pixel));
    const input = new SkyInput(card, area, canvas, () => ({
      scene,
      t: skySceneTuning(),
      unit: unitNow(),
      night,
    }));

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
      const st = skySceneTuning();
      const t = asciiSkyTuning();
      const g = asciiGlowTuning();
      const unit = unitNow();
      const key = sceneKey(Math.ceil(width / unit), Math.ceil(height / unit), st);
      if (key !== builtFor || !scene) {
        builtFor = key;
        scene = buildScene(Math.ceil(width / unit), Math.ceil(height / unit), st);
        input.reset();
      }
      const colors = readAsciiColors(g.hotMixDark, g.hotMixLight);
      const dark = colors.dark;
      if (count++ % 30 === 0)
        canvas.style.opacity = String(dark ? st.opacityDark : st.opacityLight);
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
        body: bodyAt(scene, hour, st),
      };
      const palette = paletteFor(hour);
      night = palette.night;
      input.step(dt, scene, nowMs);
      const mode = night > 0.5 ? "night" : "day";
      // Again now and then too, should the page's theme change.
      if (mode !== textMode || count % 30 === 1) {
        textMode = mode;
        skyText(textEls(), night, readAsciiColors(0.5, 0.5).dark);
      }

      // Characters take their own color rows: each material's color, lifted
      // toward the text color so it reads on its tile.
      const lift = (c: Rgb) => mixRgb(c, colors.content, t.glyphLift);
      const glyphRows: Rgb[] = [
        [226, 236, 255],
        [255, 250, 230],
        [238, 240, 250],
        lift(palette.cloudMid),
        lift(palette.farLit),
        lift(palette.hillLit),
        lift(palette.grass),
        palette.flower,
      ];
      const ROW = {
        star: GLYPH_ON_HOT + 1,
        sun: GLYPH_ON_HOT + 2,
        moon: GLYPH_ON_HOT + 3,
        cloud: GLYPH_ON_HOT + 4,
        mountain: GLYPH_ON_HOT + 5,
        hill: GLYPH_ON_HOT + 6,
        grass: GLYPH_ON_HOT + 7,
        flower: GLYPH_ON_HOT + 8,
      } as const;
      const { cw, ch } = asciiCell(ctx, g.fontPx, g.lineHeight);
      painter.prepare(cw, ch, dpr, g.fontPx, SKY_CHARS, colors, glyphRows);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const place = placeRef.current;
      const ox = -(((place.left % cw) + cw) % cw);
      const oy = -(((place.top % ch) + ch) % ch);
      const across = Math.ceil((width - ox) / cw);
      const down = Math.ceil((height - oy) / ch);
      if (seeds.length !== across * down)
        seeds = Float32Array.from({ length: across * down }, Math.random);
      const shapes: ClearShape[] = place.clear.map((r, i) => ({
        kind: i === 0 ? "icon" : "words",
        x0: r.x0,
        y0: r.y0,
        x1: r.x1,
        y1: r.y1,
      }));
      const tileAlpha = dark ? t.tileDark : t.tileLight;
      // Dithering is pixel art's: at a character's size it turns into a
      // checkerboard. ASCII gets a smooth sky in finer bands instead.
      const smooth = { ...st, dither: 0, skyBands: st.skyBands * 4 };
      const washAlpha = dark ? t.washDark : t.washLight;

      for (let r = 0; r < down; r++) {
        const y = oy + r * ch;
        const my = y + ch / 2;
        for (let c = 0; c < across; c++) {
          const x = ox + c * cw;
          const mx = x + cw / 2;
          const cell = sceneAt(scene, mx / unit, my / unit, state, palette, smooth);
          // Every cell gets the wash in its color (only color: it runs
          // behind the title, icon and words), so nothing leaves a hole.
          const lit = cell.material === "star" || cell.material === "sparkle";
          painter.fill(
            x,
            y,
            lit ? skyColorAt(scene, my / unit, palette, st) : cell.color,
            washAlpha,
          );
          if (cell.material === "sky") continue;
          const kept = clearing(mx, my, shapes, g, cw / 2, ch / 2);
          if (kept < 0.02) continue;
          const glyph = skyChar(cell, seeds[r * across + c]!);
          if (!lit) painter.tileIn(x, y, cell.color, tileAlpha * kept);
          if (!glyph) continue;
          const row = ROW[cell.material as keyof typeof ROW] ?? ROW.star;
          painter.glyph(x, y, glyph, row, (lit ? Math.min(1, cell.glow * 1.3) : 1) * kept);
        }
      }

      // Shooting stars: a bright head and a fading trail behind it.
      const cellAt = (px: number, py: number) => ({
        x: ox + Math.floor((px - ox) / cw) * cw,
        y: oy + Math.floor((py - oy) / ch) * ch,
      });
      for (const s of input.shooting) {
        const life = s.age / SHOOTING_SECONDS;
        const hx = (s.x + s.dx * s.age * SHOOTING_SPEED) * unit;
        const hy = (s.y + s.dy * s.age * SHOOTING_SPEED) * unit;
        const trail = rayChar(Math.atan2(s.dy, s.dx));
        for (let k = 8; k >= 0; k--) {
          const at = cellAt(hx - s.dx * k * cw, hy - s.dy * k * cw);
          const a = (1 - k / 9) * (1 - life);
          if (k === 0) {
            painter.tileIn(at.x, at.y, [236, 238, 250], 0.6 * a);
            painter.glyph(at.x, at.y, "*", ROW.star, a);
          } else painter.glyph(at.x, at.y, trail, ROW.star, a * 0.8);
        }
      }
      ctx.globalAlpha = 1;
    };
    frame = requestAnimationFrame(tick);
    return () => {
      input.dispose();
      cancelAnimationFrame(frame);
      skyText(textEls(), 0, false);
    };
  }, [areaRef, iconRef, wordsRef, width, height]);

  return <canvas ref={ref} style={{ width, height }} />;
}
