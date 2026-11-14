import { type DeepStarTuning, project, type Starfield, streakTail } from "../model/deepStars";
import type { Rgb } from "../model/palettes";
import type { AsciiColors } from "../../emptyToys/ui/asciiPaint";
import { type AsciiGlowTuning, type ClearShape, clearing } from "../../mailbox/model/asciiGlow";

const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
/** Bayer 4×4: ordered dithering's thresholds, 0–1. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

export type StarDraw = {
  ctx: CanvasRenderingContext2D;
  field: Starfield;
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
  /** A night sky (a light page), from the palette's darkest color. */
  backdrop: boolean;
  t: DeepStarTuning;
};

/**
 * Draws the starfield (`model/deepStars.ts`) in chunky pixel art or ASCII
 * art: soft nebulas behind, twinkling dust, then the stars, far to near,
 * each a dot that grows brighter (in ASCII `. + * @`, the nearest on a pale
 * tile) with a soft glow round the nearest, and a streak behind the fast
 * ones that fades toward its tail, drawn in characters that follow its
 * direction or in dithered blocks.
 */
export function drawDeepStars(d: StarDraw) {
  const { ctx, field, dpr, t } = d;
  const W = field.width * dpr;
  const H = field.height * dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, W, H);
  const dark = d.page.dark || d.backdrop;
  if (d.backdrop) {
    const top = d.slots[0] ?? [20, 24, 40];
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, rgb(mix(top, [0, 0, 0], 0.6)));
    grad.addColorStop(1, rgb(mix(top, [0, 0, 0], 0.35)));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }
  const tints: Rgb[] = [
    d.slots[4] ?? [92, 200, 230],
    d.slots[2] ?? [180, 160, 240],
    d.slots[1] ?? [120, 130, 160],
  ];
  const starColor = (tint: number): Rgb =>
    mix([235, 238, 250], tints[Math.floor(tint * tints.length) % tints.length]!, 0.35);

  // Nebulas: very soft color behind it all.
  ctx.globalCompositeOperation = dark ? "lighter" : "source-over";
  for (const n of field.nebulas)
    softGlow(ctx, n.x * dpr, n.y * dpr, n.r * dpr, tints[n.tint % tints.length]!, t.nebula);
  // The nearest stars' glow.
  for (const s of field.stars) {
    const p = project(field, s);
    if (p.near < 0.7) continue;
    softGlow(
      ctx,
      p.x * dpr,
      p.y * dpr,
      (6 + (22 * (p.near - 0.7)) / 0.3) * dpr,
      starColor(s.tint),
      t.glow * (p.near - 0.7) * 2,
    );
  }
  ctx.globalCompositeOperation = "source-over";

  const stars = field.stars.toSorted((a, b) => b.z - a.z);
  if (d.look === "ascii") drawAscii(d, stars, starColor, dark);
  else drawBlocks(d, stars, starColor);
  ctx.globalAlpha = 1;
}

/** Light samples per cell, each way, for the streaks. */
const SS = 2;
/** The small canvas the streaks' light is painted on, kept between frames. */
const fields = new WeakMap<CanvasRenderingContext2D, CanvasRenderingContext2D>();

/**
 * How much of a star sits in its own cell and how much in the neighbor it
 * is heading into, along one axis, from where it is in its cell (0–1, 0.5
 * the middle). Most of the way across it is all in its own cell, sharp;
 * only near the edge does it cross-fade, half and half right on it.
 */
export function crossFade(frac: number): { share: number; step: -1 | 1 } {
  const off = Math.abs(frac - 0.5);
  const u = Math.min(1, Math.max(0, (off - 0.3) / 0.2));
  return { share: 0.5 * u * u * (3 - 2 * u), step: frac < 0.5 ? -1 : 1 };
}

/**
 * ASCII art. Each star is one character, sharp, in its cell: by brightness
 * (`. + * @`, the brightest on a pale tile) and in its own tint. Snapping
 * from cell to cell looked "too jumpy" to the owner, and spreading each star
 * as soft light over a few cells and easing it made them "fuzzy, like I'm
 * drunk"; so a star stays in one cell until it nears the edge, then fades
 * out of it as it fades into the next (`crossFade`). Streaks are painted as
 * fading lines on a small canvas, a few samples per cell, and each lit cell
 * shows a streak character pointing away from the vanishing point, as
 * bright as the light there, so they fade in and out along their length
 * instead of popping.
 */
function drawAscii(
  d: StarDraw,
  stars: Starfield["stars"],
  starColor: (t: number) => Rgb,
  dark: boolean,
) {
  const { ctx, field, cw, ch, ox, oy, dpr, t } = d;
  const cols = Math.ceil((field.width - ox) / cw);
  const rows = Math.ceil((field.height - oy) / ch);
  let f = fields.get(ctx);
  if (!f) {
    const made = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    if (!made) return;
    f = made;
    fields.set(ctx, f);
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
  f.setTransform(SS / cw, 0, 0, SS / ch, (-ox * SS) / cw, (-oy * SS) / ch);
  f.globalCompositeOperation = "lighter";
  f.lineCap = "round";
  // Each star's cells this frame: cell → the strongest star in it.
  const lit = new Map<number, { a: number; b: number; c: Rgb }>();
  const give = (cx: number, cy: number, a: number, b: number, c: Rgb) => {
    if (a < 0.03 || cx < 0 || cy < 0 || cx >= cols || cy >= rows) return;
    const n = cy * cols + cx;
    const had = lit.get(n);
    if (!had || had.a * had.b < a * b) lit.set(n, { a, b, c });
  };
  for (const s of stars) {
    const p = project(field, s);
    const b = p.near ** 1.4;
    const tail = streakTail(field, s, t);
    if (Math.hypot(p.x - tail.x, p.y - tail.y) > cw * 0.6) {
      const g = f.createLinearGradient(p.x, p.y, tail.x, tail.y);
      g.addColorStop(0, `rgb(0 ${Math.round(255 * b)} 0)`);
      g.addColorStop(1, "rgb(0 0 0)");
      f.strokeStyle = g;
      f.lineWidth = cw * 0.4;
      f.beginPath();
      f.moveTo(p.x, p.y);
      f.lineTo(tail.x, tail.y);
      f.stroke();
    }
    const gx = (p.x - ox) / cw;
    const gy = (p.y - oy) / ch;
    const cx = Math.floor(gx);
    const cy = Math.floor(gy);
    const fx = crossFade(gx - cx);
    const fy = crossFade(gy - cy);
    const c = starColor(s.tint);
    give(cx, cy, (1 - fx.share) * (1 - fy.share), b, c);
    give(cx + fx.step, cy, fx.share * (1 - fy.share), b, c);
    give(cx, cy + fy.step, (1 - fx.share) * fy.share, b, c);
    give(cx + fx.step, cy + fy.step, fx.share * fy.share, b, c);
  }
  const data = f.getImageData(0, 0, w, h).data;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.font = `500 ${d.fontPx}px ${MONO}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const streakFill = rgb(starColor(0.5));
  // Dust: faint and still, twinkling.
  const dustColor: Rgb = dark ? [150, 160, 190] : [90, 96, 120];
  ctx.fillStyle = rgb(dustColor);
  for (const s of field.dust) {
    const tw = 0.5 + 0.5 * Math.sin(field.time * 1.3 + s.phase);
    const x = ox + Math.floor((s.x - ox) / cw) * cw;
    const y = oy + Math.floor((s.y - oy) / ch) * ch;
    ctx.globalAlpha = 0.12 + 0.2 * tw;
    ctx.fillText(tw > 0.85 ? "+" : ".", x + cw / 2, y + ch / 2 + 0.5);
  }
  const row = w * 4;
  for (let cy = 0; cy < rows; cy++)
    for (let cx = 0; cx < cols; cx++) {
      const n = cy * cols + cx;
      const star = lit.get(n);
      const i = cy * SS * row + cx * SS * 4;
      const tv = (data[i + 1]! + data[i + 5]! + data[i + row + 1]! + data[i + row + 5]!) / 1020;
      if (!star && tv < 0.08) continue;
      const x = ox + cx * cw;
      const y = oy + cy * ch;
      const keep = clearing(x + cw / 2, y + ch / 2, d.shapes, d.glow, cw / 2, ch / 2);
      if (keep < 0.02) continue;
      const starA = star ? (0.25 + 0.75 * star.b) * star.a : 0;
      if (star && starA >= tv * 1.1) {
        // The star in this cell (all of it, or fading in or out), unless a streak is brighter here.
        if (star.b > 0.75) {
          ctx.globalAlpha = 0.85 * keep * star.a;
          ctx.fillStyle = rgb(mix(star.c, [255, 255, 255], 0.5));
          ctx.fillRect(x + 0.5, y + 0.5, cw - 1, ch - 1);
          ctx.globalAlpha = keep * star.a;
          ctx.fillStyle = "rgb(8 10 18)";
          ctx.fillText("@", x + cw / 2, y + ch / 2 + 0.5);
        } else {
          ctx.globalAlpha = Math.min(1, starA * keep);
          ctx.fillStyle = rgb(star.c);
          ctx.fillText(
            star.b > 0.45 ? "*" : star.b > 0.2 ? "+" : ".",
            x + cw / 2,
            y + ch / 2 + 0.5,
          );
        }
        continue;
      }
      const a = tv * 1.1;
      const angle = Math.atan2(y + ch / 2 - field.vy, x + cw / 2 - field.vx);
      ctx.globalAlpha = Math.min(1, a * keep);
      ctx.fillStyle = streakFill;
      ctx.fillText(streakChar(angle), x + cw / 2, y + ch / 2 + 0.5);
    }
  ctx.globalAlpha = 1;
}

function drawBlocks(d: StarDraw, stars: Starfield["stars"], starColor: (t: number) => Rgb) {
  const { ctx, field, dpr, t } = d;
  const px = Math.max(1, Math.round(t.pixel));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const block = (bx: number, by: number, c: Rgb, a: number) => {
    if (a <= 0.01) return;
    // Thinned out round the icon, words and title, as ASCII art is.
    const keep = clearing((bx + 0.5) * px, (by + 0.5) * px, d.shapes, d.glow, px / 2, px / 2);
    if (keep < 0.02) return;
    ctx.globalAlpha = Math.min(1, a * keep);
    ctx.fillStyle = rgb(c);
    const x0 = Math.round(bx * px * dpr);
    const y0 = Math.round(by * px * dpr);
    ctx.fillRect(
      x0,
      y0,
      Math.round((bx + 1) * px * dpr) - x0,
      Math.round((by + 1) * px * dpr) - y0,
    );
  };
  for (const s of field.dust) {
    const tw = 0.5 + 0.5 * Math.sin(field.time * 1.3 + s.phase);
    block(Math.floor(s.x / px), Math.floor(s.y / px), [150, 160, 190], 0.1 + 0.25 * tw);
  }
  for (const s of stars) {
    const p = project(field, s);
    const c = starColor(s.tint);
    const b = p.near ** 1.4;
    const bx = Math.floor(p.x / px);
    const by = Math.floor(p.y / px);
    // The streak: dithered blocks back along its path, fading.
    const tail = streakTail(field, s, t);
    const len = Math.hypot(p.x - tail.x, p.y - tail.y);
    if (len > px) {
      const steps = Math.ceil(len / px);
      for (let i = 1; i <= steps; i++) {
        const k = i / steps;
        const sx = Math.floor((p.x + (tail.x - p.x) * k) / px);
        const sy = Math.floor((p.y + (tail.y - p.y) * k) / px);
        const fade = b * (1 - k);
        if (BAYER[(((sy % 4) + 4) % 4) * 4 + (((sx % 4) + 4) % 4)]! < 0.3 + fade)
          block(sx, sy, c, fade);
      }
    }
    block(bx, by, mix(c, [255, 255, 255], b * 0.6), 0.3 + 0.7 * b);
    // The nearest sparkle: a small plus.
    if (b > 0.55) {
      const a = (b - 0.55) / 0.45;
      block(bx - 1, by, c, a * 0.7);
      block(bx + 1, by, c, a * 0.7);
      block(bx, by - 1, c, a * 0.7);
      block(bx, by + 1, c, a * 0.7);
    }
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
  if (a <= 0.005 || r <= 0) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgb(${c[0]} ${c[1]} ${c[2]} / ${Math.min(1, a)})`);
  g.addColorStop(1, `rgb(${c[0]} ${c[1]} ${c[2]} / 0)`);
  ctx.globalAlpha = 1;
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

function mix(a: Rgb, b: Rgb, k: number): Rgb {
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
  ];
}

function rgb(c: Rgb): string {
  return `rgb(${c[0]} ${c[1]} ${c[2]})`;
}

/** A streak's character for the way it runs on screen (radians): `- \ | /`. */
export function streakChar(angle: number): string {
  const a = ((angle % Math.PI) + Math.PI) % Math.PI;
  if (a < Math.PI / 8 || a >= (7 * Math.PI) / 8) return "-";
  if (a < (3 * Math.PI) / 8) return "\\";
  if (a < (5 * Math.PI) / 8) return "|";
  return "/";
}
