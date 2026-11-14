import { type DeepFireflyTuning, glowChar, grassHeight } from "../model/deepFireflies";
import type { FireflyScene } from "../model/fireflies";
import type { Rgb } from "../model/palettes";
import { SLOT } from "../model/scene";
import type { AsciiColors } from "../../emptyToys/ui/asciiPaint";
import { type AsciiGlowTuning, type ClearShape, clearing } from "../../mailbox/model/asciiGlow";

const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
/** Bayer 4×4: ordered dithering's thresholds, 0–1. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const WHITE: Rgb = [255, 255, 255];

export type FireflyDraw = {
  ctx: CanvasRenderingContext2D;
  scene: FireflyScene;
  /** Screen pixels per scene cell (the flies move in cells). */
  px: number;
  width: number;
  height: number;
  look: "chunky" | "ascii";
  dpr: number;
  ox: number;
  oy: number;
  cw: number;
  ch: number;
  fontPx: number;
  glow: AsciiGlowTuning;
  page: AsciiColors;
  slots: readonly Rgb[];
  shapes: ClearShape[];
  /** A dusk sky (a light page), from the palette's darkest color. */
  backdrop: boolean;
  t: DeepFireflyTuning;
};

/**
 * Draws the fireflies (`model/fireflies.ts`): a dusk sky on a light page,
 * the soft bloom of each flash, then the light on the grid: every cell
 * summing the flashes near it, so a flash is a round field of light, pale
 * at its heart and the accent at its rim (in ASCII `@ # * + : .` from the
 * heart out; in pixel art bands of blocks dithered at their edges). A fly
 * between flashes is a faint speck. Along the bottom, a grass silhouette
 * sways.
 */
export function drawDeepFireflies(d: FireflyDraw) {
  const { ctx, dpr, scene, px, t } = d;
  const W = d.width * dpr;
  const H = d.height * dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, W, H);
  const dark = d.page.dark || d.backdrop;
  const night = d.slots[SLOT.dark] ?? [20, 24, 40];
  if (d.backdrop) {
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    // Dark enough for the flashes to glow against, a touch lighter low down.
    grad.addColorStop(0, rgb(mix(night, [0, 0, 0], 0.65)));
    grad.addColorStop(1, rgb(mix(mix(night, [0, 0, 0], 0.4), d.slots[SLOT.accent] ?? night, 0.08)));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }
  const accent = d.slots[SLOT.accent] ?? [230, 200, 90];
  const pale = mix(accent, WHITE, 0.6);
  // Bloom: the soft light of each flash, added up.
  if (t.bloom > 0) {
    ctx.globalCompositeOperation = dark ? "lighter" : "source-over";
    for (const f of scene.flies) {
      const b = scene.glow(f);
      if (b < 0.05) continue;
      const near = 1 - f.far * 0.45;
      softGlow(
        ctx,
        f.x * px * dpr,
        f.y * px * dpr,
        (3 + 9 * b) * near * px * t.reach * 2.4 * dpr,
        accent,
        t.bloom * (d.look === "ascii" ? 0.3 : 0.18) * b * near,
      );
    }
    ctx.globalCompositeOperation = "source-over";
  }
  // The light on the grid: each cell sums the flashes near it.
  const cellW = d.look === "ascii" ? d.cw : Math.max(1, Math.round(t.pixel));
  const cellH = d.look === "ascii" ? d.ch : cellW;
  const ox = d.look === "ascii" ? d.ox : 0;
  const oy = d.look === "ascii" ? d.oy : 0;
  const cols = Math.ceil((d.width - ox) / cellW);
  const rows = Math.ceil((d.height - oy) / cellH);
  const light = new Float32Array(cols * rows);
  const specks: { x: number; y: number; a: number }[] = [];
  for (const f of scene.flies) {
    const b = scene.glow(f);
    const near = 1 - f.far * 0.45;
    const fx = f.x * px;
    const fy = f.y * px;
    if (b < 0.04) {
      specks.push({ x: fx, y: fy, a: 0.35 * near });
      continue;
    }
    const reach = (3 + 9 * b) * near * px * t.reach;
    const c0 = Math.max(0, Math.floor((fx - reach - ox) / cellW));
    const c1 = Math.min(cols - 1, Math.floor((fx + reach - ox) / cellW));
    const r0 = Math.max(0, Math.floor((fy - reach - oy) / cellH));
    const r1 = Math.min(rows - 1, Math.floor((fy + reach - oy) / cellH));
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const dd = Math.hypot(ox + (c + 0.5) * cellW - fx, oy + (r + 0.5) * cellH - fy) / reach;
        if (dd < 1) light[r * cols + c]! += (1 - dd) ** 1.4 * b * near * 1.8;
      }
  }
  const grassTop = (x: number, sway: number) => d.height * (1 - t.grass * grassHeight(x + sway));
  if (d.look === "ascii")
    drawAscii(d, light, cols, rows, ox, oy, specks, accent, pale, grassTop, night);
  else drawBlocks(d, light, cols, rows, cellW, specks, accent, pale, grassTop, night);
  ctx.globalAlpha = 1;
}

function drawBlocks(
  d: FireflyDraw,
  light: Float32Array,
  cols: number,
  rows: number,
  B: number,
  specks: { x: number; y: number; a: number }[],
  accent: Rgb,
  pale: Rgb,
  grassTop: (x: number, sway: number) => number,
  night: Rgb,
) {
  const { ctx, dpr, scene } = d;
  const block = (bx: number, by: number, c: Rgb, a: number) => {
    if (a <= 0.01) return;
    const keep = clearing(bx * B + B / 2, by * B + B / 2, d.shapes, d.glow, B / 2, B / 2);
    if (keep < 0.02) return;
    ctx.globalAlpha = Math.min(1, a * keep);
    ctx.fillStyle = rgb(c);
    const x0 = Math.round(bx * B * dpr);
    const y0 = Math.round(by * B * dpr);
    ctx.fillRect(x0, y0, Math.round((bx + 1) * B * dpr) - x0, Math.round((by + 1) * B * dpr) - y0);
  };
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // Grass first: the flies fly over it.
  const grass = mix(night, [0, 0, 0], 0.45);
  for (let bx = 0; bx < cols; bx++) {
    const x = bx * B + B / 2;
    const sway = Math.sin(scene.time * 0.7 + x * 0.015) * 3;
    const top = Math.floor(grassTop(x, sway) / B);
    for (let by = top; by < rows; by++) block(bx, by, grass, 0.85);
  }
  for (let by = 0; by < rows; by++)
    for (let bx = 0; bx < cols; bx++) {
      const g = light[by * cols + bx]!;
      if (g < 0.05) continue;
      // Bands of light, dithered where one gives way to the next.
      const level = Math.min(1, g) * 4 + BAYER[(by & 3) * 4 + (bx & 3)]! - 0.5;
      const band = Math.max(0, Math.min(4, Math.round(level)));
      if (band === 0) continue;
      // Softer than ASCII art's: solid blocks flashed too bright (owner).
      block(bx, by, mix(accent, pale, ((band - 1) / 3) * 0.65), 0.18 + band * 0.14);
    }
  for (const s of specks) block(Math.floor(s.x / B), Math.floor(s.y / B), accent, s.a);
}

function drawAscii(
  d: FireflyDraw,
  light: Float32Array,
  cols: number,
  rows: number,
  ox: number,
  oy: number,
  specks: { x: number; y: number; a: number }[],
  accent: Rgb,
  pale: Rgb,
  grassTop: (x: number, sway: number) => number,
  night: Rgb,
) {
  const { ctx, dpr, cw, ch, scene } = d;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.font = `500 ${d.fontPx}px ${MONO}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const put = (c: number, r: number, char: string, color: Rgb, a: number) => {
    if (a <= 0.02) return;
    const x = ox + c * cw + cw / 2;
    const y = oy + r * ch + ch / 2;
    const keep = clearing(x, y, d.shapes, d.glow, cw / 2, ch / 2);
    if (keep < 0.02) return;
    ctx.globalAlpha = Math.min(1, a * keep);
    ctx.fillStyle = rgb(color);
    ctx.fillText(char, x, y + 0.5);
  };
  // Grass: blades leaning with the breeze, tips along the top.
  const grass = mix(mix(night, [0, 0, 0], 0.2), accent, 0.3);
  for (let c = 0; c < cols; c++) {
    const x = ox + c * cw + cw / 2;
    const lean = Math.sin(scene.time * 0.7 + x * 0.015);
    const top = Math.floor((grassTop(x, lean * 3) - oy) / ch);
    const blade = lean > 0.35 ? "/" : lean < -0.35 ? "\\" : "|";
    for (let r = Math.max(0, top); r < rows; r++) {
      put(c, r, r === top ? (lean > 0 ? "," : "'") : blade, grass, r === top ? 0.5 : 0.7);
    }
  }
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const g = light[r * cols + c]!;
      const char = glowChar(g);
      if (!char) continue;
      put(c, r, char, mix(accent, pale, Math.min(1, g)), 0.35 + 0.65 * Math.min(1, g));
    }
  for (const s of specks) {
    const c = Math.floor((s.x - ox) / cw);
    const r = Math.floor((s.y - oy) / ch);
    if (c >= 0 && r >= 0 && c < cols && r < rows && light[r * cols + c]! < 0.06)
      put(c, r, ".", accent, s.a);
  }
}

function softGlow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  c: Rgb,
  a: number,
) {
  if (a <= 0.003 || r <= 0) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgb(${c[0]} ${c[1]} ${c[2]} / ${Math.min(1, a)})`);
  g.addColorStop(1, `rgb(${c[0]} ${c[1]} ${c[2]} / 0)`);
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

function mix(a: Rgb, b: Rgb, k: number): Rgb {
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

function rgb(c: Rgb): string {
  return `rgb(${Math.round(c[0])} ${Math.round(c[1])} ${Math.round(c[2])})`;
}
