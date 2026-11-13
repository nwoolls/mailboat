import { type RefObject, useEffect, useRef, useState } from "react";
import type { Rect } from "../../screensaver/model/scene";
import { PLOP_SECONDS, pondStir, PondToy } from "../model/pond";
import { asciiPondTuning, pondChars, pondLook, strongest } from "../model/asciiPond";
import type { ToyboxStyle } from "../model/style";
import { asciiGlowTuning } from "../../mailbox/model/asciiGlow";
import { asciiCell, AsciiPainter, GLYPH_ON_HOT, mix, readAsciiColors } from "./asciiPaint";
import { pixelPondTuning, pondBand } from "../model/pixelPond";
import { AsciiSkyLayer } from "./AsciiSky";
import { PixelSkyLayer } from "./PixelSky";
import { BubbleWrapLayer } from "./BubbleWrap";
import type { ToyId } from "../model/toys";

type Box = {
  left: number;
  top: number;
  width: number;
  height: number;
  /** The icon and each line of the words, in the area's pixels. */
  clear: Rect[];
};

/**
 * The toy chosen in Settings → Toybox, over the empty view (`areaRef`)
 * and behind its icon and words. Placed against the list card, as the
 * glow is, but sized to the empty area, so the title row above stays
 * clear and clickable. Clicks are read from the area itself; the drawing
 * never takes the pointer.
 */
export function EmptyToy({
  toy,
  areaRef,
  iconRef,
  wordsRef,
  style = "pixel",
}: {
  toy: ToyId;
  areaRef: RefObject<HTMLElement | null>;
  /** The empty state's icon and words: the pond's waves reflect off them. */
  iconRef: RefObject<HTMLElement | null>;
  wordsRef: RefObject<HTMLElement | null>;
  /** Pixel art or ASCII art (Settings → Toybox → Style); every toy has both. */
  style?: ToyboxStyle;
}) {
  // The pond's water and the ASCII sky run up under the title row to the
  // card's top edge, so they have no hard edge there; the other toys keep
  // to the empty area.
  const reachTop = toy === "ripples" || toy === "sky";
  const box = useAreaBox(areaRef, iconRef, wordsRef, toy !== "none", reachTop);
  if (toy === "none" || !box) return null;
  const place = { left: box.left, top: box.top, width: box.width, height: box.height };
  return (
    // Behind the card's content (z-index −1, as the glow is), so a toy that
    // reaches up under the title row never covers the title.
    <div
      aria-hidden
      className="pointer-events-none absolute overflow-hidden"
      style={{ ...place, zIndex: -1 }}
    >
      {toy === "sky" && style !== "ascii" && (
        <PixelSkyLayer
          areaRef={areaRef}
          iconRef={iconRef}
          wordsRef={wordsRef}
          width={box.width}
          height={box.height}
        />
      )}
      {toy === "sky" && style === "ascii" && (
        <AsciiSkyLayer
          areaRef={areaRef}
          iconRef={iconRef}
          wordsRef={wordsRef}
          width={box.width}
          height={box.height}
          left={box.left}
          top={box.top}
          clear={box.clear}
        />
      )}
      {toy === "ripples" && style === "ascii" && <AsciiPondLayer areaRef={areaRef} box={box} />}
      {toy === "ripples" && style !== "ascii" && <PondLayer areaRef={areaRef} box={box} />}
      {toy === "bubbles" && (
        <BubbleWrapLayer
          areaRef={areaRef}
          width={box.width}
          height={box.height}
          left={box.left}
          top={box.top}
          clear={box.clear}
          style={style}
        />
      )}
    </div>
  );
}

/** Where the area sits in the card it's drawn against, and what stands in it, kept up to date. */
function useAreaBox(
  areaRef: RefObject<HTMLElement | null>,
  iconRef: RefObject<HTMLElement | null>,
  wordsRef: RefObject<HTMLElement | null>,
  on: boolean,
  /** Reach up under the title row to the card's top edge, its title standing in the way. */
  reachTop: boolean,
): Box | null {
  const [box, setBox] = useState<Box | null>(null);
  useEffect(() => {
    const area = areaRef.current;
    const card = area?.closest<HTMLElement>(".panel");
    if (!on || !area || !card) return;
    const measure = () => {
      const a = area.getBoundingClientRect();
      const c = card.getBoundingClientRect();
      const top = reachTop ? c.top : a.top;
      const clear = [
        iconRef.current?.getBoundingClientRect(),
        ...textLines(wordsRef.current),
        ...(reachTop ? titleLines(card) : []),
      ]
        .filter((r): r is DOMRect => !!r)
        .map((r) => ({
          x0: r.left - a.left,
          y0: r.top - top,
          x1: r.right - a.left,
          y1: r.bottom - top,
        }));
      const next = {
        left: a.left - c.left,
        top: top - c.top,
        width: a.width,
        height: a.bottom - top,
        clear,
      };
      // Unchanged, keep the old one, so the toys don't start over.
      setBox((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    observer.observe(card);
    // The icon and words rise in (and cross-fade on a swap): measure
    // again where they come to rest.
    area.addEventListener("animationend", measure);
    return () => {
      observer.disconnect();
      area.removeEventListener("animationend", measure);
    };
  }, [areaRef, iconRef, wordsRef, on, reachTop]);
  return box;
}

/** Screen pixels per cell for the pixel-art toys, as the finer screensavers. */
const TOY_CELL_PX = 2;

/**
 * The pond, in chunky pixel art (`model/pixelPond.ts`): the water drawn in
 * blocks on the same grid as the glow and the sky, lined up with it across
 * the card. A click drops a stone. It draws only while something moves,
 * then clears and stops.
 */
function PondLayer({ areaRef, box }: { areaRef: RefObject<HTMLElement | null>; box: Box }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const pondRef = useRef<PondToy | null>(null);
  const { clear, width, height, left, top } = box;
  const clearRef = useRef(clear);
  const placeRef = useRef({ left, top });
  useEffect(() => {
    placeRef.current = { left, top };
  }, [left, top]);
  const cols = Math.max(1, Math.floor(width / TOY_CELL_PX));
  const rows = Math.max(1, Math.floor(height / TOY_CELL_PX));
  useEffect(() => {
    const area = areaRef.current;
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!area || !canvas || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const pond = new PondToy(cols, rows);
    pond.setSolids(inCells(clearRef.current));
    pondRef.current = pond;
    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      pond.frame(Math.min((now - last) / 1000, 0.1));
      last = now;
      const t = pixelPondTuning();
      const px = Math.max(1, Math.round(t.pixel));
      const colors = readAsciiColors(0.6, 0.45);
      const [ar, ag, ab] = colors.accent;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // Blocks on the card's grid (the glow's and sky's), not the area's.
      const { left: l, top: tp } = placeRef.current;
      const ox = -(((l % px) + px) % px);
      const oy = -(((tp % px) + px) % px);
      const block = (x: number, y: number, rgb: readonly number[], a: number) => {
        if (a <= 0.005) return;
        ctx.fillStyle = `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]} / ${Math.min(1, a)})`;
        const x0 = Math.round(x * dpr);
        const y0 = Math.round(y * dpr);
        ctx.fillRect(x0, y0, Math.round((x + px) * dpr) - x0, Math.round((y + px) * dpr) - y0);
      };
      const solid = clearRef.current;
      // Water facing away: darker than the page either way, so the rings
      // keep their light and shadow on a light page too.
      const deep = colors.dark
        ? mix(colors.accent, colors.base, 0.55)
        : mix(colors.accent, colors.content, 0.5);
      for (let y = oy, by = 0; y < height; y += px, by++)
        for (let x = ox, bx = 0; x < width; x += px, bx++) {
          const mx = x + px / 2;
          const my = y + px / 2;
          if (solid.some((b) => mx >= b.x0 && mx <= b.x1 && my >= b.y0 && my <= b.y1)) continue;
          const look = pondBand(pond.shading(mx / TOY_CELL_PX, my / TOY_CELL_PX), bx, by, t);
          if (!look) continue;
          if (look.kind === "crest") {
            const k = look.band / t.crestBands;
            block(
              x,
              y,
              mix(colors.accent, colors.hot, Math.max(0, k - 0.25)),
              t.crestPeak * (0.3 + 0.7 * k),
            );
          } else block(x, y, deep, t.troughPeak * (look.band / t.troughBands));
        }
      // The cell under a point in the area's pixels.
      const at = (cx: number, cy: number) => ({
        x: ox + Math.floor((cx - ox) / px) * px,
        y: oy + Math.floor((cy - oy) / px) * px,
      });
      const glows: { x: number; y: number; r: number; a: number }[] = [];
      // The plop: a quick burst of bright blocks, flattened.
      for (const p of pond.plops) {
        const fade = 1 - p.age / PLOP_SECONDS;
        const c = at(p.x * TOY_CELL_PX, p.y * TOY_CELL_PX);
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -3; dx <= 3; dx++) {
            if (Math.hypot(dx / 3.5, dy / 1.5) > 1) continue;
            block(c.x + dx * px, c.y + dy * px, colors.hot, fade * 0.95);
          }
        glows.push({ x: c.x + px / 2, y: c.y + px / 2, r: px * 9, a: fade });
      }
      // Droplets: a bright block, and a faint one behind it.
      for (const d of pond.droplets) {
        const bead = at(d.x * TOY_CELL_PX, d.y * TOY_CELL_PX);
        const tail = at((d.x - d.vx * 0.03) * TOY_CELL_PX, (d.y - d.vy * 0.03) * TOY_CELL_PX);
        if (tail.x !== bead.x || tail.y !== bead.y) block(tail.x, tail.y, colors.accent, 0.45);
        block(bead.x, bead.y, colors.hot, 1);
        glows.push({ x: bead.x + px / 2, y: bead.y + px / 2, r: px * 3, a: 0.6 });
      }
      // The light: a soft glow around the splash.
      if (t.bloom > 0 && glows.length) {
        ctx.globalCompositeOperation = colors.dark ? "lighter" : "source-over";
        for (const g of glows) {
          const cx = g.x * dpr;
          const cy = g.y * dpr;
          const rr = g.r * dpr;
          const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
          grad.addColorStop(0, `rgb(${ar} ${ag} ${ab} / ${0.35 * t.bloom * g.a})`);
          grad.addColorStop(1, `rgb(${ar} ${ag} ${ab} / 0)`);
          ctx.fillStyle = grad;
          ctx.fillRect(cx - rr, cy - rr, rr * 2, rr * 2);
        }
        ctx.globalCompositeOperation = "source-over";
      }
      // Once still, the last frame drawn was empty: stop.
      frame = pond.active ? requestAnimationFrame(tick) : 0;
    };
    const wake = () => {
      if (frame) return;
      last = performance.now();
      frame = requestAnimationFrame(tick);
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const r = canvas.getBoundingClientRect();
      pond.drop((e.clientX - r.left) / TOY_CELL_PX, (e.clientY - r.top) / TOY_CELL_PX);
      wake();
    };
    area.addEventListener("pointerdown", down);
    const stopStirring = stirOnMove(area, canvas, pond, wake);
    return () => {
      area.removeEventListener("pointerdown", down);
      stopStirring();
      cancelAnimationFrame(frame);
    };
  }, [areaRef, cols, rows, width, height]);
  // The icon, each line of the words and the title stand in the water,
  // measured around the letters, so the water reaches right up to them.
  // Updated in place when they move (after rising in, say), so the water
  // keeps its waves.
  useEffect(() => {
    clearRef.current = clear;
    pondRef.current?.setSolids(inCells(clear));
  }, [clear]);
  return <canvas ref={ref} style={{ width, height }} />;
}

/**
 * The pond in ASCII art (`model/asciiPond.ts`): the same water as in pixel
 * art, drawn on the glow's grid of characters, lined up with it across the
 * card. Draws only while something moves, then clears and stops.
 */
function AsciiPondLayer({ areaRef, box }: { areaRef: RefObject<HTMLElement | null>; box: Box }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const pondRef = useRef<PondToy | null>(null);
  const { clear, width, height, left, top } = box;
  const clearRef = useRef(clear);
  const placeRef = useRef({ left, top });
  useEffect(() => {
    placeRef.current = { left, top };
  }, [left, top]);
  const cols = Math.max(1, Math.floor(width / TOY_CELL_PX));
  const rows = Math.max(1, Math.floor(height / TOY_CELL_PX));
  useEffect(() => {
    const area = areaRef.current;
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!area || !canvas || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const painter = new AsciiPainter(ctx);
    const pond = new PondToy(cols, rows);
    pond.setSolids(inCells(clearRef.current));
    pondRef.current = pond;
    let seeds = new Float32Array(0);
    let frame = 0;
    let last = 0;
    let colors = readAsciiColors(asciiGlowTuning().hotMixDark, asciiGlowTuning().hotMixLight);
    const tick = (now: number) => {
      pond.frame(Math.min((now - last) / 1000, 0.1));
      last = now;
      const g = asciiGlowTuning();
      const t = asciiPondTuning();
      colors = readAsciiColors(g.hotMixDark, g.hotMixLight);
      const { cw, ch } = asciiCell(ctx, g.fontPx, g.lineHeight);
      painter.prepare(cw, ch, dpr, g.fontPx, pondChars(t), colors);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // Cells on the card's grid (the glow's), not the area's.
      const { left: l, top: tp } = placeRef.current;
      const ox = -(((l % cw) + cw) % cw);
      const oy = -(((tp % ch) + ch) % ch);
      const across = Math.ceil((width - ox) / cw);
      const down = Math.ceil((height - oy) / ch);
      if (seeds.length !== across * down)
        seeds = Float32Array.from({ length: across * down }, Math.random);
      const solid = clearRef.current;
      for (let r = 0; r < down; r++) {
        const y = oy + r * ch;
        for (let c = 0; c < across; c++) {
          const x = ox + c * cw;
          const mx = x + cw / 2;
          // Nothing drawn over the icon or a line of the words.
          if (
            solid.some((b) => mx >= b.x0 && mx <= b.x1 && y + ch / 2 >= b.y0 && y + ch / 2 <= b.y1)
          )
            continue;
          const shade = strongest((py) => pond.shading(mx / TOY_CELL_PX, py / TOY_CELL_PX), y, ch);
          const look = pondLook(shade, seeds[r * across + c]!, colors.dark, t);
          if (!look) continue;
          if (look.kind === "trough") {
            painter.glyph(x, y, look.char, 0, look.glyphAlpha);
            continue;
          }
          painter.tile(x, y, look.warmth, look.tileAlpha);
          painter.glyph(
            x,
            y,
            look.char,
            look.hot ? GLYPH_ON_HOT : look.v > 0.6 ? 2 : 1,
            look.glyphAlpha,
          );
        }
      }
      // The cell under a point in the area's pixels.
      const cellAt = (px: number, py: number) => ({
        x: ox + Math.floor((px - ox) / cw) * cw,
        y: oy + Math.floor((py - oy) / ch) * ch,
      });
      // The plop: a quick burst of pale tiles, flattened.
      for (const p of pond.plops) {
        const fade = 1 - p.age / PLOP_SECONDS;
        const at = cellAt(p.x * TOY_CELL_PX, p.y * TOY_CELL_PX);
        for (let dy = -t.plopRows; dy <= t.plopRows; dy++)
          for (let dx = -t.plopCols; dx <= t.plopCols; dx++) {
            const reach = Math.hypot(dx / (t.plopCols + 0.5), dy / (t.plopRows + 0.5));
            if (reach > 1) continue;
            const a = fade * (1 - reach * 0.6);
            painter.tile(at.x + dx * cw, at.y + dy * ch, 1, a * 0.85);
            painter.glyph(at.x + dx * cw, at.y + dy * ch, t.plopChar, GLYPH_ON_HOT, a);
          }
      }
      // Droplets: a bright bead, and a tick behind it.
      for (const d of pond.droplets) {
        const bead = cellAt(d.x * TOY_CELL_PX, d.y * TOY_CELL_PX);
        const tail = cellAt((d.x - d.vx * 0.03) * TOY_CELL_PX, (d.y - d.vy * 0.03) * TOY_CELL_PX);
        if (tail.x !== bead.x || tail.y !== bead.y)
          painter.glyph(tail.x, tail.y, t.trailChar, 2, 0.6);
        painter.tile(bead.x, bead.y, 0.8, 0.5);
        painter.glyph(bead.x, bead.y, t.dropletChar, 3, 1);
      }
      ctx.globalAlpha = 1;
      // Once still, the last frame drawn was empty: stop.
      frame = pond.active ? requestAnimationFrame(tick) : 0;
    };
    const wake = () => {
      if (frame) return;
      last = performance.now();
      frame = requestAnimationFrame(tick);
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const r = canvas.getBoundingClientRect();
      pond.drop((e.clientX - r.left) / TOY_CELL_PX, (e.clientY - r.top) / TOY_CELL_PX);
      wake();
    };
    area.addEventListener("pointerdown", down);
    const stopStirring = stirOnMove(area, canvas, pond, wake);
    return () => {
      area.removeEventListener("pointerdown", down);
      stopStirring();
      cancelAnimationFrame(frame);
    };
  }, [areaRef, cols, rows, width, height]);
  useEffect(() => {
    clearRef.current = clear;
    pondRef.current?.setSolids(inCells(clear));
  }, [clear]);
  return <canvas ref={ref} style={{ width, height }} />;
}

/**
 * The pointer stirring the pond as it moves (`PondStir`, off unless its
 * depth is set): a faint push every few cells it travels, deeper the faster
 * it goes, waking the pond if it was still. Returns the cleanup.
 */
function stirOnMove(
  area: HTMLElement,
  layer: HTMLElement,
  pond: PondToy,
  wake: () => void,
): () => void {
  let from: { x: number; y: number; t: number } | null = null;
  const move = (e: PointerEvent) => {
    const t = pondStir();
    if (t.stirDepth <= 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      from = null;
      return;
    }
    const r = layer.getBoundingClientRect();
    const x = (e.clientX - r.left) / TOY_CELL_PX;
    const y = (e.clientY - r.top) / TOY_CELL_PX;
    const now = performance.now();
    if (!from) {
      from = { x, y, t: now };
      return;
    }
    const moved = Math.hypot(x - from.x, y - from.y);
    if (moved < t.stirEvery) return;
    const speed = moved / Math.max(0.016, (now - from.t) / 1000);
    from = { x, y, t: now };
    pond.stir(x, y, speed, t);
    if (pond.active) wake();
  };
  const leave = () => {
    from = null;
  };
  area.addEventListener("pointermove", move);
  area.addEventListener("pointerleave", leave);
  return () => {
    area.removeEventListener("pointermove", move);
    area.removeEventListener("pointerleave", leave);
  };
}

/** Boxes in the area's pixels, in the pixel-art toys' cells. */
function inCells(boxes: Rect[]): Rect[] {
  return boxes.map((r) => ({
    x0: r.x0 / TOY_CELL_PX,
    y0: r.y0 / TOY_CELL_PX,
    x1: r.x1 / TOY_CELL_PX,
    y1: r.y1 / TOY_CELL_PX,
  }));
}

/** The card's title (`data-card-title`), as tight boxes around its letters. */
function titleLines(card: HTMLElement): DOMRect[] {
  const title = card.querySelector<HTMLElement>("[data-card-title]");
  if (!title) return [];
  const range = document.createRange();
  range.selectNodeContents(title);
  return [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
}

/** Each line of text inside `el`, as tight boxes round the letters. */
function textLines(el: HTMLElement | null): DOMRect[] {
  if (!el) return [];
  const range = document.createRange();
  return [...el.querySelectorAll("p")].flatMap((p) => {
    range.selectNodeContents(p);
    return [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
  });
}
