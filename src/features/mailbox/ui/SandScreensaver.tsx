import { type RefObject, useEffect, useRef, useState } from "react";
import {
  arrowCells,
  isRealMove,
  GRAIN,
  SAND_CELL_PX,
  SAND_COLORS,
  SAND_SHADES,
  SandShow,
  SCREENSAVER_EVENT,
  SCREENSAVER_IDLE_SECONDS,
} from "../model/sand";

export type ScreensaverPhase = "off" | "on" | "closing";
const CLOSE_MS = 450;

/**
 * When the empty list's screensaver runs. It starts after
 * SCREENSAVER_IDLE_SECONDS without any input while the window is in front
 * (or at once from the palette's "Start screensaver"), and closes on a key,
 * click or scroll. Moving the pointer doesn't close it: the sand plays with
 * the pointer instead. Never starts with "Reduce motion" on.
 *
 * Focus is tracked from the window's blur and focus events, not
 * `document.hasFocus()`, which can't be relied on in the app's web view.
 * Pointer events that don't actually move (WebKit sends some when the page
 * changes under a still cursor, such as when the palette closes) don't
 * count as input.
 */
export function useScreensaver(): ScreensaverPhase {
  const [phase, setPhase] = useState<ScreensaverPhase>("off");

  useEffect(() => {
    const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let timer = 0;
    let inFront = !document.hidden;
    let last: { x: number; y: number } | null = null;
    const startIfInFront = () => {
      if (reduced()) return;
      if (inFront && !document.hidden) setPhase("on");
      else arm();
    };
    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(startIfInFront, SCREENSAVER_IDLE_SECONDS * 1000);
    };
    if (phase === "off") {
      arm();
      // Asked for: start regardless of focus, and don't let the palette
      // closing (its key, a stray pointer event) cancel it.
      let now = 0;
      const onStartNow = () => {
        window.clearTimeout(now);
        now = window.setTimeout(() => !reduced() && setPhase("on"), 300);
      };
      const onMove = (e: PointerEvent) => {
        const moved = isRealMove(last, e);
        last = { x: e.clientX, y: e.clientY };
        if (moved) arm();
      };
      const onBlur = () => (inFront = false);
      const onFocus = () => {
        inFront = true;
        arm();
      };
      const events = ["keydown", "pointerdown", "wheel"] as const;
      for (const e of events) window.addEventListener(e, arm, { passive: true });
      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("blur", onBlur);
      window.addEventListener("focus", onFocus);
      window.addEventListener(SCREENSAVER_EVENT, onStartNow);
      return () => {
        window.clearTimeout(timer);
        window.clearTimeout(now);
        for (const e of events) window.removeEventListener(e, arm);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("blur", onBlur);
        window.removeEventListener("focus", onFocus);
        window.removeEventListener(SCREENSAVER_EVENT, onStartNow);
      };
    }
    if (phase === "on") {
      const close = () => setPhase("closing");
      const events = ["keydown", "pointerdown", "wheel"] as const;
      for (const e of events) window.addEventListener(e, close, { passive: true });
      return () => {
        for (const e of events) window.removeEventListener(e, close);
      };
    }
    timer = window.setTimeout(() => setPhase("off"), CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  return phase;
}

/**
 * Pixel sand over the empty list (see `model/sand.ts`). It fills `areaRef`
 * (the empty state's box below the title row), treats the icon box and
 * each letter of the words as solid, and the pointer too while it's over
 * the area. Paused while the window is in the background.
 */
export function SandScreensaver({
  areaRef,
  iconRef,
  wordsRef,
  closing,
  onShrug,
}: {
  areaRef: RefObject<HTMLElement | null>;
  iconRef: RefObject<HTMLElement | null>;
  wordsRef: RefObject<HTMLElement | null>;
  closing: boolean;
  onShrug: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shrugRef = useRef(onShrug);
  useEffect(() => {
    shrugRef.current = onShrug;
  }, [onShrug]);

  useEffect(() => {
    const area = areaRef.current;
    const canvas = canvasRef.current;
    const card = area?.closest<HTMLElement>(".panel");
    const ctx = canvas?.getContext("2d");
    if (!area || !canvas || !card || !ctx) return;

    const colors = grainColors();
    const arrow = arrowCells(SAND_CELL_PX);
    let show: SandShow | null = null;
    let image: ImageData | null = null;
    let pixels: Uint32Array | null = null;
    let icon: { x0: number; x1: number; top: number } | undefined;
    let pointer: { x: number; y: number } | null = null;
    let frame = 0;
    let last = 0;

    // (Re)builds the grid to fit the area, with the icon and words as solids.
    const layout = () => {
      const a = area.getBoundingClientRect();
      const c = card.getBoundingClientRect();
      const cols = Math.max(1, Math.floor(a.width / SAND_CELL_PX));
      const rows = Math.max(1, Math.floor(a.height / SAND_CELL_PX));
      Object.assign(canvas.style, {
        left: `${a.left - c.left}px`,
        top: `${a.top - c.top}px`,
        width: `${cols * SAND_CELL_PX}px`,
        height: `${rows * SAND_CELL_PX}px`,
      });
      canvas.width = cols;
      canvas.height = rows;
      image = ctx.createImageData(cols, rows);
      pixels = new Uint32Array(image.data.buffer);
      show = new SandShow(cols, rows);
      show.box.setSolids(solidMask(a, cols, rows, iconRef.current, wordsRef.current));
      const box = iconRef.current?.getBoundingClientRect();
      icon = box && {
        x0: Math.ceil((box.left - a.left) / SAND_CELL_PX),
        x1: Math.floor((box.right - a.left) / SAND_CELL_PX) - 1,
        top: Math.floor((box.top - a.top) / SAND_CELL_PX),
      };
    };

    const draw = () => {
      if (!show || !image || !pixels) return;
      const { cells, particles, cols } = show.box;
      for (let i = 0; i < cells.length; i++) {
        const v = cells[i]!;
        pixels[i] = v >= GRAIN ? colors[v - GRAIN]! : 0;
      }
      for (const p of particles) {
        const x = Math.round(p.x);
        const y = Math.round(p.y);
        if (x >= 0 && x < cols && y >= 0 && y < show.box.rows)
          pixels[y * cols + x] = colors[p.v - GRAIN]!;
      }
      ctx.putImageData(image, 0, 0);
    };

    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      if (show) {
        show.box.setCursor(pointer, arrow);
        if (show.frame(dt, icon)) shrugRef.current();
        draw();
      }
      frame = requestAnimationFrame(tick);
    };
    const play = () => {
      if (frame || document.hidden) return;
      last = performance.now();
      frame = requestAnimationFrame(tick);
    };
    const pause = () => {
      cancelAnimationFrame(frame);
      frame = 0;
    };

    const onMove = (e: PointerEvent) => {
      const a = area.getBoundingClientRect();
      const inside =
        e.clientX >= a.left && e.clientX < a.right && e.clientY >= a.top && e.clientY < a.bottom;
      pointer = inside
        ? { x: (e.clientX - a.left) / SAND_CELL_PX, y: (e.clientY - a.top) / SAND_CELL_PX }
        : null;
    };
    const onLeave = () => {
      pointer = null;
    };
    const onVisibility = () => (document.hidden ? pause() : play());

    layout();
    play();
    const resize = new ResizeObserver(() => layout());
    resize.observe(area);
    card.addEventListener("pointermove", onMove);
    card.addEventListener("pointerleave", onLeave);
    window.addEventListener("blur", pause);
    window.addEventListener("focus", play);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      pause();
      resize.disconnect();
      card.removeEventListener("pointermove", onMove);
      card.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("blur", pause);
      window.removeEventListener("focus", play);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [areaRef, iconRef, wordsRef]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="sand-screensaver"
      data-closing={closing || undefined}
    />
  );
}

/** Every grain value's colour as a little-endian RGBA word, shades included. */
function grainColors(): Uint32Array {
  const out = new Uint32Array(SAND_COLORS.length * SAND_SHADES);
  SAND_COLORS.forEach((hex, c) => {
    const n = Number.parseInt(hex.slice(1), 16);
    for (let s = 0; s < SAND_SHADES; s++) {
      // Shades from a little darker to a little lighter than the colour.
      const k = 0.86 + (s / (SAND_SHADES - 1)) * 0.24;
      const ch = (shift: number) => Math.min(255, Math.round(((n >> shift) & 255) * k));
      const alpha = 235;
      out[c * SAND_SHADES + s] = ((alpha << 24) | (ch(0) << 16) | (ch(8) << 8) | ch(16)) >>> 0;
    }
  });
  return out;
}

/**
 * Which cells are solid: the icon's rounded box and the words' letters,
 * drawn at full size and then reduced to cells (any inked pixel counts).
 */
function solidMask(
  area: DOMRect,
  cols: number,
  rows: number,
  icon: HTMLElement | null,
  words: HTMLElement | null,
): Uint8Array {
  const mask = new Uint8Array(cols * rows);
  const width = cols * SAND_CELL_PX;
  const height = rows * SAND_CELL_PX;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return mask;
  ctx.fillStyle = "#000";

  if (icon) {
    const r = icon.getBoundingClientRect();
    const radius = Number.parseFloat(getComputedStyle(icon).borderTopLeftRadius) || 0;
    ctx.beginPath();
    ctx.roundRect(r.left - area.left, r.top - area.top, r.width, r.height, radius);
    ctx.fill();
  }

  // Each letter where the page laid it out, in the same font.
  for (const p of words?.querySelectorAll("p") ?? []) {
    const text = p.firstChild;
    if (!(text instanceof Text)) continue;
    const style = getComputedStyle(p);
    ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const metrics = ctx.measureText("Hg");
    const ascent = metrics.fontBoundingBoxAscent;
    const descent = metrics.fontBoundingBoxDescent;
    const range = document.createRange();
    const chars = text.data;
    for (let i = 0; i < chars.length; i++) {
      if (!chars[i]!.trim()) continue;
      range.setStart(text, i);
      range.setEnd(text, i + 1);
      const r = range.getBoundingClientRect();
      const baseline = r.top + (r.height - ascent - descent) / 2 + ascent;
      ctx.fillText(chars[i]!, r.left - area.left, baseline - area.top);
    }
  }

  const data = ctx.getImageData(0, 0, width, height).data;
  for (let cy = 0; cy < rows; cy++)
    for (let cx = 0; cx < cols; cx++) {
      let solid = false;
      for (let y = 0; y < SAND_CELL_PX && !solid; y++)
        for (let x = 0; x < SAND_CELL_PX && !solid; x++)
          solid = data[((cy * SAND_CELL_PX + y) * width + cx * SAND_CELL_PX + x) * 4 + 3]! > 110;
      if (solid) mask[cy * cols + cx] = 1;
    }
  return mask;
}
