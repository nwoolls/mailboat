import { birdChar, type Murmuration, type MurmurationTuning } from "../model/murmuration";
import type { Rgb } from "../model/palettes";
import { SLOT } from "../model/scene";
import type { AsciiColors } from "../../emptyToys/ui/asciiPaint";
import { type AsciiGlowTuning, type ClearShape, clearing } from "../../mailbox/model/asciiGlow";

const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

export type MurmurationDraw = {
  ctx: CanvasRenderingContext2D;
  flock: Murmuration;
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
  t: MurmurationTuning;
};

/** ASCII art's flock, by how many birds share a cell: one shows its way, more a denser character. */
export function flockChar(n: number): string {
  return n >= 7 ? "#" : n >= 4 ? "*" : n >= 2 ? "+" : ".";
}

/**
 * Draws the flock (`model/murmuration.ts`) in the palette's colors
 * (`birdColor`), with depth: farther birds are smaller and fainter, nearer ones bigger and
 * bolder and drawn over them, so where the flock passes over itself it
 * reads as layers. In pixel art a bird is a block, the nearest two blocks
 * across; in ASCII art each cell shows how many birds are in it
 * (`flockChar`), as bold as the nearest of them, a lone near bird
 * pointing the way it flies (`birdChar`) and a far one a speck.
 */
export function drawMurmuration(d: MurmurationDraw) {
  const { ctx, flock, dpr } = d;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, flock.width * dpr, flock.height * dpr);
  if (d.look === "ascii") drawAscii(d);
  else drawBlocks(d);
  ctx.globalAlpha = 1;
}

function drawBlocks(d: MurmurationDraw) {
  const { ctx, dpr, flock } = d;
  const B = Math.max(1, Math.round(d.t.pixel));
  const block = (bx: number, by: number, c: Rgb, a: number) => {
    const keep = clearing(bx * B + B / 2, by * B + B / 2, d.shapes, d.glow, B / 2, B / 2);
    if (keep < 0.02 || a <= 0.01) return;
    ctx.globalAlpha = Math.min(1, a * keep);
    ctx.fillStyle = rgb(c);
    const x0 = Math.round(bx * B * dpr);
    const y0 = Math.round(by * B * dpr);
    ctx.fillRect(x0, y0, Math.round((bx + 1) * B * dpr) - x0, Math.round((by + 1) * B * dpr) - y0);
  };
  // Farthest first, so the near ones cross over them.
  const birds = flock.birds.filter((b) => !b.roosting).toSorted((a, b) => b.depth - a.depth);
  for (const b of birds) {
    const bx = Math.floor(b.x / B);
    const by = Math.floor(b.y / B);
    const near = 1 - b.depth;
    const a = 0.18 + 0.8 * near ** 1.3;
    const c = birdColor(b.depth, d.slots, d.page.dark);
    block(bx, by, c, a);
    // The nearest are bigger: a second block, then a third, across.
    if (near > 0.6) block(bx + 1, by, c, a * 0.85);
    if (near > 0.85) block(bx, by + 1, c, a * 0.7);
  }
}

function drawAscii(d: MurmurationDraw) {
  const { ctx, dpr, flock, cw, ch, ox, oy } = d;
  const cols = Math.ceil((flock.width - ox) / cw);
  const rows = Math.ceil((flock.height - oy) / ch);
  const count = new Uint16Array(cols * rows);
  // The way the last bird counted in each cell flies (shown when it is alone).
  const wayX = new Float32Array(cols * rows);
  const wayY = new Float32Array(cols * rows);
  const near = new Float32Array(cols * rows);
  for (const b of flock.birds) {
    if (b.roosting) continue;
    const c = Math.floor((b.x - ox) / cw);
    const r = Math.floor((b.y - oy) / ch);
    if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
    const i = r * cols + c;
    count[i]!++;
    wayX[i] = b.vx;
    wayY[i] = b.vy;
    near[i] = Math.max(near[i]!, 1 - b.depth);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.font = `600 ${d.fontPx}px ${MONO}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const n = count[i]!;
      if (!n) continue;
      const x = ox + c * cw + cw / 2;
      const y = oy + r * ch + ch / 2;
      const keep = clearing(x, y, d.shapes, d.glow, cw / 2, ch / 2);
      if (keep < 0.02) continue;
      // A lone near bird shows its way; a far one is a speck.
      const char = n === 1 ? (near[i]! > 0.75 ? birdChar(wayX[i]!, wayY[i]!) : ".") : flockChar(n);
      // As bold as its nearest bird: near layers stand out over far ones.
      ctx.globalAlpha = Math.min(1, (0.12 + 0.8 * near[i]! ** 1.3 + n * 0.03) * keep);
      ctx.fillStyle = rgb(birdColor(1 - near[i]!, d.slots, d.page.dark));
      ctx.fillText(char, x, y + 0.5);
    }
}

/**
 * A bird's color by how far away it is (0 near, 1 far), from the palette:
 * the accent at middle distance, nearer ones toward the palette's light
 * (on a dark page) or dark (on a light page) so they stand out, farther
 * ones toward its middle tone, as if through haze.
 */
export function birdColor(depth: number, slots: readonly Rgb[], darkPage: boolean): Rgb {
  const accent = slots[SLOT.accent] ?? [90, 160, 240];
  const nearTone = (darkPage ? slots[SLOT.light] : slots[SLOT.dark]) ?? accent;
  const farTone = slots[SLOT.mid] ?? accent;
  return depth < 0.5
    ? mix(accent, nearTone, (0.5 - depth) * 1.4)
    : mix(accent, farTone, (depth - 0.5) * 1.6);
}

function mix(a: Rgb, b: Rgb, k: number): Rgb {
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

function rgb(c: Rgb): string {
  return `rgb(${Math.round(c[0])} ${Math.round(c[1])} ${Math.round(c[2])})`;
}
