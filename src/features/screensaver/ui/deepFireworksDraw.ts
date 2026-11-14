import { type DeepFireworkTuning, sparkChar, sparkLight } from "../model/deepFireworks";
import type { FireworksScene, Spark } from "../model/fireworks";
import type { Rgb } from "../model/palettes";
import { SLOT } from "../model/scene";
import type { AsciiColors } from "../../emptyToys/ui/asciiPaint";
import { type AsciiGlowTuning, type ClearShape, clearing } from "../../mailbox/model/asciiGlow";
import { streakChar } from "./deepStarsDraw";

const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
/** Bayer 4×4: ordered dithering's thresholds, 0–1. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const WHITE: Rgb = [255, 255, 255];

export type FireworkDraw = {
  ctx: CanvasRenderingContext2D;
  scene: FireworksScene;
  /** Screen pixels per scene cell (the scene moves in cells). */
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
  /** A night sky (a light page), from the palette's darkest color. */
  backdrop: boolean;
  t: DeepFireworkTuning;
};

/** One mark on the grid: its color, how bright, and its character (ASCII). */
type Mark = { c: Rgb; a: number; char: string; head: boolean; hot?: boolean };

/**
 * Draws the fireworks (`model/fireworks.ts`) in chunky pixel art or ASCII
 * art. Under everything, soft light: each burst's flash, and a glow round
 * young sparks and rockets, added together so a burst lights the sky; then
 * its smoke, drifting up. Over that, the sparks on the grid: each a block
 * or a character, white-hot when new and cooling to its shell's color, with
 * its trail behind it (dithered blocks, or characters along its path) and,
 * for a moment after a burst, a small plus of blocks round it (in ASCII,
 * a pale tile). A cell shows its brightest
 * mark, so a dense burst stays crisp instead of piling up.
 */
export function drawDeepFireworks(d: FireworkDraw) {
  const { ctx, scene, dpr, t, px } = d;
  const W = d.width * dpr;
  const H = d.height * dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, W, H);
  const dark = d.page.dark || d.backdrop;
  if (d.backdrop) {
    const top = d.slots[SLOT.dark] ?? [20, 24, 40];
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, rgb(mix(top, [0, 0, 0], 0.6)));
    grad.addColorStop(1, rgb(mix(top, [0, 0, 0], 0.35)));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }
  const colorOf = (slot: number): Rgb => d.slots[slot] ?? [200, 200, 220];
  const accent = colorOf(SLOT.accent);

  // Smoke: faint, drifting up, under the light.
  if (t.smoke > 0) {
    const smoke = mix(colorOf(SLOT.mid), dark ? [120, 124, 140] : [80, 84, 96], 0.5);
    for (const f of scene.puffs) {
      if (!f.smoke) continue;
      const a = (f.life / f.max) * t.smoke * 0.12 * (1 - f.depth * 0.5);
      softGlow(ctx, f.x * px * dpr, f.y * px * dpr, f.r * px * dpr, smoke, a);
    }
  }
  // Light: flashes and the glow of young sparks, added up.
  ctx.globalCompositeOperation = dark ? "lighter" : "source-over";
  if (t.flash > 0)
    for (const f of scene.puffs) {
      if (f.smoke) continue;
      const a = (f.life / f.max) * t.flash * 0.5 * (1 - f.depth * 0.5);
      softGlow(
        ctx,
        f.x * px * dpr,
        f.y * px * dpr,
        f.r * px * 1.6 * dpr,
        mix(accent, WHITE, 0.4),
        a,
      );
    }
  if (t.bloom > 0) {
    // Every third spark carries the light of its neighbors, so a burst of
    // a hundred and more stays cheap to draw.
    scene.sparks.forEach((p, i) => {
      if (p.small || i % 3) return;
      const { age, fade, cool } = sparkLight(p.life, p.max, p.depth);
      if (age > 0.8) return;
      const c = mix(WHITE, colorOf(p.slot), cool);
      softGlow(
        ctx,
        p.x * px * dpr,
        p.y * px * dpr,
        16 * dpr,
        c,
        t.bloom * 0.5 * fade * (0.8 - age),
      );
    });
    for (const r of scene.rockets)
      softGlow(ctx, r.x * px * dpr, r.y * px * dpr, 8 * dpr, colorOf(SLOT.light), t.bloom * 0.5);
  }
  ctx.globalCompositeOperation = "source-over";

  const sparks = scene.sparks.toSorted((a, b) => b.depth - a.depth);
  if (d.look === "ascii") drawAscii(d, sparks, colorOf, dark);
  else drawBlocks(d, sparks, colorOf);
  ctx.globalAlpha = 1;
}

/** Each spark's marks: its trail points (oldest last) and its head, in screen pixels. */
function eachMark(
  d: FireworkDraw,
  sparks: Spark[],
  colorOf: (slot: number) => Rgb,
  step: number,
  put: (x: number, y: number, m: Mark, dx: number, dy: number) => void,
) {
  const { px, scene } = d;
  for (const p of sparks) {
    const { age, fade, cool } = sparkLight(p.life, p.max, p.depth);
    const color = colorOf(p.slot);
    // Glitter: the old ones twinkle.
    const tw = age > 0.7 && !p.to ? 0.6 + 0.4 * Math.sin(scene.time * 40 + p.x) : 1;
    const tail = Math.max(1, Math.round(p.tail * d.t.trail));
    const trail = p.trail.slice(0, tail);
    let prev = { x: p.x, y: p.y };
    trail.forEach((q, k) => {
      const dx = (prev.x - q.x) * px;
      const dy = (prev.y - q.y) * px;
      const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / step));
      for (let s = 0; s < n; s++) {
        const u = s / n;
        const along = (k + u) / tail;
        put(
          (prev.x + (q.x - prev.x) * u) * px,
          (prev.y + (q.y - prev.y) * u) * px,
          {
            c: mix(color, colorOf(SLOT.mid), along * 0.6),
            a: fade * (1 - along) * 0.75,
            char: "",
            head: false,
          },
          dx,
          dy,
        );
      }
      prev = q;
    });
    put(
      p.x * px,
      p.y * px,
      {
        c: mix(WHITE, color, cool),
        a: fade * tw,
        char: p.to ? "*" : sparkChar(age, p.small),
        head: true,
        // Just burst: white-hot, for a moment.
        hot: !p.small && !p.to && age < 0.06,
      },
      p.vx,
      p.vy,
    );
  }
  for (const r of scene.rockets)
    put(r.x * px, r.y * px, { c: WHITE, a: 1 - r.depth * 0.4, char: "^", head: true }, r.vx, r.vy);
}

function drawBlocks(d: FireworkDraw, sparks: Spark[], colorOf: (slot: number) => Rgb) {
  const { ctx, dpr, t } = d;
  const px = Math.max(1, Math.round(t.pixel));
  const cols = Math.ceil(d.width / px);
  const rows = Math.ceil(d.height / px);
  const marks = new Map<number, Mark>();
  const mark = (bx: number, by: number, m: Mark) => {
    if (bx < 0 || by < 0 || bx >= cols || by >= rows || m.a <= 0.02) return;
    const n = by * cols + bx;
    const had = marks.get(n);
    if (!had || had.a < m.a) marks.set(n, m);
  };
  eachMark(d, sparks, colorOf, px, (x, y, m) => {
    const bx = Math.floor(x / px);
    const by = Math.floor(y / px);
    // Trails thin out in a dither as they fade: pixel art's way of fading.
    if (!m.head && BAYER[(by & 3) * 4 + (bx & 3)]! > 0.45 + m.a) return;
    mark(bx, by, m);
    // A bright head: a small plus of blocks.
    if (m.hot) {
      const arm = { ...m, a: m.a * 0.5, head: false, hot: false };
      mark(bx - 1, by, arm);
      mark(bx + 1, by, arm);
      mark(bx, by - 1, arm);
      mark(bx, by + 1, arm);
    }
  });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (const [n, m] of marks) {
    const bx = n % cols;
    const by = (n - bx) / cols;
    const cx = bx * px + px / 2;
    const cy = by * px + px / 2;
    const keep = clearing(cx, cy, d.shapes, d.glow, px / 2, px / 2);
    if (keep < 0.02) continue;
    ctx.globalAlpha = Math.min(1, m.a * keep);
    ctx.fillStyle = rgb(m.c);
    const x0 = Math.round(bx * px * dpr);
    const y0 = Math.round(by * px * dpr);
    ctx.fillRect(
      x0,
      y0,
      Math.round((bx + 1) * px * dpr) - x0,
      Math.round((by + 1) * px * dpr) - y0,
    );
  }
}

function drawAscii(
  d: FireworkDraw,
  sparks: Spark[],
  colorOf: (slot: number) => Rgb,
  dark: boolean,
) {
  const { ctx, cw, ch, ox, oy, dpr } = d;
  const cols = Math.ceil((d.width - ox) / cw);
  const rows = Math.ceil((d.height - oy) / ch);
  const marks = new Map<number, Mark>();
  eachMark(d, sparks, colorOf, Math.min(cw, ch) * 0.7, (x, y, m, dx, dy) => {
    const cx = Math.floor((x - ox) / cw);
    const cy = Math.floor((y - oy) / ch);
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows || m.a <= 0.04) return;
    const n = cy * cols + cx;
    const had = marks.get(n);
    // A spark's head wins over a trail of about the same brightness.
    if (had && had.a + (had.head ? 0.15 : 0) >= m.a + (m.head ? 0.15 : 0)) return;
    // A trail's character follows its spark's path.
    marks.set(n, m.head ? m : { ...m, char: streakChar(Math.atan2(dy, dx)) });
  });
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.font = `500 ${d.fontPx}px ${MONO}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const [n, m] of marks) {
    const cx = n % cols;
    const cy = (n - cx) / cols;
    const x = ox + cx * cw;
    const y = oy + cy * ch;
    const keep = clearing(x + cw / 2, y + ch / 2, d.shapes, d.glow, cw / 2, ch / 2);
    if (keep < 0.02) continue;
    // The hottest, brightest heads: a dark character on a pale tile.
    if (m.hot && m.a > 0.85) {
      ctx.globalAlpha = 0.85 * keep;
      ctx.fillStyle = rgb(mix(m.c, WHITE, 0.3));
      ctx.fillRect(x + 0.5, y + 0.5, cw - 1, ch - 1);
      ctx.globalAlpha = keep;
      ctx.fillStyle = "rgb(8 10 18)";
      ctx.fillText("*", x + cw / 2, y + ch / 2 + 0.5);
      continue;
    }
    ctx.globalAlpha = Math.min(1, m.a * keep * (dark ? 1 : 1.15));
    ctx.fillStyle = rgb(m.c);
    ctx.fillText(m.char, x + cw / 2, y + ch / 2 + 0.5);
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
