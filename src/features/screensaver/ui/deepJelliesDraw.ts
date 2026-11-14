import {
  bellShape,
  type DeepJellyTuning,
  depthLight,
  jellyHues,
  mix,
  type Swarm,
} from "../model/deepJellies";
import type { Rgb } from "../model/palettes";
import type { AsciiColors } from "../../emptyToys/ui/asciiPaint";
import { type AsciiGlowTuning, type ClearShape, clearing } from "../../mailbox/model/asciiGlow";

/**
 * Drawing the jellyfish (`model/deepJellies.ts`) in the Toybox's styles.
 * The jellies are first painted as soft light on a small canvas, a few
 * samples per cell: each jelly glows in its own blend of two hues (red
 * channel the first hue, blue the second, green a white highlight, added
 * where they overlap), its tentacles as strokes that thin and dim toward
 * their tips, shifting hue as they go, and its bell with a bright rim,
 * four rings inside in a clover (as a moon jelly has) and small bulbs
 * along the rim. Then each cell (ASCII) or block (pixel art) takes its
 * look from the light there: how bright picks a character or a step of
 * shade, the hues' balance its color, the highlight how pale it is. So
 * thin, dim tips fade to faint characters in the darker hue, as in the
 * owner's references.
 */

/** Light samples per cell (or block), each way. */
const SS = 2;
/** Characters by brightness, faint to dense, two of each to flicker between. */
const LEVELS: readonly [string, string][] = [
  [".", "'"],
  [",", "`"],
  [":", "."],
  [";", ":"],
  ["-", "~"],
  ["=", "+"],
  ["o", "c"],
  ["*", "x"],
  ["%", "S"],
  ["X", "#"],
  ["8", "&"],
  ["@", "B"],
];
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
/** Bayer 4×4: ordered dithering's thresholds, 0–1. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

export type DeepDraw = {
  ctx: CanvasRenderingContext2D;
  swarm: Swarm;
  look: "chunky" | "ascii";
  dpr: number;
  /** The grid's origin against the area, so cells line up across the card. */
  ox: number;
  oy: number;
  /** The character cell, for ASCII art. */
  cw: number;
  ch: number;
  fontPx: number;
  glow: AsciiGlowTuning;
  page: AsciiColors;
  slots: readonly Rgb[];
  /** The icon and words, which the characters thin out around (ASCII). */
  shapes: ClearShape[];
  /** A deep-sea backdrop (on a light page), from the palette's darkest color. */
  backdrop: boolean;
  t: DeepJellyTuning;
};

/** The small canvas the light is painted on, kept between frames. */
const fields = new WeakMap<CanvasRenderingContext2D, CanvasRenderingContext2D>();

/** Draws the swarm in chunky pixel art or ASCII art. */
export function drawDeepJellies(d: DeepDraw) {
  const { ctx, swarm, dpr, t } = d;
  const W = swarm.width * dpr;
  const H = swarm.height * dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, W, H);
  const [hueA, hueB] = jellyHues(d.slots);
  if (d.backdrop) {
    const top = d.slots[0] ?? [20, 24, 40];
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, rgb(mix(top, [0, 0, 0], 0.55)));
    grad.addColorStop(1, rgb(mix(top, [0, 0, 0], 0.25)));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }
  // On the backdrop the page is light but the sea is dark: draw as if dark.
  const dark = d.page.dark || d.backdrop;
  const content: Rgb = d.backdrop ? [235, 236, 240] : d.page.content;

  // Soft light behind the bells (HD-2D's glow), and the drifting specks.
  ctx.globalCompositeOperation = dark ? "lighter" : "source-over";
  for (const j of swarm.jellies) {
    const b = bellShape(swarm, j, t);
    softGlow(
      ctx,
      b.x * dpr,
      (b.y - b.r * 0.3) * dpr,
      b.r * 1.9 * dpr,
      mix(hueA, hueB, j.hue),
      t.glow * depthLight(j, t),
    );
  }
  for (const m of swarm.motes) {
    const tw = 0.55 + 0.45 * Math.sin(swarm.time * 1.7 + m.phase);
    softGlow(ctx, m.x * dpr, m.y * dpr, (6 + m.size * 10) * dpr, hueA, 0.35 * tw);
  }
  ctx.globalCompositeOperation = "source-over";

  // The light, painted small; then read cell by cell.
  const cellW = d.look === "ascii" ? d.cw : Math.max(1, Math.round(t.pixel));
  const cellH = d.look === "ascii" ? d.ch : cellW;
  const ox = d.look === "ascii" ? d.ox : -(((-d.ox % cellW) + cellW) % cellW);
  const oy = d.look === "ascii" ? d.oy : -(((-d.oy % cellH) + cellH) % cellH);
  const cols = Math.ceil((swarm.width - ox) / cellW);
  const rows = Math.ceil((swarm.height - oy) / cellH);
  const field = paintLight(d, cols, rows, cellW, cellH, ox, oy);
  if (!field) return;
  if (d.look === "ascii") {
    grid(d, dark, content);
    drawAscii(d, field, cols, rows, ox, oy, hueA, hueB, dark);
  } else drawBlocks(d, field, cols, rows, cellW, ox, oy, hueA, hueB);
  ctx.globalAlpha = 1;
}

/** Paints the jellies as light on the small canvas and reads it back. */
function paintLight(
  d: DeepDraw,
  cols: number,
  rows: number,
  cellW: number,
  cellH: number,
  ox: number,
  oy: number,
): Uint8ClampedArray | null {
  let f = fields.get(d.ctx);
  if (!f) {
    const c = document.createElement("canvas");
    const fctx = c.getContext("2d", { willReadFrequently: true });
    if (!fctx) return null;
    f = fctx;
    fields.set(d.ctx, f);
  }
  const w = cols * SS;
  const h = rows * SS;
  if (f.canvas.width !== w || f.canvas.height !== h) {
    f.canvas.width = w;
    f.canvas.height = h;
  }
  f.setTransform(1, 0, 0, 1, 0, 0);
  f.globalCompositeOperation = "source-over";
  f.fillStyle = "#000";
  f.fillRect(0, 0, w, h);
  // From the area's pixels to the small canvas's.
  f.setTransform(SS / cellW, 0, 0, SS / cellH, (-ox * SS) / cellW, (-oy * SS) / cellH);
  f.globalCompositeOperation = "lighter";
  f.lineCap = "round";
  f.lineJoin = "round";
  const { swarm, t } = d;
  for (const j of swarm.jellies) {
    const k = depthLight(j, t);
    const b = bellShape(swarm, j, t);
    const glow = k * (0.95 + 0.3 * b.squeeze);
    // The tentacles and arms: thinning and dimming toward the tips, the
    // tentacles shifting toward the other hue as they go.
    for (const tentacle of j.tentacles) {
      const links = tentacle.links;
      const n = links.length;
      for (let i = 0; i < n - 1; i += 2) {
        const along = i / (n - 1);
        f.lineWidth = Math.max(0.6, (tentacle.w0 + (tentacle.w1 - tentacle.w0) * along) * b.r);
        const hue = tentacle.arm ? j.hue : clamp01(j.hue + (j.hue < 0.5 ? 0.45 : -0.45) * along);
        f.strokeStyle = light(
          hue,
          glow * (tentacle.arm ? 0.5 : 0.46) * (1 - along * 0.82),
          tentacle.arm ? 0.1 * glow : 0,
        );
        f.beginPath();
        f.moveTo(links[i]!.x, links[i]!.y);
        for (let q = i + 1; q <= Math.min(n - 1, i + 2); q++) f.lineTo(links[q]!.x, links[q]!.y);
        f.stroke();
      }
    }
    // The bell: a dome over a gently curved mouth, lit at its rim.
    f.save();
    f.translate(b.x, b.y);
    f.rotate(b.lean);
    f.beginPath();
    f.moveTo(-b.rw, 0);
    f.bezierCurveTo(-b.rw, -b.rh * 0.6, -b.rw * 0.55, -b.rh, 0, -b.rh);
    f.bezierCurveTo(b.rw * 0.55, -b.rh, b.rw, -b.rh * 0.6, b.rw, 0);
    f.quadraticCurveTo(0, -b.rh * 0.22, -b.rw, 0);
    f.closePath();
    const fill = f.createRadialGradient(0, -b.rh * 0.4, b.rw * 0.1, 0, -b.rh * 0.3, b.rw * 1.05);
    fill.addColorStop(0, light(j.hue, glow * 0.34, 0.1 * glow));
    fill.addColorStop(0.7, light(j.hue, glow * 0.42, 0.03 * glow));
    fill.addColorStop(1, light(j.hue, glow * 0.66, 0.08 * glow));
    f.fillStyle = fill;
    f.fill();
    f.lineWidth = Math.max(3, b.r * 0.085);
    f.strokeStyle = light(j.hue, glow * 0.55, 0.2 * glow);
    f.stroke();
    // Four rings inside, in a clover, pale.
    f.lineWidth = Math.max(2, b.r * 0.05);
    f.strokeStyle = light(j.hue, glow * 0.14, 0.52 * glow * t.core * 1.8);
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      f.beginPath();
      f.ellipse(
        Math.cos(a) * b.rw * 0.26,
        -b.rh * 0.44 + Math.sin(a) * b.rh * 0.2,
        b.rw * 0.14,
        b.rh * 0.12,
        a,
        0,
        Math.PI * 2,
      );
      f.stroke();
    }
    // Small bulbs along the rim.
    f.fillStyle = light(j.hue, glow * 0.4, 0.36 * glow);
    for (let i = 0; i <= 8; i++) {
      const u = -0.95 + (1.9 * i) / 8;
      f.beginPath();
      f.arc(u * b.rw, -b.rh * 0.03 * (1 - Math.abs(u)), Math.max(1.5, b.r * 0.034), 0, Math.PI * 2);
      f.fill();
    }
    f.restore();
  }
  return f.getImageData(0, 0, w, h).data;
}

/** Light of a jelly: `hue` between its two hues (0–1), `k` how bright, `white` how pale. */
function light(hue: number, k: number, white: number): string {
  const a = Math.min(255, (1 - hue) * k * 255) | 0;
  const b = Math.min(255, hue * k * 255) | 0;
  const w = Math.min(255, white * 255) | 0;
  return `rgb(${a} ${w} ${b})`;
}

/** The light in cell (cx, cy): its brightness, hue balance (0–1) and paleness. */
function sample(data: Uint8ClampedArray, cols: number, cx: number, cy: number) {
  const row = cols * SS * 4;
  const i = cy * SS * row + cx * SS * 4;
  const a = (data[i]! + data[i + 4]! + data[i + row]! + data[i + row + 4]!) / 1020;
  const w = (data[i + 1]! + data[i + 5]! + data[i + row + 1]! + data[i + row + 5]!) / 1020;
  const b = (data[i + 2]! + data[i + 6]! + data[i + row + 2]! + data[i + row + 6]!) / 1020;
  return { level: Math.min(1, a + b + w * 0.55), hue: b / (a + b + 1e-4), white: w };
}

function drawAscii(
  d: DeepDraw,
  data: Uint8ClampedArray,
  cols: number,
  rows: number,
  ox: number,
  oy: number,
  hueA: Rgb,
  hueB: Rgb,
  dark: boolean,
) {
  const { ctx, cw, ch, dpr, swarm } = d;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.font = `500 ${d.fontPx}px ${MONO}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // A few contrasting colors for the odd flickering character.
  const sparks = [d.slots[3], d.slots[2], d.slots[4]].filter((c): c is Rgb => !!c);
  const styles = new Map<number, { tile: string; glyph: string; hot: boolean }>();
  for (let cy = 0; cy < rows; cy++)
    for (let cx = 0; cx < cols; cx++) {
      const s = sample(data, cols, cx, cy);
      if (s.level < 0.055) continue;
      const x = ox + cx * cw;
      const y = oy + cy * ch;
      const keep = clearing(x + cw / 2, y + ch / 2, d.shapes, d.glow, cw / 2, ch / 2);
      if (keep < 0.02) continue;
      const lv = Math.min(LEVELS.length - 1, Math.floor(s.level * LEVELS.length));
      const hb = Math.round(s.hue * 5);
      const wb = s.white < 0.12 ? 0 : s.white < 0.32 ? 1 : 2;
      const key = (hb * LEVELS.length + lv) * 3 + wb;
      let st = styles.get(key);
      if (!st) {
        const base = mix(hueA, hueB, hb / 5);
        const level = (lv + 0.5) / LEVELS.length;
        const paleness = [0, 0.3, 0.62][wb]!;
        // The brightest, palest cells flip: a pale tile with a dark character.
        const hot = lv >= LEVELS.length - 2 && wb > 0;
        const tile = hot
          ? mix(base, [236, 236, 236], 0.5 + paleness * 0.3)
          : mix(base, [0, 0, 0], 0.42);
        const glyph = hot
          ? ([6, 10, 16] as Rgb)
          : mix(
              base,
              dark ? [246, 246, 246] : [20, 22, 30],
              Math.min(0.94, 0.12 + level * 0.5 + paleness * 0.34),
            );
        st = {
          tile: `rgb(${tile.join(" ")} / ${hot ? 0.9 : 0.1 + level * 0.5})`,
          glyph: hot ? `rgb(${glyph.join(" ")})` : `rgb(${glyph.join(" ")} / ${0.4 + level * 0.6})`,
          hot,
        };
        styles.set(key, st);
      }
      ctx.globalAlpha = keep;
      if (lv >= 1) {
        ctx.fillStyle = st.tile;
        ctx.fillRect(x + 0.5, y + 0.5, cw - 1, ch - 1);
      }
      // Characters flicker between two of their level now and then.
      const tick = Math.floor(swarm.time * 1.4 + ((cx * 7 + cy * 13) & 15) / 16);
      const h = hash(cx, cy, tick);
      const spark = lv >= 4 && lv < 10 && h > 0.986 && sparks.length > 0;
      ctx.fillStyle = spark ? rgb(sparks[Math.floor(h * 1e4) % sparks.length]!) : st.glyph;
      ctx.fillText(LEVELS[lv]![h < 0.55 ? 0 : 1], x + cw / 2, y + ch / 2 + 0.5);
    }
  // The specks themselves.
  ctx.fillStyle = rgb(mix(hueA, [255, 255, 255], 0.5));
  for (const m of swarm.motes) {
    const tw = 0.55 + 0.45 * Math.sin(swarm.time * 1.7 + m.phase);
    ctx.globalAlpha = tw;
    const x = ox + Math.floor((m.x - ox) / cw) * cw;
    const y = oy + Math.floor((m.y - oy) / ch) * ch;
    ctx.fillText(m.size > 0.7 ? "*" : ".", x + cw / 2, y + ch / 2 + 0.5);
  }
  ctx.globalAlpha = 1;
}

function drawBlocks(
  d: DeepDraw,
  data: Uint8ClampedArray,
  cols: number,
  rows: number,
  px: number,
  ox: number,
  oy: number,
  hueA: Rgb,
  hueB: Rgb,
) {
  const { ctx, dpr, swarm } = d;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const block = (cx: number, cy: number, c: Rgb, a: number) => {
    if (a <= 0.01) return;
    // Thinned out round the icon, words and title, as ASCII art is.
    const keep = clearing(
      ox + (cx + 0.5) * px,
      oy + (cy + 0.5) * px,
      d.shapes,
      d.glow,
      px / 2,
      px / 2,
    );
    if (keep < 0.02) return;
    ctx.globalAlpha = Math.min(1, a * keep);
    ctx.fillStyle = rgb(c);
    const x0 = Math.round((ox + cx * px) * dpr);
    const y0 = Math.round((oy + cy * px) * dpr);
    ctx.fillRect(
      x0,
      y0,
      Math.round((ox + (cx + 1) * px) * dpr) - x0,
      Math.round((oy + (cy + 1) * px) * dpr) - y0,
    );
  };
  for (let cy = 0; cy < rows; cy++)
    for (let cx = 0; cx < cols; cx++) {
      const s = sample(data, cols, cx, cy);
      if (s.level < 0.06) continue;
      // Stepped shade, dithered between steps.
      const dither = BAYER[(cy % 4) * 4 + (cx % 4)]!;
      const step = Math.max(0, Math.min(4, Math.floor(s.level * 5 + dither - 0.5))) / 4;
      if (step <= 0) continue;
      const base = mix(hueA, hueB, Math.round(s.hue * 5) / 5);
      const lit = mix(base, [255, 255, 255], Math.min(0.85, 0.15 + s.white * 1.1));
      block(cx, cy, mix(mix(base, [0, 0, 0], 0.55), lit, step), 0.3 + 0.7 * step);
    }
  for (const m of swarm.motes) {
    const tw = 0.55 + 0.45 * Math.sin(swarm.time * 1.7 + m.phase);
    block(
      Math.floor((m.x - ox) / px),
      Math.floor((m.y - oy) / px),
      mix(hueA, [255, 255, 255], 0.6),
      tw,
    );
  }
}

/** The faint grid behind ASCII art, as behind the glow. */
function grid(d: DeepDraw, dark: boolean, content: Rgb) {
  const { ctx, swarm, cw, ch, ox, oy, dpr } = d;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = dark ? d.glow.gridDark : d.glow.gridLight;
  ctx.fillStyle = rgb(content);
  for (let x = ox; x < swarm.width; x += cw)
    ctx.fillRect(Math.round(x * dpr), 0, Math.max(1, dpr), swarm.height * dpr);
  for (let y = oy; y < swarm.height; y += ch)
    ctx.fillRect(0, Math.round(y * dpr), swarm.width * dpr, Math.max(1, dpr));
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
  if (a <= 0.005 || r <= 0) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgb(${c[0]} ${c[1]} ${c[2]} / ${Math.min(1, a)})`);
  g.addColorStop(1, `rgb(${c[0]} ${c[1]} ${c[2]} / 0)`);
  ctx.globalAlpha = 1;
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

/** A steady pseudo-random number in [0, 1) for a cell and a moment. */
function hash(x: number, y: number, tick: number): number {
  let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(tick, 83492791);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function rgb(c: Rgb): string {
  return `rgb(${c[0]} ${c[1]} ${c[2]})`;
}
