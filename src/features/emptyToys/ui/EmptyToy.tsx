import { type RefObject, useEffect, useRef, useState } from "react";
import {
  allPopped,
  bubbleAt,
  crumple,
  pop,
  POP_MS,
  REFILL_MS,
  type Sheet,
  sheetFor,
} from "../model/bubbles";
import type { Rect } from "../../screensaver/model/scene";
import {
  colorTable,
  type PaletteId,
  paletteColors,
  parseColor,
} from "../../screensaver/model/palettes";
import { PondToy } from "../model/pond";
import { moonPath, moonPhase, nightness, skyAt, starsFor } from "../model/sky";
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
  palette,
}: {
  toy: ToyId;
  areaRef: RefObject<HTMLElement | null>;
  /** The empty state's icon and words: the pond's waves reflect off them. */
  iconRef: RefObject<HTMLElement | null>;
  wordsRef: RefObject<HTMLElement | null>;
  /** The Toybox palette, which the toys share with the screensavers. */
  palette: PaletteId;
}) {
  const box = useAreaBox(areaRef, iconRef, wordsRef, toy !== "none");
  if (toy === "none" || !box) return null;
  const style = { left: box.left, top: box.top, width: box.width, height: box.height };
  return (
    <div aria-hidden className="pointer-events-none absolute overflow-hidden" style={style}>
      {toy === "sky" && <SkyLayer areaRef={areaRef} />}
      {toy === "ripples" && <PondLayer areaRef={areaRef} box={box} palette={palette} />}
      {toy === "bubbles" && <BubbleLayer areaRef={areaRef} box={box} />}
    </div>
  );
}

/** Where the area sits in the card it's drawn against, and what stands in it, kept up to date. */
function useAreaBox(
  areaRef: RefObject<HTMLElement | null>,
  iconRef: RefObject<HTMLElement | null>,
  wordsRef: RefObject<HTMLElement | null>,
  on: boolean,
): Box | null {
  const [box, setBox] = useState<Box | null>(null);
  useEffect(() => {
    const area = areaRef.current;
    const card = area?.closest<HTMLElement>(".panel");
    if (!on || !area || !card) return;
    const measure = () => {
      const a = area.getBoundingClientRect();
      const c = card.getBoundingClientRect();
      const clear = [iconRef.current?.getBoundingClientRect(), ...textLines(wordsRef.current)]
        .filter((r): r is DOMRect => !!r)
        .map((r) => ({
          x0: r.left - a.left,
          y0: r.top - a.top,
          x1: r.right - a.left,
          y1: r.bottom - a.top,
        }));
      const next = {
        left: a.left - c.left,
        top: a.top - c.top,
        width: a.width,
        height: a.height,
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
  }, [areaRef, iconRef, wordsRef, on]);
  return box;
}

/** A canvas the size of the box, sharp on Retina screens. */
function useCanvas(box: Box) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(box.width * dpr);
    canvas.height = Math.round(box.height * dpr);
    canvas.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }, [box.width, box.height]);
  return ref;
}

/** Screen pixels per cell for the pixel-art toys, as the finer screensavers. */
const TOY_CELL_PX = 2;

/** The palette's colours for every value a toy draws, with the current accent. */
function useColors(palette: PaletteId): Uint32Array {
  const [colors, setColors] = useState<Uint32Array>(() => new Uint32Array(0));
  const [madeFor, setMadeFor] = useState<PaletteId | null>(null);
  if (madeFor !== palette) {
    setMadeFor(palette);
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--color-accent");
    setColors(colorTable(paletteColors(palette, parseColor(accent))));
  }
  return colors;
}

/**
 * The pond, in pixel art (`model/pond.ts`): a click drops a stone. It
 * draws only while something moves, then clears and stops.
 */
function PondLayer({
  areaRef,
  box,
  palette,
}: {
  areaRef: RefObject<HTMLElement | null>;
  box: Box;
  palette: PaletteId;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const colors = useColors(palette);
  const colorsRef = useRef(colors);
  useEffect(() => {
    colorsRef.current = colors;
  }, [colors]);
  const pondRef = useRef<PondToy | null>(null);
  const { clear } = box;
  const clearRef = useRef(clear);
  const cols = Math.max(1, Math.floor(box.width / TOY_CELL_PX));
  const rows = Math.max(1, Math.floor(box.height / TOY_CELL_PX));
  useEffect(() => {
    const area = areaRef.current;
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!area || !canvas || !ctx) return;
    canvas.width = cols;
    canvas.height = rows;
    const pond = new PondToy(cols, rows);
    pond.setSolids(inCells(clearRef.current));
    pondRef.current = pond;
    const image = ctx.createImageData(cols, rows);
    const pixels = new Uint32Array(image.data.buffer);
    const cells = new Uint8Array(cols * rows);
    const opacity = new Uint8Array(cols * rows);
    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      pond.frame(Math.min((now - last) / 1000, 0.1));
      last = now;
      opacity.fill(255);
      pond.draw(cells, opacity);
      const table = colorsRef.current;
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i] ? (table[cells[i]!] ?? 0) : 0;
        const a = opacity[i]!;
        pixels[i] = a === 255 ? c : ((c & 0xffffff) | (((a * (c >>> 24)) / 255) << 24)) >>> 0;
      }
      ctx.putImageData(image, 0, 0);
      // Once still, the last frame drawn was empty: stop.
      frame = pond.active ? requestAnimationFrame(tick) : 0;
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const r = area.getBoundingClientRect();
      pond.drop((e.clientX - r.left) / TOY_CELL_PX, (e.clientY - r.top) / TOY_CELL_PX);
      if (!frame) {
        last = performance.now();
        frame = requestAnimationFrame(tick);
      }
    };
    area.addEventListener("pointerdown", down);
    return () => {
      area.removeEventListener("pointerdown", down);
      cancelAnimationFrame(frame);
    };
  }, [areaRef, cols, rows]);
  // The icon and each line of the words stand in the water, the words
  // measured round the letters, not their wider box, so the water
  // reaches right up to them. Updated in place when they move (after
  // rising in, say), so the water keeps its waves.
  useEffect(() => {
    clearRef.current = clear;
    pondRef.current?.setSolids(inCells(clear));
  }, [clear]);
  return (
    <canvas
      ref={ref}
      style={{ width: cols * TOY_CELL_PX, height: rows * TOY_CELL_PX, imageRendering: "pixelated" }}
    />
  );
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

/** Each line of text inside `el`, as tight boxes round the letters. */
function textLines(el: HTMLElement | null): DOMRect[] {
  if (!el) return [];
  const range = document.createRange();
  return [...el.querySelectorAll("p")].flatMap((p) => {
    range.selectNodeContents(p);
    return [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
  });
}

/**
 * A sheet of bubble wrap round the icon and words. A click pops the
 * bubble under it; holding the button and dragging pops a row. Each
 * bubble is lit from the top left with a shadow below; a pop bursts
 * (the bubble snaps flat with a ring of slivers) and leaves crumpled film.
 */
function BubbleLayer({ areaRef, box }: { areaRef: RefObject<HTMLElement | null>; box: Box }) {
  const canvas = useCanvas(box);
  const [sheet, setSheet] = useState<Sheet>(() => sheetFor(box.width, box.height, box.clear));
  // A new size is a new sheet (worked out here, not in an effect).
  const [sizedFor, setSizedFor] = useState(box);
  if (sizedFor.width !== box.width || sizedFor.height !== box.height) {
    setSizedFor(box);
    setSheet(sheetFor(box.width, box.height, box.clear));
  }
  /** When each bursting bubble popped (performance.now()). */
  const bursts = useRef(new Map<number, number>());
  const popAt = (x: number, y: number) => {
    const i = bubbleAt(sheet, x, y);
    if (i === null) return;
    bursts.current.set(i, performance.now());
    setSheet(pop(sheet, i));
  };
  const popRef = useRef(popAt);
  useEffect(() => {
    popRef.current = popAt;
  });
  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const at = (e: PointerEvent) => {
      const r = area.getBoundingClientRect();
      popRef.current(e.clientX - r.left, e.clientY - r.top);
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
    };
  }, [areaRef]);
  const done = allPopped(sheet);
  useEffect(() => {
    if (!done) return;
    const timer = window.setTimeout(() => {
      bursts.current.clear();
      setSheet(sheetFor(box.width, box.height, box.clear));
    }, REFILL_MS);
    return () => window.clearTimeout(timer);
  }, [done, box]);
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const ink = getComputedStyle(el).color;
    let frame = 0;
    const draw = (now: number) => {
      ctx.clearRect(0, 0, box.width, box.height);
      for (const [n, t] of bursts.current) if (now - t > POP_MS) bursts.current.delete(n);
      sheet.centres.forEach((c, n) => {
        const r = sheet.radius * (0.92 + 0.12 * sheet.quirks[n]!);
        const burst = bursts.current.get(n);
        if (sheet.popped[n]) drawFilm(ctx, ink, c, r, sheet.quirks[n]!);
        if (burst !== undefined) drawBurst(ctx, ink, c, r, (now - burst) / POP_MS);
        else if (!sheet.popped[n]) drawBubble(ctx, ink, c, r);
      });
      ctx.globalAlpha = 1;
      frame = bursts.current.size ? requestAnimationFrame(draw) : 0;
    };
    draw(performance.now());
    return () => cancelAnimationFrame(frame);
  }, [sheet, box.width, box.height, canvas]);
  return <canvas ref={canvas} className="h-full w-full text-content" />;
}

type Point = { x: number; y: number };

/** A whole bubble: a soft shadow, a dome lit from the top left, a rim and a glint. */
function drawBubble(ctx: CanvasRenderingContext2D, ink: string, c: Point, r: number) {
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1;
  // Shadow, below and right.
  ctx.globalAlpha = 0.06;
  ctx.beginPath();
  ctx.ellipse(c.x + 2, c.y + 3, r, r * 0.9, 0, 0, Math.PI * 2);
  ctx.fill();
  // The dome: clear in the middle, denser towards the lit edge.
  const dome = ctx.createRadialGradient(c.x - r * 0.35, c.y - r * 0.35, r * 0.1, c.x, c.y, r);
  dome.addColorStop(0, "transparent");
  dome.addColorStop(1, ink);
  ctx.globalAlpha = 0.14;
  ctx.fillStyle = dome;
  ctx.beginPath();
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.2;
  ctx.stroke();
  // A curved glint at the top left, and a faint bounce of light bottom right.
  ctx.lineCap = "round";
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.45;
  ctx.beginPath();
  ctx.arc(c.x, c.y, r * 0.62, Math.PI * 1.08, Math.PI * 1.42);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.18;
  ctx.beginPath();
  ctx.arc(c.x, c.y, r * 0.7, Math.PI * 0.15, Math.PI * 0.4);
  ctx.stroke();
}

/** A popping bubble, `t` from 0 to 1: it snaps flat as slivers fly out and fade. */
function drawBurst(ctx: CanvasRenderingContext2D, ink: string, c: Point, r: number, t: number) {
  const ease = 1 - (1 - t) ** 3;
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  // The dome collapsing.
  ctx.globalAlpha = 0.18 * (1 - ease);
  ctx.beginPath();
  ctx.ellipse(c.x, c.y + ease * 2, r * (1 + ease * 0.1), r * (1 - ease * 0.5), 0, 0, Math.PI * 2);
  ctx.fill();
  // Slivers of film and air flying out.
  ctx.lineCap = "round";
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.5 * (1 - t);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.3;
    const from = r * (0.9 + ease * 0.5);
    const to = from + 3 + ease * 4;
    ctx.beginPath();
    ctx.moveTo(c.x + Math.cos(a) * from, c.y + Math.sin(a) * from);
    ctx.lineTo(c.x + Math.cos(a) * to, c.y + Math.sin(a) * to);
    ctx.stroke();
  }
}

/** What's left after a pop: crumpled film lying flat. */
function drawFilm(ctx: CanvasRenderingContext2D, ink: string, c: Point, r: number, quirk: number) {
  const points = crumple(quirk, r);
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = 1;
  ctx.lineJoin = "round";
  ctx.beginPath();
  points.forEach((p, k) =>
    k ? ctx.lineTo(c.x + p.x, c.y + p.y) : ctx.moveTo(c.x + p.x, c.y + p.y),
  );
  ctx.closePath();
  ctx.globalAlpha = 0.07;
  ctx.fill();
  ctx.globalAlpha = 0.2;
  ctx.stroke();
  // A crease or two across it.
  ctx.globalAlpha = 0.1;
  ctx.beginPath();
  ctx.moveTo(c.x + points[1]!.x * 0.8, c.y + points[1]!.y * 0.8);
  ctx.lineTo(c.x + points[5]!.x * 0.6, c.y + points[5]!.y * 0.6);
  ctx.stroke();
}

const STARS = starsFor(70);
/** Drifting clouds: height (% from the top), size (px), seconds to cross, head start. */
const CLOUDS = [
  { top: 14, size: 70, seconds: 150, delay: -40 },
  { top: 30, size: 46, seconds: 210, delay: -150 },
  { top: 72, size: 58, seconds: 180, delay: -95 },
];

type Flourish = { id: number; x: number; y: number; kind: "shooting" | "puff" };

/**
 * The sky for now, checked each minute: by day the sun (warmer near the
 * horizon) and slow clouds; at night the moon in tonight's phase, with
 * the dark side faintly visible, and twinkling stars, the two crossing
 * over through dusk and dawn. A click sends a shooting star across at
 * night, or leaves a small cloud drifting by day.
 */
function SkyLayer({ areaRef }: { areaRef: RefObject<HTMLElement | null> }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const hour = now.getHours() + now.getMinutes() / 60;
  const sky = skyAt(hour);
  const night = nightness(hour);
  const [flourishes, setFlourishes] = useState<Flourish[]>([]);
  const nightRef = useRef(night);
  useEffect(() => {
    nightRef.current = night;
  }, [night]);
  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    let id = 0;
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const r = area.getBoundingClientRect();
      const kind = nightRef.current > 0.5 ? "shooting" : "puff";
      const f = { id: ++id, x: e.clientX - r.left, y: e.clientY - r.top, kind } as const;
      setFlourishes((all) => [...all.slice(-5), f]);
    };
    area.addEventListener("pointerdown", down);
    return () => area.removeEventListener("pointerdown", down);
  }, [areaRef]);
  const done = (id: number) => setFlourishes((all) => all.filter((f) => f.id !== id));
  // Low in the sky the sun reddens and its glow spreads.
  const low = 1 - Math.min(1, sky.height / 0.35);
  const sun = `rgb(255 ${Math.round(236 - low * 70)} ${Math.round(170 - low * 90)})`;
  const phase = moonPhase(now);
  const MOON = 34;
  return (
    <div
      className="absolute inset-0 opacity-45"
      style={{
        background: `linear-gradient(to bottom, ${sky.top}, ${sky.horizon})`,
        // Fades into the card at the edges rather than ending in a box.
        maskImage: "radial-gradient(ellipse at 50% 55%, black 35%, transparent 80%)",
      }}
    >
      {night > 0 &&
        STARS.map((star) => (
          <div
            key={`${star.x}:${star.y}`}
            className="sky-star absolute bg-white"
            style={{
              left: `${star.x}%`,
              top: `${star.y}%`,
              width: star.size,
              height: star.size,
              borderRadius: star.size,
              opacity: night,
              animationDelay: `${-star.delay}s`,
            }}
          />
        ))}
      {night < 1 &&
        CLOUDS.map((cloud) => (
          <Cloud
            key={cloud.top}
            className="sky-cloud"
            style={{
              top: `${cloud.top}%`,
              opacity: 1 - night,
              animationDuration: `${cloud.seconds}s`,
              animationDelay: `${cloud.delay}s`,
            }}
            size={cloud.size}
          />
        ))}
      <div
        className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          left: `${10 + sky.along * 80}%`,
          top: `${85 - sky.height * 65}%`,
          width: sky.body === "sun" ? 40 : MOON,
          height: sky.body === "sun" ? 40 : MOON,
          background:
            sky.body === "sun"
              ? `radial-gradient(circle, rgb(255 250 230), ${sun} 70%)`
              : "rgb(236 238 250 / 0.1)",
          boxShadow:
            sky.body === "sun"
              ? `0 0 ${40 + low * 30}px ${12 + low * 10}px ${sun.replace(")", " / 0.7)")}`
              : `0 0 24px ${2 + 6 * Math.sin(phase * Math.PI)}px rgb(236 238 250 / ${0.1 + 0.3 * Math.sin(phase * Math.PI)})`,
        }}
      >
        {sky.body === "moon" && (
          <svg width={MOON} height={MOON} viewBox={`0 0 ${MOON} ${MOON}`} className="block">
            <path d={moonPath(phase, MOON)} fill="rgb(236 238 250)" />
          </svg>
        )}
      </div>
      {flourishes.map((f) =>
        f.kind === "shooting" ? (
          <div
            key={f.id}
            className="sky-shooting absolute"
            style={{ left: f.x, top: f.y }}
            onAnimationEnd={() => done(f.id)}
          />
        ) : (
          <Cloud
            key={f.id}
            className="sky-puff"
            style={{ left: f.x, top: f.y }}
            size={36}
            onAnimationEnd={() => done(f.id)}
          />
        ),
      )}
    </div>
  );
}

/**
 * White fading out at its edge, so a cloud is soft without a CSS blur
 * (WebKit left a stray coloured line beside a blurred cloud as it moved).
 */
const SOFT_WHITE = "radial-gradient(closest-side, white 55%, rgb(255 255 255 / 0))";

/** A soft cloud: three overlapping puffs on a flat base. */
function Cloud({
  className,
  style,
  size,
  onAnimationEnd,
}: {
  className: string;
  style: React.CSSProperties;
  size: number;
  onAnimationEnd?: () => void;
}) {
  const puff = (left: number, top: number, d: number) => (
    <div
      className="absolute bg-white"
      style={{
        left: left * size,
        top: top * size,
        width: d * size,
        height: d * size,
        borderRadius: size,
      }}
    />
  );
  return (
    <div
      className={`absolute ${className}`}
      style={{ width: size * 1.6, height: size * 0.7, ...style }}
      onAnimationEnd={onAnimationEnd}
    >
      {puff(0, 0.25, 0.45)}
      {puff(0.3, 0, 0.65)}
      {puff(0.8, 0.15, 0.5)}
      <div
        className="absolute"
        style={{
          left: size * 0.15,
          top: size * 0.4,
          width: size * 1.2,
          height: size * 0.3,
          borderRadius: size,
          background: SOFT_WHITE,
        }}
      />
    </div>
  );
}
