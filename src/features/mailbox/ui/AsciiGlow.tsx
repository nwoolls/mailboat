import { useEffect, useRef } from "react";
import {
  asciiGlowTuning,
  type AsciiGlowTuning,
  cellLook,
  type ClearShape,
  cleared,
  clearing,
  edgeWobble,
  falloff,
  shimmer,
  wake,
} from "../model/asciiGlow";
import {
  asciiCell,
  AsciiPainter,
  GLYPH_ON_HOT,
  readAsciiColors,
} from "../../emptyToys/ui/asciiPaint";

/**
 * The glow as ASCII art (`model/asciiGlow.ts`). It doesn't move on its
 * own: the gradient glow is still there, invisible, moved by EmptyState
 * exactly as before (following the pointer, lingering, drifting home), and
 * each frame this reads where that glow is, how big and how bright, and
 * draws it in characters across the card. So the two looks always move the
 * same, and the glow's fade during a screensaver comes along too.
 */
export function AsciiGlow({
  glowRef,
  pullRef,
  iconRef,
  wordsRef,
  hidden,
}: {
  glowRef: React.RefObject<HTMLDivElement | null>;
  pullRef: React.RefObject<HTMLDivElement | null>;
  /** The icon and words: the glow thins out around them (and the card's title), so they still read. */
  iconRef: React.RefObject<HTMLDivElement | null>;
  wordsRef: React.RefObject<HTMLDivElement | null>;
  hidden: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    // Under a screensaver the glow is faded out and costs nothing: no
    // frames until it shows again (its last frame stays for the fade).
    if (hidden) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const painter = new AsciiPainter(ctx);

    let t: AsciiGlowTuning = asciiGlowTuning();
    let frame = 0;
    let last = performance.now();
    let count = 0;
    let dpr = 1;
    let cw = 0;
    let ch = 0;
    let cols = 0;
    let rows = 0;
    let heat = new Float32Array(0);
    let seed = new Float32Array(0);
    let clock = new Float32Array(0);
    let gridKey = "";
    // Colors come from the page, so they follow the accent and light or
    // dark; read again now and then, not every frame.
    let colors = readAsciiColors(t.hotMixDark, t.hotMixLight);

    // What the glow clears around (`clearing`): the icon's box and each
    // line of the words, measured around the letters themselves as the
    // pond does. Re-measured now and then, as they rise in.
    let shapes: ClearShape[] = [];
    const measure = () => {
      const box = canvas.getBoundingClientRect();
      const shape = (kind: ClearShape["kind"], r: DOMRect): ClearShape => ({
        kind,
        x0: r.left - box.left,
        y0: r.top - box.top,
        x1: r.right - box.left,
        y1: r.bottom - box.top,
      });
      shapes = [];
      const icon = iconRef.current?.getBoundingClientRect();
      if (icon && icon.width > 0) shapes.push(shape("icon", icon));
      // The words, and the card's title as they are (`data-card-title`):
      // the glow spans the title row too.
      const title = canvas.closest(".panel")?.querySelector<HTMLElement>("[data-card-title]");
      for (const el of [wordsRef.current, title]) {
        if (!el) continue;
        // Each text node on its own: a range over the whole element also
        // returns its paragraphs' boxes, as wide as the words' column.
        const range = document.createRange();
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          range.selectNodeContents(node);
          for (const r of range.getClientRects()) if (r.width > 0) shapes.push(shape("words", r));
        }
      }
    };

    const layout = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      ({ cw, ch } = asciiCell(ctx, t.fontPx, t.lineHeight));
      const pxW = Math.round(w * dpr);
      const pxH = Math.round(h * dpr);
      if (canvas.width !== pxW || canvas.height !== pxH) {
        canvas.width = pxW;
        canvas.height = pxH;
      }
      const nextCols = Math.ceil(w / cw);
      const nextRows = Math.ceil(h / ch);
      if (nextCols !== cols || nextRows !== rows) {
        cols = nextCols;
        rows = nextRows;
        const n = cols * rows;
        heat = new Float32Array(n);
        seed = new Float32Array(n);
        clock = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          seed[i] = Math.random();
          clock[i] = Math.random();
        }
      }
      painter.prepare(cw, ch, dpr, t.fontPx, t.ramp, colors);
      const grid = colors.dark ? t.gridDark : t.gridLight;
      const key = `${cw}/${ch}/${grid}/${colors.content.join()}`;
      if (key !== gridKey) {
        gridKey = key;
        const line = `rgb(${colors.content.join(" ")} / ${grid})`;
        canvas.style.backgroundImage = `linear-gradient(to right, ${line} 1px, transparent 1px), linear-gradient(to bottom, ${line} 1px, transparent 1px)`;
        canvas.style.backgroundSize = `${cw}px ${ch}px`;
      }
    };
    layout();

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      t = asciiGlowTuning();
      if (count++ % 30 === 0) colors = readAsciiColors(t.hotMixDark, t.hotMixLight);
      layout();
      if (count % 15 === 1) measure();

      const glow = glowRef.current;
      const pull = pullRef.current;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!glow || !pull) return;

      // Where the (invisible) gradient glow is, and how strong.
      const box = canvas.getBoundingClientRect();
      const g = glow.getBoundingClientRect();
      const cx = g.left + g.width / 2 - box.left;
      const cy = g.top + g.height / 2 - box.top;
      const radius = (g.width / 2) * t.radiusScale;
      const strength = Number(getComputedStyle(pull).opacity) || 0;
      const still = reduce.matches;
      const s = now / 1000;

      for (let row = 0; row < rows; row++) {
        const dy = (row + 0.5) * ch - cy;
        for (let col = 0; col < cols; col++) {
          const i = row * cols + col;
          const dx = (col + 0.5) * cw - cx;
          const dist = Math.sqrt(dx * dx + dy * dy) / radius;
          const lit =
            dist < t.reach + t.wobble
              ? falloff(dist, still ? 0 : edgeWobble(col, row, s, t), t) * strength
              : 0;
          const h = still ? lit : wake(heat[i]!, lit, dt, t);
          heat[i] = h;
          const glowing = Math.max(lit, h * t.wakeStrength);
          if (glowing < t.cutoff) continue;
          const { v, fade } = cleared(
            glowing,
            clearing((col + 0.5) * cw, (row + 0.5) * ch, shapes, t, cw / 2, ch / 2),
            t,
          );
          if (v < t.cutoff || fade <= 0.01) continue;
          let notch = 0;
          if (!still) {
            const sh = shimmer(clock[i]!, v, seed[i]!, dt, t);
            clock[i] = sh.clock;
            notch = sh.notch;
          }
          const look = cellLook(v, seed[i]!, notch, colors.dark, t);
          if (!look) continue;
          const x = col * cw;
          const y = row * ch;
          painter.tile(x, y, look.warmth, look.tileAlpha * fade);
          painter.glyph(
            x,
            y,
            t.ramp[look.glyph]!,
            look.hot ? GLYPH_ON_HOT : v > 0.6 ? 2 : 1,
            look.glyphAlpha * fade,
          );
        }
      }
      ctx.globalAlpha = 1;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [glowRef, pullRef, iconRef, wordsRef, hidden]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="empty-glow-canvas empty-ascii"
      data-screensaver={hidden || undefined}
    />
  );
}
