import { type RefObject, useEffect, useRef, useState } from "react";
import { allPopped, bubbleAt, pop, REFILL_MS, type Sheet, sheetFor } from "../model/bubbles";
import { alive, drop, type Ripple, RINGS, ringAt } from "../model/ripples";
import { skyAt } from "../model/sky";
import type { ToyId } from "../model/toys";

type Box = { left: number; top: number; width: number; height: number };

/**
 * The toy chosen in Settings → Toybox, over the empty view (`areaRef`)
 * and behind its icon and words. Placed against the list card, as the
 * glow is, but sized to the empty area, so the title row above stays
 * clear and clickable. Clicks are read from the area itself; the drawing
 * never takes the pointer.
 */
export function EmptyToy({ toy, areaRef }: { toy: ToyId; areaRef: RefObject<HTMLElement | null> }) {
  const box = useAreaBox(areaRef, toy !== "none");
  if (toy === "none" || !box) return null;
  const style = { left: box.left, top: box.top, width: box.width, height: box.height };
  return (
    <div aria-hidden className="pointer-events-none absolute overflow-hidden" style={style}>
      {toy === "sky" && <SkyLayer />}
      {toy === "ripples" && <RippleLayer areaRef={areaRef} box={box} />}
      {toy === "bubbles" && <BubbleLayer areaRef={areaRef} box={box} />}
    </div>
  );
}

/** Where the area sits in the card it's drawn against, kept up to date. */
function useAreaBox(areaRef: RefObject<HTMLElement | null>, on: boolean): Box | null {
  const [box, setBox] = useState<Box | null>(null);
  useEffect(() => {
    const area = areaRef.current;
    const card = area?.closest<HTMLElement>(".panel");
    if (!on || !area || !card) return;
    const measure = () => {
      const a = area.getBoundingClientRect();
      const c = card.getBoundingClientRect();
      setBox({ left: a.left - c.left, top: a.top - c.top, width: a.width, height: a.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    observer.observe(card);
    return () => observer.disconnect();
  }, [areaRef, on]);
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

/** A click in the area, in the area's own pixels. */
function useAreaClicks(
  areaRef: RefObject<HTMLElement | null>,
  onClick: (x: number, y: number) => void,
) {
  const handler = useRef(onClick);
  useEffect(() => {
    handler.current = onClick;
  });
  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const r = area.getBoundingClientRect();
      handler.current(e.clientX - r.left, e.clientY - r.top);
    };
    area.addEventListener("pointerdown", down);
    return () => area.removeEventListener("pointerdown", down);
  }, [areaRef]);
}

/** Rings spreading from each click, in the accent colour. */
function RippleLayer({ areaRef, box }: { areaRef: RefObject<HTMLElement | null>; box: Box }) {
  const canvas = useCanvas(box);
  const { width, height } = box;
  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    let ripples: Ripple[] = [];
    let frame = 0;
    const draw = () => {
      const ctx = canvas.current?.getContext("2d");
      if (!ctx) return;
      const now = performance.now();
      ripples = alive(ripples, now);
      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = getComputedStyle(document.documentElement)
        .getPropertyValue("--color-accent")
        .trim();
      ctx.lineWidth = 1.5;
      for (const r of ripples)
        for (let ring = 0; ring < RINGS; ring++) {
          const at = ringAt(r, ring, now);
          if (!at) continue;
          ctx.globalAlpha = at.alpha * 0.7;
          ctx.beginPath();
          // A little flattened, as rings on water seen at an angle.
          ctx.ellipse(r.x, r.y, at.radius, at.radius * 0.62, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      ctx.globalAlpha = 1;
      frame = ripples.length > 0 ? requestAnimationFrame(draw) : 0;
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const r = area.getBoundingClientRect();
      ripples = drop(ripples, e.clientX - r.left, e.clientY - r.top, performance.now());
      if (!frame) frame = requestAnimationFrame(draw);
    };
    area.addEventListener("pointerdown", down);
    return () => {
      area.removeEventListener("pointerdown", down);
      cancelAnimationFrame(frame);
    };
  }, [areaRef, canvas, width, height]);
  return <canvas ref={canvas} className="h-full w-full" />;
}

/** A sheet of bubbles; a click pops the one under it. */
function BubbleLayer({ areaRef, box }: { areaRef: RefObject<HTMLElement | null>; box: Box }) {
  const canvas = useCanvas(box);
  const [sheet, setSheet] = useState<Sheet>(() => sheetFor(box.width, box.height));
  // A new size is a new sheet (worked out here, not in an effect).
  const [sizedFor, setSizedFor] = useState({ w: box.width, h: box.height });
  if (sizedFor.w !== box.width || sizedFor.h !== box.height) {
    setSizedFor({ w: box.width, h: box.height });
    setSheet(sheetFor(box.width, box.height));
  }
  useAreaClicks(areaRef, (x, y) => {
    const i = bubbleAt(sheet, x, y);
    if (i !== null) setSheet(pop(sheet, i));
  });
  const done = allPopped(sheet);
  useEffect(() => {
    if (!done) return;
    const timer = window.setTimeout(() => setSheet(sheetFor(box.width, box.height)), REFILL_MS);
    return () => window.clearTimeout(timer);
  }, [done, box.width, box.height]);
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const ink = getComputedStyle(el).color;
    ctx.clearRect(0, 0, box.width, box.height);
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    sheet.centres.forEach((c, n) => {
      ctx.beginPath();
      if (sheet.popped[n]) {
        // Flattened: a faint crumpled ring.
        ctx.globalAlpha = 0.12;
        ctx.ellipse(c.x, c.y + 2, sheet.radius * 0.9, sheet.radius * 0.45, 0, 0, Math.PI * 2);
        ctx.stroke();
        return;
      }
      ctx.globalAlpha = 0.07;
      ctx.arc(c.x, c.y, sheet.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.22;
      ctx.stroke();
      // The shine on its top left.
      ctx.beginPath();
      ctx.globalAlpha = 0.3;
      ctx.arc(c.x - 3.5, c.y - 3.5, 2.2, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }, [sheet, box.width, box.height, canvas]);
  return <canvas ref={canvas} className="h-full w-full text-content" />;
}

/** The sky for now, checked each minute. */
function SkyLayer() {
  const [hour, setHour] = useState(currentHour);
  useEffect(() => {
    const timer = window.setInterval(() => setHour(currentHour()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const sky = skyAt(hour);
  return (
    <div
      className="absolute inset-0 opacity-45"
      style={{
        background: `linear-gradient(to bottom, ${sky.top}, ${sky.horizon})`,
        // Fades into the card at the edges rather than ending in a box.
        maskImage: "radial-gradient(ellipse at 50% 55%, black 35%, transparent 80%)",
      }}
    >
      <div
        className="absolute h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          left: `${10 + sky.along * 80}%`,
          top: `${85 - sky.height * 65}%`,
          background: sky.body === "sun" ? "rgb(255 236 170)" : "rgb(236 238 250)",
          boxShadow:
            sky.body === "sun"
              ? "0 0 40px 12px rgb(255 220 140 / 0.7)"
              : "0 0 24px 4px rgb(236 238 250 / 0.4)",
        }}
      />
    </div>
  );
}

function currentHour(): number {
  const now = new Date();
  return now.getHours() + now.getMinutes() / 60;
}
