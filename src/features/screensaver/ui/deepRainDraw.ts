import { type DeepRainTuning, dropChar, lensPart } from "../model/deepRain";
import type { Rgb } from "../model/palettes";
import { BEAD, type Drop, type RainScene } from "../model/rain";
import { SLOT } from "../model/scene";
import type { AsciiColors } from "../../emptyToys/ui/asciiPaint";
import { type AsciiGlowTuning, type ClearShape, clearing } from "../../mailbox/model/asciiGlow";
import { crossFade } from "./deepStarsDraw";

const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const WHITE: Rgb = [255, 255, 255];

export type RainDraw = {
  ctx: CanvasRenderingContext2D;
  scene: RainScene;
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
  t: DeepRainTuning;
};

/** Each drop's column in ASCII art, kept between frames. */
const columns = new WeakMap<Drop, number>();

/**
 * A drop's column: the one it was in until it is well into the next. A
 * sliding drop wobbles sideways a little every frame, and one on the line
 * between two columns flipped between them, back and forth.
 */
export function stickyColumn(drop: Drop, gx: number): number {
  const was = columns.get(drop);
  const col = was !== undefined && gx > was - 0.3 && gx < was + 1.3 ? was : Math.floor(gx);
  columns.set(drop, col);
  return col;
}

/** A small fixed random number (0–1) for a cell, so textures hold still. */
function hash(i: number): number {
  const v = Math.sin(i * 12.9898 + 4.1) * 43758.5453;
  return v - Math.floor(v);
}

/**
 * Draws rain on the glass (`model/rain.ts`) in chunky pixel art or ASCII
 * art: the fog on the pane, thinned where drops ran or the pointer wiped,
 * fresh wet trails, the beads of condensation, then the drops. In pixel
 * art a drop is a lens of blocks (its glint at the top left, a dark rim,
 * the light it gathers at its bottom, clear between), stretched into a
 * teardrop while it slides, with a soft light round the glint. In ASCII
 * art the fog is a faint, still speckle of dots, a wet trail is a line of
 * `|`, and a drop is a character by its size (`. o O @`), the biggest
 * between `(` and `)`, fading from one row into the next as it slides.
 */
export function drawDeepRain(d: RainDraw) {
  const { ctx, dpr } = d;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, d.width * dpr, d.height * dpr);
  const color = (slot: number): Rgb => d.slots[slot] ?? [180, 190, 210];
  if (d.look === "ascii") drawAscii(d, color);
  else drawBlocks(d, color);
  ctx.globalAlpha = 1;
}

/** The fog (0–1) and a fresh trail (0–1) over a box of the scene's cells. */
function sampleGlass(scene: RainScene, c0: number, r0: number, c1: number, r1: number) {
  const { cols, rows } = scene.size;
  let fog = 0;
  let trail = 0;
  let n = 0;
  for (let r = Math.max(0, r0); r < Math.min(rows, r1); r++)
    for (let c = Math.max(0, c0); c < Math.min(cols, c1); c++) {
      const i = r * cols + c;
      const tr = scene.trail[i]!;
      fog += (1 - Math.max(tr, scene.wiped[i]!)) * scene.mist[i]!;
      trail = Math.max(trail, tr);
      n++;
    }
  return { fog: n ? fog / n : 0, trail };
}

function drawBlocks(d: RainDraw, color: (slot: number) => Rgb) {
  const { ctx, dpr, scene, px, t } = d;
  const B = Math.max(1, Math.round(t.pixel));
  const cols = Math.ceil(d.width / B);
  const rows = Math.ceil(d.height / B);
  const block = (bx: number, by: number, c: Rgb, a: number) => {
    if (a <= 0.01 || bx < 0 || by < 0 || bx >= cols || by >= rows) return;
    const keep = clearing(bx * B + B / 2, by * B + B / 2, d.shapes, d.glow, B / 2, B / 2);
    if (keep < 0.02) return;
    ctx.globalAlpha = Math.min(1, a * keep);
    ctx.fillStyle = rgb(c);
    const x0 = Math.round(bx * B * dpr);
    const y0 = Math.round(by * B * dpr);
    ctx.fillRect(x0, y0, Math.round((bx + 1) * B * dpr) - x0, Math.round((by + 1) * B * dpr) - y0);
  };
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const { fogColor, wet } = inks(d, color);
  // The glass: fog, and fresh trails through it.
  for (let by = 0; by < rows; by++)
    for (let bx = 0; bx < cols; bx++) {
      const g = sampleGlass(
        scene,
        Math.floor((bx * B) / px),
        Math.floor((by * B) / px),
        Math.ceil(((bx + 1) * B) / px),
        Math.ceil(((by + 1) * B) / px),
      );
      if (g.fog > 0.05) block(bx, by, fogColor, g.fog * 0.12 * t.fog);
      if (g.trail > 0.6) block(bx, by, wet, (g.trail - 0.6) * 0.4 * t.trail);
    }
  const glints: { x: number; y: number; r: number }[] = [];
  for (const drop of scene.drops) {
    if (drop.life <= 0) continue;
    const x = drop.x * px;
    const y = drop.y * px;
    if (drop.r < BEAD) {
      // Faint, and only the larger beads: a block each, they read as static.
      if (drop.r > 1) block(Math.floor(x / B), Math.floor(y / B), wet, 0.05 + drop.r * 0.08);
      continue;
    }
    const rx = drop.r * px;
    const ry = rx * (drop.sliding ? 1 + Math.min(0.45, drop.vy / 50) : 0.92);
    const big = drop.r > 2;
    for (let by = Math.floor((y - ry) / B); by <= Math.floor((y + ry) / B); by++)
      for (let bx = Math.floor((x - rx) / B); bx <= Math.floor((x + rx) / B); bx++) {
        const ny = (by * B + B / 2 - y) / ry;
        // Narrower toward the top while it slides: a teardrop.
        const wide = ny < 0 && drop.sliding ? 1 + ny * 0.3 : 1;
        const nx = (bx * B + B / 2 - x) / (rx * wide);
        const part = lensPart(nx, ny, big);
        if (part === "glint") block(bx, by, WHITE, 1);
        else if (part === "rim") block(bx, by, mix(color(SLOT.mid), color(SLOT.dark), 0.5), 0.8);
        else if (part === "low") block(bx, by, mix(wet, color(SLOT.accent), 0.3), 0.55 + ny * 0.3);
        else if (part === "clear") block(bx, by, wet, 0.16 + (ny + 1) * 0.07);
      }
    if (big) glints.push({ x: x - rx * 0.35, y: y - ry * 0.42, r: rx * 1.4 });
  }
  if (t.glint > 0) {
    ctx.globalCompositeOperation = d.page.dark ? "lighter" : "source-over";
    for (const g of glints) softGlow(ctx, g.x * dpr, g.y * dpr, g.r * dpr, WHITE, t.glint * 0.18);
    ctx.globalCompositeOperation = "source-over";
  }
}

function drawAscii(d: RainDraw, color: (slot: number) => Rgb) {
  const { ctx, dpr, scene, px, cw, ch, ox, oy, t } = d;
  const cols = Math.ceil((d.width - ox) / cw);
  const rows = Math.ceil((d.height - oy) / ch);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.font = `500 ${d.fontPx}px ${MONO}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const put = (cx: number, cy: number, char: string, c: Rgb, a: number) => {
    if (a <= 0.02 || cx < 0 || cy < 0 || cx >= cols || cy >= rows) return;
    const x = ox + cx * cw + cw / 2;
    const y = oy + cy * ch + ch / 2;
    const keep = clearing(x, y, d.shapes, d.glow, cw / 2, ch / 2);
    if (keep < 0.02) return;
    ctx.globalAlpha = Math.min(1, a * keep);
    ctx.fillStyle = rgb(c);
    ctx.fillText(char, x, y + 0.5);
  };
  const { fogColor, wet } = inks(d, color);
  // The glass: a faint, still speckle of fog, and wet trails through it.
  const taken = new Set<number>();
  for (let cy = 0; cy < rows; cy++)
    for (let cx = 0; cx < cols; cx++) {
      const x = ox + cx * cw;
      const y = oy + cy * ch;
      const g = sampleGlass(
        scene,
        Math.floor(x / px),
        Math.floor(y / px),
        Math.ceil((x + cw) / px),
        Math.ceil((y + ch) / px),
      );
      if (g.trail > 0.35) {
        put(cx, cy, "|", wet, (g.trail - 0.35) * 0.55 * t.trail);
        taken.add(cy * cols + cx);
      } else if (g.fog > 0.3 && hash(cy * cols + cx) < 0.07)
        put(cx, cy, ".", fogColor, g.fog * 0.16 * t.fog);
    }
  // Beads, then drops over them.
  for (const drop of scene.drops) {
    if (drop.life <= 0 || drop.r >= BEAD || drop.r < 1.1) continue;
    put(
      Math.floor((drop.x * px - ox) / cw),
      Math.floor((drop.y * px - oy) / ch),
      ".",
      wet,
      0.15 + drop.r * 0.15,
    );
  }
  for (const drop of scene.drops) {
    if (drop.life <= 0 || drop.r < BEAD) continue;
    const gx = (drop.x * px - ox) / cw;
    const gy = (drop.y * px - oy) / ch;
    const cx = stickyColumn(drop, gx);
    const cy = Math.floor(gy);
    const char = dropChar(drop.r);
    const c = d.page.dark ? mix(wet, WHITE, Math.min(0.6, drop.r / 10)) : wet;
    // From one row into the next, it fades across rather than hops (and
    // holds that blend when it catches, rather than snapping to one row).
    const fy = crossFade(gy - cy);
    const rows2: [number, number][] = [
      [cy, 1 - fy.share],
      [cy + fy.step, fy.share],
    ];
    for (const [row, share] of rows2) {
      if (share <= 0.02) continue;
      put(cx, row, char, c, (0.6 + drop.r * 0.06) * share);
      // A big drop spans three cells: (O)
      if (drop.r >= 5) {
        put(cx - 1, row, "(", mix(color(SLOT.mid), wet, 0.5), 0.55 * share);
        put(cx + 1, row, ")", mix(color(SLOT.mid), wet, 0.5), 0.55 * share);
      }
    }
    // A sliding drop's tail, just above it.
    if (drop.sliding && drop.vy > 12 && !taken.has((cy - 1) * cols + cx))
      put(cx, cy - 1, "'", wet, 0.35);
  }
}

/**
 * The fog's and the water's colors. On a dark page, the palette's light
 * color; on a light page that is nearly white and vanishes, so darker ones.
 */
function inks(d: RainDraw, color: (slot: number) => Rgb): { fogColor: Rgb; wet: Rgb } {
  if (d.page.dark)
    return { fogColor: mix(color(SLOT.mid), color(SLOT.light), 0.35), wet: color(SLOT.light) };
  return {
    fogColor: mix(color(SLOT.mid), [70, 78, 96], 0.4),
    wet: mix(color(SLOT.mid), color(SLOT.accent), 0.5),
  };
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
