import type { Rgb } from "../model/palettes";
import type { AsciiColors } from "../../emptyToys/ui/asciiPaint";
import { type AsciiGlowTuning, type ClearShape, clearing } from "../../mailbox/model/asciiGlow";

const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

/** Shading characters, faint to dense: how solid and bright a cell of a shape is. */
export const SHADE_RAMP = ":=+*#%@";

/**
 * A character for a cell of a shape (a koi, the lava lamp's wax): `cover`
 * how much of it the shape fills, `bright` how light it is there (0–1). A
 * lit back is dense, shaded sides and thin fins lighter, so it looks round.
 */
export function shadeChar(cover: number, bright: number): string | null {
  const v = cover * (0.5 + 0.5 * bright);
  if (v < 0.1) return null;
  const top = SHADE_RAMP.length - 1;
  // Leaning dense, so a shape reads as solid (owner, 2026-11-13, of the koi).
  return SHADE_RAMP[Math.min(top, Math.round(v ** 0.6 * top))]!;
}

export type ShadedAsciiDraw = {
  ctx: CanvasRenderingContext2D;
  /** The shapes alone, and the ripples alone (empty for none), on the scene's fine grid. */
  shapesInk: Uint8Array;
  shapesOpacity: Uint8Array;
  ripples: Uint8Array;
  rippleOpacity: Uint8Array;
  cols: number;
  rows: number;
  /** Screen pixels per fine cell. */
  px: number;
  /** The palette's colors, by the values the scene draws. */
  colors: Uint32Array;
  /** The value the scene draws for a ripple's crest. */
  crest: number;
  dpr: number;
  ox: number;
  oy: number;
  cw: number;
  ch: number;
  fontPx: number;
  page: AsciiColors;
  /** The faint grid's opacity behind the characters (as behind the glow), 0 for none. */
  grid: number;
  /** The icon and words, which the characters thin out around. */
  shapes: ClearShape[];
  glow: AsciiGlowTuning;
};

/**
 * Smooth shapes in ASCII art (Settings → Toybox → Style): the koi pond and
 * the lava lamp. Each character cell takes the shapes' average color
 * there, and a shading character by how solid and bright they are
 * (`shadeChar`), in bold on a faint tile of that color, so they read as
 * solid, shaded shapes of text in their own colors, over the faint grid,
 * thinning out round the icon and words. A ripple's crest is a `~`.
 */
export function drawShadedAscii(d: ShadedAsciiDraw) {
  const { ctx, cols, rows, px, colors, cw, ch, ox, oy, dpr } = d;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.font = `700 ${d.fontPx}px ${MONO}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const width = cols * px;
  const height = rows * px;
  // The faint grid behind ASCII art, as behind the glow and the jellyfish.
  if (d.grid > 0) {
    ctx.globalAlpha = d.grid;
    ctx.fillStyle = rgb(d.page.content);
    for (let x = ox; x < width; x += cw) ctx.fillRect(x, 0, 1 / dpr, height);
    for (let y = oy; y < height; y += ch) ctx.fillRect(0, y, width, 1 / dpr);
  }
  const lift = d.page.dark ? 0.15 : 0;
  for (let y = oy; y < height; y += ch)
    for (let x = ox; x < width; x += cw) {
      const c0 = Math.max(0, Math.floor(x / px));
      const c1 = Math.min(cols, Math.ceil((x + cw) / px));
      const r0 = Math.max(0, Math.floor(y / px));
      const r1 = Math.min(rows, Math.ceil((y + ch) / px));
      let n = 0;
      let cover = 0;
      let rr = 0;
      let gg = 0;
      let bb = 0;
      let crest = 0;
      let wet = 0;
      for (let r = r0; r < r1; r++)
        for (let k = c0; k < c1; k++) {
          n++;
          const i = r * cols + k;
          if (d.ripples[i]) {
            const a = d.rippleOpacity[i]! / 255;
            if (d.ripples[i] === d.crest) crest += a;
            wet += a;
          }
          if (!d.shapesInk[i]) continue;
          const w = d.shapesOpacity[i]! / 255;
          const col = colors[d.shapesInk[i]!] ?? 0;
          cover += w;
          rr += (col & 255) * w;
          gg += ((col >>> 8) & 255) * w;
          bb += ((col >>> 16) & 255) * w;
        }
      if (!n) continue;
      const cx = x + cw / 2;
      const cy = y + ch / 2 + 0.5;
      // Thinned out round the icon and words, so they stay readable.
      const keep = clearing(cx, cy, d.shapes, d.glow, cw / 2, ch / 2);
      if (keep < 0.02) continue;
      if (cover > 0) {
        const avg: Rgb = [rr / cover, gg / cover, bb / cover];
        const bright = (0.2126 * avg[0] + 0.7152 * avg[1] + 0.0722 * avg[2]) / 255;
        const char = shadeChar(cover / n, bright);
        if (char) {
          // A faint tile in the shape's color fills the gaps between characters.
          ctx.globalAlpha = 0.22 * (cover / n) * keep;
          ctx.fillStyle = rgb(avg);
          ctx.fillRect(x, y, cw, ch);
          ctx.globalAlpha = Math.min(1, 0.6 + cover / n) * keep;
          ctx.fillStyle = rgb([
            avg[0] + (255 - avg[0]) * lift,
            avg[1] + (255 - avg[1]) * lift,
            avg[2] + (255 - avg[2]) * lift,
          ]);
          ctx.fillText(char, cx, cy);
          continue;
        }
      }
      // A ripple's crest, where no shape is.
      if (crest / n > 0.12) {
        ctx.globalAlpha = Math.min(0.7, (crest / n) * 1.6) * keep;
        ctx.fillStyle = rgb(d.page.content);
        ctx.fillText("~", cx, cy);
      } else if (wet / n > 0.25) {
        ctx.globalAlpha = Math.min(0.35, (wet / n) * 0.6) * keep;
        ctx.fillStyle = rgb(d.page.content);
        ctx.fillText("-", cx, cy);
      }
    }
  ctx.globalAlpha = 1;
}

function rgb(c: Rgb): string {
  return `rgb(${Math.round(c[0])} ${Math.round(c[1])} ${Math.round(c[2])})`;
}
