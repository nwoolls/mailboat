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
import { parseColor, type Rgb } from "../../screensaver/model/palettes";

const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
/** Character colors from the accent (0) to the hot color (STEPS - 1), then one in the page's own color. */
const STEPS = 4;
/** Tile colors from the accent to the hot color. */
const TILE_STEPS = 8;

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
  /** The icon and words: kept clear of characters, so they still read. */
  iconRef: React.RefObject<HTMLDivElement | null>;
  wordsRef: React.RefObject<HTMLDivElement | null>;
  hidden: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

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
    let dark = true;
    let atlas: HTMLCanvasElement | null = null;
    let tiles: string[] = [];
    let lookKey = "";
    let gridKey = "";

    // Colors come from the page, so they follow the accent and light or
    // dark; read again now and then, not every frame.
    const readColors = () => {
      const root = getComputedStyle(document.documentElement);
      const accent = parseColor(root.getPropertyValue("--color-accent")) ?? [80, 140, 240];
      const content = parseColor(root.getPropertyValue("--color-content")) ?? [235, 235, 238];
      const base = parseColor(root.getPropertyValue("--color-background-base")) ?? [22, 22, 24];
      dark = luma(content) > luma(base);
      const hot = mix(accent, content, dark ? t.hotMixDark : t.hotMixLight);
      return { accent, content, base, hot };
    };
    let colors = readColors();

    // What the glow clears round (`clearing`): the icon's box and each
    // line of the words, measured round the letters themselves as the pond
    // does. Re-measured now and then, as they rise in.
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
      const words = wordsRef.current;
      if (words) {
        // Each text node on its own: a range over the whole element also
        // returns its paragraphs' boxes, as wide as the words' column.
        const range = document.createRange();
        const walker = document.createTreeWalker(words, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          range.selectNodeContents(node);
          for (const r of range.getClientRects()) if (r.width > 0) shapes.push(shape("words", r));
        }
      }
    };

    const layout = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const nextDpr = Math.min(2, window.devicePixelRatio || 1);
      ctx.font = `${t.fontPx}px ${MONO}`;
      const nextCw = Math.ceil(ctx.measureText("M").width);
      const nextCh = Math.round(t.fontPx * t.lineHeight);
      const nextCols = Math.ceil(w / nextCw);
      const nextRows = Math.ceil(h / nextCh);
      const pxW = Math.round(w * nextDpr);
      const pxH = Math.round(h * nextDpr);
      if (canvas.width !== pxW || canvas.height !== pxH) {
        canvas.width = pxW;
        canvas.height = pxH;
      }
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
      dpr = nextDpr;
      cw = nextCw;
      ch = nextCh;
      const key = [
        cw,
        ch,
        dpr,
        t.ramp,
        t.fontPx,
        ...colors.accent,
        ...colors.hot,
        ...colors.base,
      ].join();
      if (key !== lookKey) {
        lookKey = key;
        atlas = buildAtlas(t, cw, ch, dpr, colors.accent, colors.hot, colors.base);
        tiles = Array.from({ length: TILE_STEPS }, (_, k) =>
          rgb(mix(colors.accent, colors.hot, k / (TILE_STEPS - 1))),
        );
      }
      const grid = `${cw}/${ch}/${dark ? t.gridDark : t.gridLight}/${colors.content.join()}`;
      if (grid !== gridKey) {
        gridKey = grid;
        const line = `rgb(${colors.content.join(" ")} / ${dark ? t.gridDark : t.gridLight})`;
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
      if (count++ % 30 === 0) colors = readColors();
      layout();
      if (count % 15 === 1) measure();

      const glow = glowRef.current;
      const pull = pullRef.current;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!glow || !pull || !atlas) return;

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
            clearing((col + 0.5) * cw, (row + 0.5) * ch, shapes, t),
            t,
          );
          if (v < t.cutoff || fade <= 0.01) continue;
          let notch = 0;
          if (!still) {
            const sh = shimmer(clock[i]!, v, seed[i]!, dt, t);
            clock[i] = sh.clock;
            notch = sh.notch;
          }
          const look = cellLook(v, seed[i]!, notch, dark, t);
          if (!look) continue;
          const x = col * cw * dpr;
          const y = row * ch * dpr;
          ctx.globalAlpha = look.tileAlpha * fade;
          ctx.fillStyle = look.hot
            ? tiles[TILE_STEPS - 1]!
            : tiles[Math.round(look.warmth * (TILE_STEPS - 1))]!;
          ctx.fillRect(x + dpr * 0.5, y + dpr * 0.5, (cw - 1) * dpr, (ch - 1) * dpr);
          const step = look.hot ? STEPS : v > 0.6 ? 2 : 1;
          ctx.globalAlpha = look.glyphAlpha * fade;
          ctx.drawImage(
            atlas,
            look.glyph * cw * dpr,
            step * ch * dpr,
            cw * dpr,
            ch * dpr,
            x,
            y,
            cw * dpr,
            ch * dpr,
          );
        }
      }
      ctx.globalAlpha = 1;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [glowRef, pullRef, iconRef, wordsRef]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="empty-ascii"
      data-screensaver={hidden || undefined}
    />
  );
}

/**
 * Every ramp character, once per color: rows 0 to STEPS - 1 run from the
 * accent to the hot color, row STEPS is the page's background color (for
 * a character on a pale tile). Column k is the ramp's k-th character.
 */
function buildAtlas(
  t: AsciiGlowTuning,
  cw: number,
  ch: number,
  dpr: number,
  accent: Rgb,
  hot: Rgb,
  base: Rgb,
): HTMLCanvasElement {
  const atlas = document.createElement("canvas");
  atlas.width = Math.ceil(t.ramp.length * cw * dpr);
  atlas.height = Math.ceil((STEPS + 1) * ch * dpr);
  const a = atlas.getContext("2d");
  if (!a) return atlas;
  a.scale(dpr, dpr);
  a.font = `${t.fontPx}px ${MONO}`;
  a.textAlign = "center";
  a.textBaseline = "middle";
  for (let row = 0; row <= STEPS; row++) {
    a.fillStyle = row === STEPS ? rgb(base) : rgb(mix(accent, hot, row / (STEPS - 1)));
    for (let k = 1; k < t.ramp.length; k++)
      a.fillText(t.ramp[k]!, k * cw + cw / 2, row * ch + ch / 2 + 0.5);
  }
  return atlas;
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

function luma(c: Rgb): number {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
