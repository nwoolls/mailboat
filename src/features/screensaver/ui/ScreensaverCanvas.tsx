import { type RefObject, useEffect, useRef, useState } from "react";
import {
  cellPxOf,
  isSceneId,
  makeScene,
  pickScene,
  SCREENSAVER_EVENT,
  SCREENSAVER_IDLE_SECONDS,
  SCREENSAVER_ROTATE_MINUTES,
  type SceneId,
} from "../model/catalog";
import { colorTable, type PaletteId, paletteColors, parseColor } from "../model/palettes";
import type { Pointer, Rect, Scene } from "../model/scene";
import { isRealMove } from "../../../shared/lib/pointer";
import { screensaverPrefs } from "./prefs";

export type ScreensaverPhase = "off" | "on" | "closing";
const CLOSE_MS = 450;

/**
 * When the empty list's screensaver runs. It starts after
 * SCREENSAVER_IDLE_SECONDS without any input while the window is visible,
 * even with another app in front (owner's choice: it's something to look
 * at beside other work), or at once from the palette's "Start
 * screensaver". It closes on a key, click or scroll. Moving the pointer
 * doesn't close it: the sand plays with the pointer instead. Never starts
 * with "Reduce motion" on, and never while `enabled` (its feature flag) is
 * off.
 *
 * With "Random" chosen, a screensaver left running switches to another
 * scene every SCREENSAVER_ROTATE_MINUTES (a scene picked by name from the
 * palette stays).
 *
 * Pointer events that don't actually move (WebKit sends some when the page
 * changes under a still cursor, such as when the palette closes) don't
 * count as input.
 */
export function useScreensaver(enabled: boolean): { phase: ScreensaverPhase; scene: SceneId } {
  const [phase, setPhase] = useState<ScreensaverPhase>("off");
  const [scene, setScene] = useState<SceneId>("sandscape");
  // Whether the running screensaver came from "Random", so it rotates.
  const rotating = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let timer = 0;
    let last: { x: number; y: number } | null = null;
    // Picks the scene (the one asked for, the chosen one, or a random one
    // other than the last) and starts it.
    const begin = (asked: SceneId | null) => {
      const choice = screensaverPrefs.get().choice;
      rotating.current = asked === null && choice === "random";
      setScene((prev) => pickScene(asked, choice, prev, Math.random));
      setPhase("on");
    };
    // Starts even while the window is hidden: macOS counts a window that
    // another app covers completely as hidden, and waiting for it to show
    // again meant coming back to no screensaver (and another minute's wait,
    // which the click bringing it forward then reset). The canvas pauses
    // itself while hidden, so this costs nothing.
    const start = () => !reduced() && begin(null);
    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(start, SCREENSAVER_IDLE_SECONDS * 1000);
    };
    if (phase === "off") {
      arm();
      // Asked for: start now, and don't let the palette closing (its key, a stray pointer event) cancel it.
      let now = 0;
      const onStartNow = (e: Event) => {
        const asked = e instanceof CustomEvent && isSceneId(e.detail) ? e.detail : null;
        window.clearTimeout(now);
        now = window.setTimeout(() => !reduced() && begin(asked), 300);
      };
      const onMove = (e: PointerEvent) => {
        const moved = isRealMove(last, e);
        last = { x: e.clientX, y: e.clientY };
        if (moved) arm();
      };
      const events = ["keydown", "pointerdown", "wheel"] as const;
      for (const e of events) window.addEventListener(e, arm, { passive: true });
      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener(SCREENSAVER_EVENT, onStartNow);
      return () => {
        window.clearTimeout(timer);
        window.clearTimeout(now);
        for (const e of events) window.removeEventListener(e, arm);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener(SCREENSAVER_EVENT, onStartNow);
      };
    }
    if (phase === "on") {
      const close = () => setPhase("closing");
      const events = ["keydown", "pointerdown", "wheel"] as const;
      for (const e of events) window.addEventListener(e, close, { passive: true });
      const rotate = window.setInterval(() => {
        if (rotating.current && screensaverPrefs.get().choice === "random")
          setScene((prev) => pickScene(null, "random", prev, Math.random));
      }, SCREENSAVER_ROTATE_MINUTES * 60_000);
      return () => {
        window.clearInterval(rotate);
        for (const e of events) window.removeEventListener(e, close);
      };
    }
    timer = window.setTimeout(() => setPhase("off"), CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [phase, enabled]);

  return { phase: enabled ? phase : "off", scene };
}

/**
 * A screensaver scene over the empty list (see `model/scene.ts`). It fills
 * `areaRef` (the empty state's box below the title row), gives the scene
 * the icon box and each letter of the words as shapes to play with, and
 * the pointer while it's over the area, and colours it with `palette`. It
 * keeps playing while another app is in front, and pauses only when the
 * window is hidden (minimized, or another Space).
 */
export function ScreensaverCanvas({
  sceneId,
  palette,
  areaRef,
  iconRef,
  wordsRef,
  closing,
  onNod,
}: {
  sceneId: SceneId;
  palette: PaletteId;
  areaRef: RefObject<HTMLElement | null>;
  iconRef: RefObject<HTMLElement | null>;
  wordsRef: RefObject<HTMLElement | null>;
  closing: boolean;
  onNod: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodRef = useRef(onNod);
  const colorsRef = useRef<Uint32Array>(new Uint32Array(0));
  useEffect(() => {
    nodRef.current = onNod;
  }, [onNod]);
  // Recoloured at once when the palette changes, without restarting.
  useEffect(() => {
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--color-accent");
    colorsRef.current = colorTable(paletteColors(palette, parseColor(accent)));
  }, [palette]);

  useEffect(() => {
    const area = areaRef.current;
    const canvas = canvasRef.current;
    const card = area?.closest<HTMLElement>(".panel");
    const ctx = canvas?.getContext("2d");
    if (!area || !canvas || !card || !ctx) return;

    const px = cellPxOf(sceneId);
    let scene: Scene | null = null;
    let image: ImageData | null = null;
    let pixels: Uint32Array | null = null;
    let cells: Uint8Array | null = null;
    let pointer: Pointer = null;
    let frame = 0;
    let last = 0;

    // (Re)starts the scene to fit the area, with the icon and words in it.
    const layout = () => {
      const a = area.getBoundingClientRect();
      const c = card.getBoundingClientRect();
      const cols = Math.max(1, Math.floor(a.width / px));
      const rows = Math.max(1, Math.floor(a.height / px));
      Object.assign(canvas.style, {
        left: `${a.left - c.left}px`,
        top: `${a.top - c.top}px`,
        width: `${cols * px}px`,
        height: `${rows * px}px`,
      });
      canvas.width = cols;
      canvas.height = rows;
      image = ctx.createImageData(cols, rows);
      pixels = new Uint32Array(image.data.buffer);
      cells = new Uint8Array(cols * rows);
      const { solid, letters } = solidMask(a, cols, rows, px, iconRef.current, wordsRef.current);
      scene = makeScene(sceneId, {
        cols,
        rows,
        solid,
        letters,
        icon: rectOf(iconRef.current, a, cols, rows, px),
        // The words' box is wider than the text; use the letters' extent.
        words: boundsOf(letters, cols),
        rng: Math.random,
      });
    };

    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      if (scene && image && pixels && cells) {
        const result = scene.frame(dt, pointer);
        if (result.nod) nodRef.current();
        if (result.hideWords !== undefined) setWordsHidden(wordsRef.current, result.hideWords);
        // The sandscape's turn: the canvas rotates, then the grid is turned.
        canvas.style.transform = result.turn ? `rotate(${result.turn}deg)` : "";
        scene.draw(cells);
        const colors = colorsRef.current;
        for (let i = 0; i < cells.length; i++) pixels[i] = colors[cells[i]!] ?? 0;
        ctx.putImageData(image, 0, 0);
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
      pointer = inside ? { x: (e.clientX - a.left) / px, y: (e.clientY - a.top) / px } : null;
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
    document.addEventListener("visibilitychange", onVisibility);
    const words = wordsRef.current;
    return () => {
      pause();
      resize.disconnect();
      card.removeEventListener("pointermove", onMove);
      card.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      setWordsHidden(words, false);
    };
  }, [sceneId, areaRef, iconRef, wordsRef]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="screensaver"
      data-closing={closing || undefined}
    />
  );
}

/** Fades the words out (Life plays with them) or back in. */
function setWordsHidden(words: HTMLElement | null, hidden: boolean) {
  if (!words) return;
  if (hidden) words.dataset.sceneHidden = "";
  else delete words.dataset.sceneHidden;
}

/** The smallest box around the set cells of `mask`, or null if none are. */
function boundsOf(mask: Uint8Array, cols: number): Rect | null {
  let box: Rect | null = null;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const x = i % cols;
    const y = Math.floor(i / cols);
    if (!box) box = { x0: x, y0: y, x1: x, y1: y };
    else {
      box.x0 = Math.min(box.x0, x);
      box.x1 = Math.max(box.x1, x);
      box.y1 = y;
    }
  }
  return box;
}

/** A distance in pixels as a cell index, kept on the grid. */
function cell(v: number, max: number, px: number): number {
  return Math.max(0, Math.min(max - 1, Math.floor(v / px)));
}

/** An element's box in cells of the area, or null if it isn't there. */
function rectOf(
  el: HTMLElement | null,
  area: DOMRect,
  cols: number,
  rows: number,
  px: number,
): Rect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  return {
    x0: cell(r.left - area.left, cols, px),
    y0: cell(r.top - area.top, rows, px),
    x1: cell(r.right - area.left - 1, cols, px),
    y1: cell(r.bottom - area.top - 1, rows, px),
  };
}

/**
 * Which cells are solid: the icon's rounded box and the words' letters,
 * drawn at full size and then reduced to cells (any inked pixel counts).
 * `letters` is the letters alone.
 */
function solidMask(
  area: DOMRect,
  cols: number,
  rows: number,
  px: number,
  icon: HTMLElement | null,
  words: HTMLElement | null,
): { solid: Uint8Array; letters: Uint8Array } {
  const width = cols * px;
  const height = rows * px;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { solid: new Uint8Array(cols * rows), letters: new Uint8Array(cols * rows) };
  ctx.fillStyle = "#000";

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
  const letters = toCells(ctx, cols, rows, px);

  if (icon) {
    const r = icon.getBoundingClientRect();
    const radius = Number.parseFloat(getComputedStyle(icon).borderTopLeftRadius) || 0;
    ctx.beginPath();
    ctx.roundRect(r.left - area.left, r.top - area.top, r.width, r.height, radius);
    ctx.fill();
  }
  return { solid: toCells(ctx, cols, rows, px), letters };
}

/** Reduces what's drawn to cells: a cell counts if any pixel in it is inked. */
function toCells(
  ctx: CanvasRenderingContext2D,
  cols: number,
  rows: number,
  px: number,
): Uint8Array {
  const width = cols * px;
  const data = ctx.getImageData(0, 0, width, rows * px).data;
  const mask = new Uint8Array(cols * rows);
  for (let cy = 0; cy < rows; cy++)
    for (let cx = 0; cx < cols; cx++) {
      let inked = false;
      for (let y = 0; y < px && !inked; y++)
        for (let x = 0; x < px && !inked; x++)
          inked = data[((cy * px + y) * width + cx * px + x) * 4 + 3]! > 110;
      if (inked) mask[cy * cols + cx] = 1;
    }
  return mask;
}
