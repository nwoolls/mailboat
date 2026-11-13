import { parseColor, type Rgb } from "../../screensaver/model/palettes";

/**
 * Drawing for the Toybox's ASCII art (Settings → Toybox → Style), shared by
 * everything drawn that way (the glow, the pond): monospace cells, each a
 * square tile with a 1px gap and a character on it, in colors running from
 * the accent to a "hot" color (the accent leaning toward the text color),
 * plus the page's own color for a dark character on a pale tile.
 *
 * Cells line up on one grid across the list card, so things drawn on
 * separate canvases (the glow behind, the pond in front) share it.
 */

export const ASCII_FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

/** Character colors: rows 0 to GLYPH_STEPS - 1 run from the accent to the hot color. */
export const GLYPH_STEPS = 4;
/** The row for the page's own color (a dark character on a pale tile). */
export const GLYPH_ON_HOT = GLYPH_STEPS;
/** Tile colors from the accent to the hot color. */
export const TILE_STEPS = 8;

export type AsciiColors = {
  accent: Rgb;
  content: Rgb;
  base: Rgb;
  hot: Rgb;
  /** The page is dark (light text on a dark background). */
  dark: boolean;
};

/** The page's colors now: the accent, the text, the background. */
export function readAsciiColors(hotMixDark: number, hotMixLight: number): AsciiColors {
  const root = getComputedStyle(document.documentElement);
  const accent = parseColor(root.getPropertyValue("--color-accent")) ?? [80, 140, 240];
  const content = parseColor(root.getPropertyValue("--color-content")) ?? [235, 235, 238];
  const base = parseColor(root.getPropertyValue("--color-background-base")) ?? [22, 22, 24];
  const dark = luma(content) > luma(base);
  return {
    accent,
    content,
    base,
    dark,
    hot: mix(accent, content, dark ? hotMixDark : hotMixLight),
  };
}

/** A cell's size in CSS pixels for a character size. */
export function asciiCell(
  ctx: CanvasRenderingContext2D,
  fontPx: number,
  lineHeight: number,
): { cw: number; ch: number } {
  ctx.font = `${fontPx}px ${ASCII_FONT}`;
  return { cw: Math.ceil(ctx.measureText("M").width), ch: Math.round(fontPx * lineHeight) };
}

/**
 * Paints tiles and characters on one canvas. `prepare` once a frame (it
 * rebuilds its character sheet only when something changed), then `tile`
 * and `glyph` per cell, at CSS pixel positions.
 */
export class AsciiPainter {
  private sheet: HTMLCanvasElement | null = null;
  private index = new Map<string, number>();
  private tiles: string[] = [];
  private key = "";
  private cw = 0;
  private ch = 0;
  private dpr = 1;

  constructor(private readonly ctx: CanvasRenderingContext2D) {}

  prepare(cw: number, ch: number, dpr: number, fontPx: number, chars: string, c: AsciiColors) {
    const key = [cw, ch, dpr, fontPx, chars, ...c.accent, ...c.hot, ...c.base].join();
    this.cw = cw;
    this.ch = ch;
    this.dpr = dpr;
    if (key === this.key) return;
    this.key = key;
    const unique = [...new Set(chars)].filter((g) => g !== " ");
    this.index = new Map(unique.map((g, i) => [g, i]));
    this.tiles = Array.from({ length: TILE_STEPS }, (_, k) =>
      rgb(mix(c.accent, c.hot, k / (TILE_STEPS - 1))),
    );
    const sheet = document.createElement("canvas");
    sheet.width = Math.max(1, Math.ceil(unique.length * cw * dpr));
    sheet.height = Math.ceil((GLYPH_STEPS + 1) * ch * dpr);
    const a = sheet.getContext("2d");
    if (a) {
      a.scale(dpr, dpr);
      a.font = `${fontPx}px ${ASCII_FONT}`;
      a.textAlign = "center";
      a.textBaseline = "middle";
      for (let row = 0; row <= GLYPH_STEPS; row++) {
        a.fillStyle =
          row === GLYPH_ON_HOT ? rgb(c.base) : rgb(mix(c.accent, c.hot, row / (GLYPH_STEPS - 1)));
        unique.forEach((g, k) => a.fillText(g, k * cw + cw / 2, row * ch + ch / 2 + 0.5));
      }
    }
    this.sheet = sheet;
  }

  /** A tile at (x, y): `warmth` 0 is the accent, 1 the hot color. */
  tile(x: number, y: number, warmth: number, alpha: number) {
    const { ctx, cw, ch, dpr } = this;
    if (alpha <= 0.005) return;
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.fillStyle = this.tiles[Math.round(clamp01(warmth) * (TILE_STEPS - 1))]!;
    ctx.fillRect((x + 0.5) * dpr, (y + 0.5) * dpr, (cw - 1) * dpr, (ch - 1) * dpr);
  }

  /** A character at (x, y) in color row `row` (0 accent … GLYPH_STEPS - 1 hot, or GLYPH_ON_HOT). */
  glyph(x: number, y: number, char: string, row: number, alpha: number) {
    const { ctx, cw, ch, dpr, sheet } = this;
    const k = this.index.get(char);
    if (!sheet || k === undefined || alpha <= 0.005) return;
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.drawImage(
      sheet,
      k * cw * dpr,
      row * ch * dpr,
      cw * dpr,
      ch * dpr,
      x * dpr,
      y * dpr,
      cw * dpr,
      ch * dpr,
    );
  }
}

export function mix(a: Rgb, b: Rgb, k: number): Rgb {
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
  ];
}

function rgb(c: Rgb): string {
  return `rgb(${c[0]} ${c[1]} ${c[2]})`;
}

function luma(c: Rgb): number {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
