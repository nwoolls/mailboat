import { type CodeRain, type CodeRainTuning, litAt } from "../model/codeRain";
import type { Rgb } from "../model/palettes";
import { SLOT } from "../model/scene";
import type { AsciiColors } from "../../emptyToys/ui/asciiPaint";
import { type AsciiGlowTuning, type ClearShape, clearing } from "../../mailbox/model/asciiGlow";

const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const WHITE: Rgb = [255, 255, 255];

/** ASCII art's characters (a cell's glyph picks one). */
export const CODE_CHARS = "0123456789ABCDEF<>{}[]()/\\|=+-*:;#$%&@!?^~";

/**
 * Pixel art's font: 3 × 5 pixels a character, each row three bits (left
 * to right), top to bottom.
 */
export const PIXEL_FONT: readonly (readonly number[])[] = [
  [7, 5, 5, 5, 7], // 0
  [2, 6, 2, 2, 7], // 1
  [7, 1, 7, 4, 7], // 2
  [7, 1, 3, 1, 7], // 3
  [5, 5, 7, 1, 1], // 4
  [7, 4, 7, 1, 7], // 5
  [7, 4, 7, 5, 7], // 6
  [7, 1, 2, 2, 2], // 7
  [7, 5, 7, 5, 7], // 8
  [7, 5, 7, 1, 7], // 9
  [2, 5, 7, 5, 5], // A
  [6, 5, 6, 5, 6], // B
  [7, 4, 4, 4, 7], // C
  [6, 5, 5, 5, 6], // D
  [7, 4, 6, 4, 7], // E
  [7, 4, 6, 4, 4], // F
  [0, 2, 7, 2, 0], // +
  [0, 7, 0, 7, 0], // =
  [1, 2, 4, 2, 1], // <
  [4, 2, 1, 2, 4], // >
  [0, 2, 0, 2, 0], // :
  [1, 1, 2, 4, 4], // /
  [5, 7, 5, 7, 5], // #
  [2, 2, 2, 0, 2], // !
];

export type CodeRainDraw = {
  ctx: CanvasRenderingContext2D;
  rain: CodeRain;
  width: number;
  height: number;
  look: "chunky" | "ascii";
  dpr: number;
  /** The grid's cell and where it starts (lined up with the glow's in ASCII art). */
  ox: number;
  oy: number;
  cw: number;
  ch: number;
  fontPx: number;
  glow: AsciiGlowTuning;
  page: AsciiColors;
  slots: readonly Rgb[];
  shapes: ClearShape[];
  /** A night sky (a light page), from the palette's darkest color. */
  backdrop: boolean;
  /** The pointer, in pixels of the area. */
  pointer: { x: number; y: number } | null;
  t: CodeRainTuning;
};

/** Pixel art's character cell: the font's 3 × 5 and a pixel of space round it. */
export function pixelCell(t: CodeRainTuning): { cw: number; ch: number } {
  const px = Math.max(1, Math.round(t.pixel));
  return { cw: px * 4, ch: px * 7 };
}

/**
 * Draws code rain (`model/codeRain.ts`): each lit character, the heads near
 * white with a soft light round them and the trails in the accent, fading
 * behind, as text characters (ASCII art) or a pixel font in chunky blocks.
 * Round the pointer, the code shows faintly even where nothing falls.
 */
export function drawCodeRain(d: CodeRainDraw) {
  const { ctx, rain, dpr, t } = d;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, d.width * dpr, d.height * dpr);
  const dark = d.page.dark || d.backdrop;
  if (d.backdrop) {
    const top = d.slots[SLOT.dark] ?? [20, 24, 40];
    const grad = ctx.createLinearGradient(0, 0, 0, d.height * dpr);
    grad.addColorStop(0, rgb(mix(top, [0, 0, 0], 0.65)));
    grad.addColorStop(1, rgb(mix(top, [0, 0, 0], 0.45)));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, d.width * dpr, d.height * dpr);
  }
  const accent = d.slots[SLOT.accent] ?? [80, 200, 120];
  const headColor = mix(accent, WHITE, 0.75);
  const cells: { x: number; y: number; c: Rgb; a: number; glyph: number; head: boolean }[] = [];
  for (let col = 0; col < rain.cols; col++)
    for (let row = 0; row < rain.rows; row++) {
      const x = d.ox + col * d.cw;
      const y = d.oy + row * d.ch;
      let { lit, head } = litAt(rain, col, row);
      // The flashlight: the code shows round the pointer.
      if (d.pointer && t.flashlight > 0) {
        const dist = Math.hypot(x + d.cw / 2 - d.pointer.x, y + d.ch / 2 - d.pointer.y);
        if (dist < t.flashlight) lit = Math.max(lit, 0.4 * (1 - dist / t.flashlight) ** 1.5);
      }
      if (lit <= 0.04) continue;
      const keep = clearing(x + d.cw / 2, y + d.ch / 2, d.shapes, d.glow, d.cw / 2, d.ch / 2);
      if (keep < 0.02) continue;
      cells.push({
        x,
        y,
        c: head ? headColor : mix(accent, WHITE, lit * 0.25),
        a: (head ? 1 : 0.15 + 0.85 * lit ** 1.3) * keep,
        glyph: rain.glyphs[row * rain.cols + col]!,
        head,
      });
    }
  // The heads' light, under the characters.
  if (t.glow > 0) {
    ctx.globalCompositeOperation = dark ? "lighter" : "source-over";
    for (const c of cells)
      if (c.head)
        softGlow(
          ctx,
          (c.x + d.cw / 2) * dpr,
          (c.y + d.ch / 2) * dpr,
          d.ch * 1.6 * dpr,
          accent,
          t.glow * 0.35 * c.a,
        );
    ctx.globalCompositeOperation = "source-over";
  }
  if (d.look === "ascii") {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = `500 ${d.fontPx}px ${MONO}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const c of cells) {
      ctx.globalAlpha = Math.min(1, c.a);
      ctx.fillStyle = rgb(c.c);
      ctx.fillText(CODE_CHARS[c.glyph % CODE_CHARS.length]!, c.x + d.cw / 2, c.y + d.ch / 2 + 0.5);
    }
  } else {
    const px = Math.max(1, Math.round(t.pixel));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const c of cells) {
      ctx.globalAlpha = Math.min(1, c.a);
      ctx.fillStyle = rgb(c.c);
      const rows = PIXEL_FONT[c.glyph % PIXEL_FONT.length]!;
      for (let fy = 0; fy < 5; fy++)
        for (let fx = 0; fx < 3; fx++) {
          if (!((rows[fy]! >> (2 - fx)) & 1)) continue;
          const bx = c.x + (fx + 0.5) * px;
          const by = c.y + (fy + 1) * px;
          const x0 = Math.round(bx * dpr);
          const y0 = Math.round(by * dpr);
          ctx.fillRect(x0, y0, Math.round((bx + px) * dpr) - x0, Math.round((by + px) * dpr) - y0);
        }
    }
  }
  ctx.globalAlpha = 1;
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
