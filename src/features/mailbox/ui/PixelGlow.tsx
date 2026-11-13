import { useEffect, useRef } from "react";
import { ASCII_GLOW_DEFAULTS, falloff, wake } from "../model/asciiGlow";
import { bandAlpha, glowBand, pixelGlowTuning } from "../model/pixelGlow";
import { readAsciiColors } from "../../emptyToys/ui/asciiPaint";

/**
 * The glow in pixel art (`model/pixelGlow.ts`). Like the ASCII glow it
 * doesn't move on its own: the gradient glow is still there, invisible,
 * moved by EmptyState as before, and each frame this reads where that glow
 * is, how big and how bright, and draws it in chunky blocks across the
 * card, over a faint smooth glow.
 */
export function PixelGlow({
  glowRef,
  pullRef,
  hidden,
}: {
  glowRef: React.RefObject<HTMLDivElement | null>;
  pullRef: React.RefObject<HTMLDivElement | null>;
  hidden: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let last = performance.now();
    let count = 0;
    let cols = 0;
    let rows = 0;
    let heat = new Float32Array(0);
    let colors = readAsciiColors(0.5, 0.5);

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const t = pixelGlowTuning();
      if (count++ % 30 === 0) colors = readAsciiColors(0.5, 0.5);
      const px = Math.max(1, Math.round(t.pixel));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      const nextCols = Math.ceil(w / px);
      const nextRows = Math.ceil(h / px);
      if (nextCols !== cols || nextRows !== rows) {
        cols = nextCols;
        rows = nextRows;
        heat = new Float32Array(cols * rows);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const glow = glowRef.current;
      const pull = pullRef.current;
      if (!glow || !pull) return;

      const box = canvas.getBoundingClientRect();
      const g = glow.getBoundingClientRect();
      const cx = g.left + g.width / 2 - box.left;
      const cy = g.top + g.height / 2 - box.top;
      const radius = (g.width / 2) * t.radiusScale;
      const strength = Number(getComputedStyle(pull).opacity) || 0;
      const still = reduce.matches;
      const [r, gr, b] = colors.accent;
      const peak = colors.dark ? t.peakDark : t.peakLight;

      // The faint smooth glow underneath: HD-2D's soft light.
      if (t.bloom > 0) {
        const grad = ctx.createRadialGradient(
          cx * dpr,
          cy * dpr,
          0,
          cx * dpr,
          cy * dpr,
          radius * 1.1 * dpr,
        );
        grad.addColorStop(0, `rgb(${r} ${gr} ${b} / ${peak * t.bloom * strength})`);
        grad.addColorStop(1, `rgb(${r} ${gr} ${b} / 0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      // The blocks, band by band, so each band is one fill color.
      const wakeTune = { ...ASCII_GLOW_DEFAULTS, wakeSeconds: t.wakeSeconds };
      const bands: number[][] = Array.from({ length: t.bands + 1 }, () => []);
      for (let y = 0; y < rows; y++) {
        const dy = (y + 0.5) * px - cy;
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x;
          const dx = (x + 0.5) * px - cx;
          const dist = Math.sqrt(dx * dx + dy * dy) / radius;
          const lit = dist < 1.2 ? falloff(dist, 0, ASCII_GLOW_DEFAULTS) * strength : 0;
          const hot = still ? lit : wake(heat[i]!, lit, dt, wakeTune);
          heat[i] = hot;
          const band = glowBand(Math.max(lit, hot * t.wakeStrength), x, y, t);
          if (band > 0) bands[band]!.push(i);
        }
      }
      for (let band = 1; band <= t.bands; band++) {
        const cells = bands[band]!;
        if (!cells.length) continue;
        ctx.fillStyle = `rgb(${r} ${gr} ${b} / ${bandAlpha(band, colors.dark, t)})`;
        for (const i of cells) {
          const x = i % cols;
          const y = (i - x) / cols;
          const x0 = Math.round(x * px * dpr);
          const y0 = Math.round(y * px * dpr);
          ctx.fillRect(
            x0,
            y0,
            Math.round((x + 1) * px * dpr) - x0,
            Math.round((y + 1) * px * dpr) - y0,
          );
        }
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [glowRef, pullRef]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="empty-glow-canvas empty-pixel"
      data-screensaver={hidden || undefined}
    />
  );
}
