import { type DeepLifeTuning, lifeChar } from "../model/deepLife";
import type { LifeScene } from "../model/life";
import type { Rgb } from "../model/palettes";
import { SLOT } from "../model/scene";
import type { AsciiColors } from "../../emptyToys/ui/asciiPaint";
import type { AsciiGlowTuning } from "../../mailbox/model/asciiGlow";

const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

export type LifeDraw = {
  ctx: CanvasRenderingContext2D;
  life: LifeScene;
  width: number;
  height: number;
  look: "chunky" | "ascii";
  dpr: number;
  fontPx: number;
  glow: AsciiGlowTuning;
  page: AsciiColors;
  slots: readonly Rgb[];
  t: DeepLifeTuning;
};

/** A cell's color by its age: the accent when new, paling, then settling to grey. */
export function lifeColor(age: number, slots: readonly Rgb[]): Rgb {
  const accent = slots[SLOT.accent] ?? [90, 160, 240];
  const light = slots[SLOT.light] ?? [200, 200, 210];
  const mid = slots[SLOT.mid] ?? [120, 120, 130];
  const a = Math.min(1, age / 40);
  return a < 0.2 ? mix(accent, light, a / 0.2) : mix(light, mid, (a - 0.2) / 0.8);
}

/**
 * Draws Life (`model/life.ts`): every cell that shows, as a tile with its
 * corners cut (pixel art) or a character (ASCII art: newborn `@`, then `O`,
 * `o` and an old `.`) on the glow's grid, in its age's color and as solid
 * as it shows (cells swell in and fade out). Newborn cells have a soft
 * light round them.
 */
export function drawLife(d: LifeDraw) {
  const { ctx, life, dpr, t } = d;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, d.width * dpr, d.height * dpr);
  const { w, h, ox, oy } = life.tiles;
  if (d.look === "ascii") {
    // The faint grid behind ASCII art, as behind the glow.
    ctx.globalAlpha = d.page.dark ? d.glow.gridDark : d.glow.gridLight;
    ctx.fillStyle = rgb(d.page.content);
    for (let x = ox; x < d.width; x += w)
      ctx.fillRect(Math.round(x * dpr), 0, Math.max(1, dpr), d.height * dpr);
    for (let y = oy; y < d.height; y += h)
      ctx.fillRect(0, Math.round(y * dpr), d.width * dpr, Math.max(1, dpr));
  }
  // Newborns' light, under the cells.
  if (t.glow > 0) {
    ctx.globalCompositeOperation = d.page.dark ? "lighter" : "source-over";
    const accent = d.slots[SLOT.accent] ?? [90, 160, 240];
    for (let ty = 0; ty < life.rows; ty++)
      for (let tx = 0; tx < life.cols; tx++) {
        const i = ty * life.cols + tx;
        const show = life.shown[i]!;
        if (show < 0.1 || life.age[i]! > 3 || !life.alive[i]) continue;
        const x = (ox + (tx + 0.5) * w) * dpr;
        const y = (oy + (ty + 0.5) * h) * dpr;
        const r = Math.max(w, h) * 1.4 * dpr;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgb(${accent.join(" ")} / ${Math.min(1, t.glow * 0.25 * show)})`);
        g.addColorStop(1, `rgb(${accent.join(" ")} / 0)`);
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
    ctx.globalCompositeOperation = "source-over";
  }
  if (d.look === "ascii") {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = `700 ${d.fontPx}px ${MONO}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
  }
  for (let ty = 0; ty < life.rows; ty++)
    for (let tx = 0; tx < life.cols; tx++) {
      const i = ty * life.cols + tx;
      const show = life.shown[i]!;
      if (show < 0.03) continue;
      const age = life.age[i]!;
      const c = lifeColor(age, d.slots);
      const x = ox + tx * w;
      const y = oy + ty * h;
      ctx.fillStyle = rgb(c);
      if (d.look === "ascii") {
        ctx.globalAlpha = Math.min(1, show);
        ctx.fillText(lifeChar(age), x + w / 2, y + h / 2 + 0.5);
        continue;
      }
      // A tile with its corners cut, a pixel of gap round it.
      ctx.globalAlpha = Math.min(1, show);
      const p = Math.max(1, Math.round(w / 8));
      const x0 = Math.round(x * dpr);
      const y0 = Math.round(y * dpr);
      const x1 = Math.round((x + w - 1) * dpr);
      const y1 = Math.round((y + h - 1) * dpr);
      const c0 = Math.round(p * dpr);
      ctx.fillRect(x0 + c0, y0, x1 - x0 - 2 * c0, y1 - y0);
      ctx.fillRect(x0, y0 + c0, x1 - x0, y1 - y0 - 2 * c0);
    }
  ctx.globalAlpha = 1;
}

function mix(a: Rgb, b: Rgb, k: number): Rgb {
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

function rgb(c: Rgb): string {
  return `rgb(${Math.round(c[0])} ${Math.round(c[1])} ${Math.round(c[2])})`;
}
