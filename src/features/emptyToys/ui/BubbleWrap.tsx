import { type RefObject, useEffect, useRef } from "react";
import {
  allPopped,
  BUBBLE_PITCH,
  bubbleAt,
  gridSheetFor,
  pop,
  type Sheet,
  sheetFor,
} from "../model/bubbles";
import {
  bubbleTuning,
  burst,
  confettiColors,
  filmSettle,
  flash,
  inflate,
  jiggle,
  nextStreak,
  type Particle,
  popShape,
  stepParticles,
} from "../model/bubblePop";
import type { Rect } from "../../screensaver/model/scene";
import type { Rgb } from "../../screensaver/model/palettes";
import type { ToyboxStyle } from "../model/style";
import { asciiGlowTuning } from "../../mailbox/model/asciiGlow";
import {
  type AsciiColors,
  asciiCell,
  AsciiPainter,
  GLYPH_ON_HOT,
  mix,
  readAsciiColors,
} from "./asciiPaint";

/** How long after a pop it still moves the bubbles around it, in seconds. */
/** A pop's age that shows it done (squashed, flashed, its film lying flat), with less motion. */
const SETTLED = 60;
const SHOCK_SECONDS = 0.8;
const ASCII_CHARS = "()'-~_.*+xo";

/**
 * Bubble wrap, with joyful pops (`model/bubblePop.ts`), in chunky pixel art
 * or ASCII art, on the same grid as the glow, sky and pond. A click pops
 * the bubble under it; holding the button and dragging pops a row. When
 * every bubble is popped, confetti rises from the film, the sheet blows
 * away and a fresh one inflates. It only draws while something moves.
 */
export function BubbleWrapLayer({
  areaRef,
  width,
  height,
  left,
  top,
  clear,
  style,
}: {
  areaRef: RefObject<HTMLElement | null>;
  width: number;
  height: number;
  left: number;
  top: number;
  clear: Rect[];
  style: ToyboxStyle;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const placeRef = useRef({ left, top, clear });
  useEffect(() => {
    placeRef.current = { left, top, clear };
  }, [left, top, clear]);

  useEffect(() => {
    const area = areaRef.current;
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!area || !canvas || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const painter = new AsciiPainter(ctx);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

    // Pixel art lays the sheet out freely; ASCII art on the character grid,
    // lined up with the glow's across the card.
    const freshSheet = (): Sheet => {
      if (style !== "ascii") return sheetFor(width, height, placeRef.current.clear);
      const g = asciiGlowTuning();
      const { cw, ch } = asciiCell(ctx, g.fontPx, g.lineHeight);
      const { left: l, top: tp, clear: keep } = placeRef.current;
      const ox = -(((l % cw) + cw) % cw);
      const oy = -(((tp % ch) + ch) % ch);
      return gridSheetFor(width, height, keep, cw, ch, ox, oy);
    };
    let sheet: Sheet = freshSheet();
    /** When each bubble popped (seconds, the frame clock). */
    const poppedAt = new Map<number, number>();
    let particles: Particle[] = [];
    let streak = 0;
    let lastPop = -Infinity;
    /** The finale: when the last bubble popped, and when the fresh sheet began inflating. */
    let finaleAt: number | null = null;
    let inflatingAt: number | null = performance.now() / 1000;
    let frame = 0;
    let last = performance.now();
    const mid = { x: width / 2, y: height / 2 };
    const farthest = Math.hypot(width / 2, height / 2);

    const clock = () => performance.now() / 1000;

    const popAt = (x: number, y: number) => {
      if (finaleAt !== null) return;
      const i = bubbleAt(sheet, x, y);
      if (i === null) return;
      const now = clock();
      const t = bubbleTuning();
      streak = nextStreak(streak, now - lastPop, t);
      lastPop = now;
      poppedAt.set(i, now);
      sheet = pop(sheet, i);
      if (!reduce.matches) {
        const c = sheet.centres[i]!;
        particles.push(...burst(c.x, c.y, sheet.radius, streak, Math.random, t));
      }
      if (allPopped(sheet)) {
        finaleAt = now;
        if (!reduce.matches)
          for (const c of sheet.centres)
            particles.push(
              ...burst(c.x, c.y, sheet.radius * 0.6, 0, Math.random, {
                ...t,
                confetti: 3,
                puffs: 0,
                speed: t.speed * 0.7,
              }),
            );
      }
      wake();
    };

    const draw = (now: number) => {
      const t = bubbleTuning();
      const colors = readAsciiColors(asciiGlowTuning().hotMixDark, asciiGlowTuning().hotMixLight);
      const confetti = confettiColors(colors.accent);
      const shine = mix(colors.accent, [255, 255, 255], colors.dark ? 0.75 : 0.85);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // The finale: the old sheet blows away, then a fresh one inflates.
      // With less motion asked for (read each frame, so a change applies at
      // once): no squash, flash or settling film (a pop shows as done), no
      // jiggle of the neighbors, and a fresh sheet replaces the old one
      // without blowing away or inflating.
      const still = reduce.matches;
      let sheetFade = 1;
      if (finaleAt !== null) {
        const since = now - finaleAt;
        if (!still) sheetFade = Math.max(0, 1 - since / (t.refillSeconds * 0.8));
        if (since >= t.refillSeconds) {
          sheet = freshSheet();
          poppedAt.clear();
          finaleAt = null;
          inflatingAt = still ? null : now;
          streak = 0;
        }
      }
      const shocks = still ? [] : [...poppedAt].filter(([, at]) => now - at < SHOCK_SECONDS);

      const looks = sheet.centres.map((c, n) => {
        const quirk = sheet.quirks[n]!;
        const r = sheet.radius * (0.92 + 0.12 * quirk);
        let scale = 1;
        for (const [i, at] of shocks) {
          if (i === n) continue;
          const o = sheet.centres[i]!;
          scale += jiggle(Math.hypot(o.x - c.x, o.y - c.y), now - at, BUBBLE_PITCH, t);
        }
        if (inflatingAt !== null && !still)
          scale *= inflate(now - inflatingAt, Math.hypot(c.x - mid.x, c.y - mid.y) / farthest, t);
        const at = poppedAt.get(n);
        const age = at === undefined ? null : still ? SETTLED : now - at;
        return { c, r, quirk, scale, age };
      });
      if (inflatingAt !== null && now - inflatingAt > t.inflateSeconds + 0.1) inflatingAt = null;

      if (style === "ascii") drawAscii(looks, colors, confetti, shine, sheetFade, t);
      else drawPixels(looks, colors, confetti, shine, sheetFade, t);
      ctx.globalAlpha = 1;
    };

    type Look = {
      c: { x: number; y: number };
      r: number;
      quirk: number;
      scale: number;
      age: number | null;
    };

    const drawPixels = (
      looks: Look[],
      colors: AsciiColors,
      confetti: Rgb[],
      shine: Rgb,
      fade: number,
      t: ReturnType<typeof bubbleTuning>,
    ) => {
      const px = Math.max(1, Math.round(t.pixel));
      const { left: l, top: tp } = placeRef.current;
      const ox = -(((l % px) + px) % px);
      const oy = -(((tp % px) + px) % px);
      const block = (bx: number, by: number, rgb: Rgb, a: number, w = 1, h = 1) => {
        if (a <= 0.005) return;
        ctx.globalAlpha = Math.min(1, a);
        ctx.fillStyle = `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`;
        const x0 = Math.round((ox + bx * px) * dpr);
        const y0 = Math.round((oy + by * px) * dpr);
        ctx.fillRect(
          x0,
          y0,
          Math.round((ox + (bx + w) * px) * dpr) - x0,
          Math.round((oy + (by + h) * px) * dpr) - y0,
        );
      };
      const toBlock = (x: number, y: number) => ({
        bx: Math.floor((x - ox) / px),
        by: Math.floor((y - oy) / px),
      });
      const deep = colors.dark
        ? mix(colors.accent, colors.base, 0.3)
        : mix(colors.accent, colors.content, 0.35);
      const glows: { x: number; y: number; r: number; a: number }[] = [];

      for (const { c, r, quirk, scale, age } of looks) {
        const shape = age === null ? { sx: 1, sy: 1 } : popShape(age, t);
        const { bx: cx, by: cy } = toBlock(c.x, c.y);
        const reach = Math.ceil((r * 1.4 * scale) / px) + 1;
        if (shape) {
          // A dome of blocks lit from the top left: clear inside, a darker
          // rim, a bright highlight.
          const rx = r * scale * shape.sx;
          const ry = r * scale * shape.sy;
          if (rx <= 0.5) continue;
          for (let dy = -reach; dy <= reach; dy++)
            for (let dx = -reach; dx <= reach; dx++) {
              const x = ox + (cx + dx + 0.5) * px - c.x;
              const y = oy + (cy + dy + 0.5) * px - c.y;
              const d = Math.hypot(x / rx, y / ry);
              if (d >= 1) continue;
              const hx = x / rx + 0.42;
              const hy = y / ry + 0.42;
              if (Math.hypot(hx, hy) < 0.24) block(cx + dx, cy + dy, shine, 0.9 * fade);
              else if (d > 0.78) block(cx + dx, cy + dy, deep, 0.55 * fade);
              else block(cx + dx, cy + dy, colors.accent, (0.1 + 0.18 * d) * fade);
            }
        } else if (age !== null) {
          // The film: a flattened, crumpled patch, dropping into place.
          const settle = filmSettle(age, t);
          const rx = r * 0.8 * settle;
          const ry = r * 0.42 * settle;
          for (let dy = -reach; dy <= reach; dy++)
            for (let dx = -reach; dx <= reach; dx++) {
              const x = ox + (cx + dx + 0.5) * px - c.x;
              const y = oy + (cy + dy + 0.5) * px - (c.y + r * 0.2);
              const wrinkle = 0.82 + 0.25 * hash(quirk * 97 + dx * 13 + dy * 7);
              const d = Math.hypot(x / Math.max(1, rx), y / Math.max(1, ry));
              if (d >= wrinkle) continue;
              const crease = Math.abs(dy) === 0 && (dx + Math.round(quirk * 5)) % 3 === 0;
              block(cx + dx, cy + dy, crease ? deep : colors.accent, (crease ? 0.4 : 0.16) * fade);
            }
          // The flash: a bright ring flying out.
          const f = flash(age, t);
          if (f) {
            const ring = r * f.reach;
            const steps = Math.max(8, Math.round((ring * 2 * Math.PI) / px));
            for (let k = 0; k < steps; k++) {
              const a = (k / steps) * Math.PI * 2;
              const p = toBlock(c.x + Math.cos(a) * ring, c.y + Math.sin(a) * ring * 0.9);
              block(p.bx, p.by, shine, f.alpha);
            }
            glows.push({ x: c.x, y: c.y, r: r * 2.4, a: f.alpha });
          }
        }
      }
      // Confetti tumbling (wide, then tall, as it turns), and puffs of air.
      for (const p of particles) {
        const k = p.age / p.life;
        const a = k > 0.75 ? (1 - k) / 0.25 : 1;
        const b = toBlock(p.x, p.y);
        if (p.kind === "confetti") {
          const wide = p.spin < 0.5;
          block(b.bx, b.by, confetti[p.tone]!, a, wide ? 2 : 1, wide ? 1 : 2);
        } else block(b.bx, b.by, colors.content, 0.12 * a, 2, 2);
      }
      // The light: a soft glow around each burst.
      if (t.bloom > 0 && glows.length) {
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = colors.dark ? "lighter" : "source-over";
        const [ar, ag, ab] = colors.accent;
        for (const g of glows) {
          const gx = g.x * dpr;
          const gy = g.y * dpr;
          const rr = g.r * dpr;
          const grad = ctx.createRadialGradient(gx, gy, 0, gx, gy, rr);
          grad.addColorStop(0, `rgb(${ar} ${ag} ${ab} / ${0.4 * t.bloom * g.a})`);
          grad.addColorStop(1, `rgb(${ar} ${ag} ${ab} / 0)`);
          ctx.fillStyle = grad;
          ctx.fillRect(gx - rr, gy - rr, rr * 2, rr * 2);
        }
        ctx.globalCompositeOperation = "source-over";
      }
    };

    const drawAscii = (
      looks: Look[],
      colors: AsciiColors,
      confetti: Rgb[],
      shine: Rgb,
      fade: number,
      t: ReturnType<typeof bubbleTuning>,
    ) => {
      const g = asciiGlowTuning();
      const { cw, ch } = asciiCell(ctx, g.fontPx, g.lineHeight);
      // Confetti in its own colors, after the painter's accent rows.
      painter.prepare(cw, ch, dpr, g.fontPx, ASCII_CHARS, colors, [...confetti, shine]);
      const SHINE = GLYPH_ON_HOT + 1 + confetti.length;
      const { left: l, top: tp } = placeRef.current;
      const ox = -(((l % cw) + cw) % cw);
      const oy = -(((tp % ch) + ch) % ch);
      const cellOf = (x: number, y: number) => ({
        x: ox + Math.floor((x - ox) / cw) * cw,
        y: oy + Math.floor((y - oy) / ch) * ch,
      });
      // Each bubble is a fixed 5 × 3 picture on the grid around its centre.
      for (const { c, scale, age } of looks) {
        const home = cellOf(c.x, c.y);
        const put = (i: number, j: number, ch2: string, row: number, a: number) =>
          painter.glyph(home.x + i * cw, home.y + j * ch, ch2, row, a);
        const tile = (i: number, j: number, rgb: Rgb, a: number) =>
          painter.tileIn(home.x + i * cw, home.y + j * ch, rgb, a);
        if (age === null || popShape(age, t)) {
          if (scale <= 0.05) continue;
          // Inflating: a dot, a small bubble, then the whole one.
          if (scale < 0.45) {
            put(0, 0, "o", 1, fade);
            continue;
          }
          if (scale < 0.85) {
            put(-1, 0, "(", 1, fade);
            put(1, 0, ")", 1, fade);
            tile(0, 0, colors.accent, 0.2 * fade);
            continue;
          }
          // A wobble from a nearby pop shows as the bubble brightening.
          const lift = Math.min(1, Math.abs(scale - 1) * 6);
          const squash = age !== null;
          for (let i = -1; i <= 1; i++) tile(i, 0, colors.accent, (0.14 + 0.2 * lift) * fade);
          tile(-1, 0, shine, (0.18 + 0.2 * lift) * fade);
          if (!squash) {
            put(-1, -1, ".", 1, fade);
            put(0, -1, "-", 1, fade);
            put(1, -1, ".", 1, fade);
          }
          put(-2, 0, "(", 1, fade);
          put(2, 0, ")", 1, fade);
          put(-1, 1, "'", 1, fade);
          put(0, 1, squash ? "_" : "-", 1, fade);
          put(1, 1, "'", 1, fade);
        } else {
          // The film: a crumpled line, settling in.
          if (filmSettle(age, t) > 0.3)
            for (let i = -1; i <= 1; i++) put(i, 0, i === 0 ? "~" : "_", 0, 0.55 * fade);
          // The flash: stars flying out around it.
          const f = flash(age, t);
          if (f) {
            const out = Math.round(1 + f.reach * 1.5);
            for (const [i, j] of [
              [-out - 1, 0],
              [out + 1, 0],
              [0, -Math.ceil(out / 2)],
              [0, Math.ceil(out / 2)],
              [-out, -1],
              [out, -1],
              [-out, 1],
              [out, 1],
            ] as const)
              put(i, j, "*", SHINE, f.alpha);
          }
        }
      }
      for (const p of particles) {
        const k = p.age / p.life;
        const a = k > 0.75 ? (1 - k) / 0.25 : 1;
        const cell = cellOf(p.x, p.y);
        if (p.kind === "confetti")
          painter.glyph(
            cell.x,
            cell.y,
            p.spin < 0.33 ? "*" : p.spin < 0.66 ? "+" : "x",
            GLYPH_ON_HOT + 1 + p.tone,
            a,
          );
        else painter.glyph(cell.x, cell.y, ".", 0, 0.4 * a);
      }
    };

    const busy = (now: number) =>
      particles.length > 0 ||
      finaleAt !== null ||
      inflatingAt !== null ||
      [...poppedAt.values()].some((at) => now - at < SHOCK_SECONDS);

    const tick = (nowMs: number) => {
      const dt = Math.min(0.1, (nowMs - last) / 1000);
      last = nowMs;
      particles = stepParticles(particles, dt, bubbleTuning());
      const now = nowMs / 1000;
      draw(now);
      frame = busy(now) ? requestAnimationFrame(tick) : 0;
    };
    const wake = () => {
      if (frame) return;
      last = performance.now();
      frame = requestAnimationFrame(tick);
    };
    if (reduce.matches) inflatingAt = null;
    wake();

    const at = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      popAt(e.clientX - r.left, e.clientY - r.top);
    };
    const down = (e: PointerEvent) => e.button === 0 && at(e);
    const move = (e: PointerEvent) => (e.buttons & 1) === 1 && at(e);
    // Dragging to pop shouldn't select the words.
    const noSelect = (e: MouseEvent) => e.button === 0 && e.preventDefault();
    area.addEventListener("pointerdown", down);
    area.addEventListener("pointermove", move);
    area.addEventListener("mousedown", noSelect);
    return () => {
      area.removeEventListener("pointerdown", down);
      area.removeEventListener("pointermove", move);
      area.removeEventListener("mousedown", noSelect);
      cancelAnimationFrame(frame);
    };
  }, [areaRef, width, height, style]);

  return <canvas ref={ref} style={{ width, height }} />;
}

/** A steady pseudo-random number in [0, 1) for a seed. */
function hash(seed: number): number {
  const s = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}
