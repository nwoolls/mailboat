import { BLEND_STEPS, INK_COUNT, SHADES, SLOT_COUNT } from "./scene";

/**
 * Screensaver palettes: five colours each, filling the scene slots dark,
 * mid, light, bright and accent. "Mono + accent" and "Accent" follow the
 * accent chosen in Settings → Appearance; the others are fixed.
 */
export type Rgb = readonly [number, number, number];

export type PaletteId = "mono" | "accent" | "ocean" | "desert" | "dusk" | "forest";

/** "accent" stands for the configured accent colour. */
type Spec = readonly (string | "accent")[];

export const PALETTES: readonly { id: PaletteId; label: string }[] = [
  { id: "mono", label: "Mono + accent" },
  { id: "accent", label: "Accent" },
  { id: "ocean", label: "Ocean" },
  { id: "desert", label: "Desert" },
  { id: "dusk", label: "Dusk" },
  { id: "forest", label: "Forest" },
];

export const DEFAULT_PALETTE: PaletteId = "mono";

const SPECS: Record<Exclude<PaletteId, "accent">, Spec> = {
  mono: ["#4a4d55", "#80848d", "#b6bac2", "#e8eaee", "accent"],
  ocean: ["#1f4a94", "#2f6fd0", "#a3d0ff", "#e9ddc3", "#0a84ff"],
  desert: ["#7a3b2e", "#c0623f", "#e0a96d", "#f3dfb8", "#2a9d8f"],
  dusk: ["#2e2a5a", "#6b4f9a", "#d48aa8", "#f6c99a", "#f2b134"],
  forest: ["#22412e", "#4f7a3a", "#9fbf73", "#e8e2c4", "#e3a33b"],
};

/** Parses `#rrggbb` or CSS `hsl(h s% l%)` (the accents' format); else null. */
export function parseColor(css: string): Rgb | null {
  const s = css.trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(s);
  if (hex) {
    const n = Number.parseInt(hex[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const hsl = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/i.exec(s);
  if (!hsl) return null;
  const h = Number(hsl[1]) / 360;
  const sat = Number(hsl[2]) / 100;
  const l = Number(hsl[3]) / 100;
  const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat;
  const p = 2 * l - q;
  const channel = (t: number) => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    const v =
      u < 1 / 6
        ? p + (q - p) * 6 * u
        : u < 1 / 2
          ? q
          : u < 2 / 3
            ? p + (q - p) * (2 / 3 - u) * 6
            : p;
    return Math.round(v * 255);
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)];
}

/** `a` moved `t` of the way towards `b`. */
export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [0, 1, 2].map((i) => Math.round(a[i]! + (b[i]! - a[i]!) * t)) as unknown as Rgb;
}

const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];
const FALLBACK_ACCENT: Rgb = [10, 132, 255];

/** The palette's five colours, slot order, with `accent` filled in. */
export function paletteColors(id: PaletteId, accent: Rgb | null): Rgb[] {
  const a = accent ?? FALLBACK_ACCENT;
  if (id === "accent")
    return [mix(a, BLACK, 0.5), mix(a, BLACK, 0.22), mix(a, WHITE, 0.4), mix(a, WHITE, 0.75), a];
  return SPECS[id].map((c) => (c === "accent" ? a : (parseColor(c) ?? FALLBACK_ACCENT)));
}

/**
 * The colour of every value a scene can draw, as little-endian RGBA words
 * for an ImageData buffer: index 0 is clear, then each slot's shades.
 */
export function colorTable(colors: readonly Rgb[]): Uint32Array {
  const out = new Uint32Array(INK_COUNT);
  const word = ([r, g, b]: Rgb) => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
  const of = (slot: number) => colors[slot] ?? FALLBACK_ACCENT;
  for (let slot = 0; slot < SLOT_COUNT; slot++)
    for (let s = 0; s < SHADES; s++) {
      const k = 0.86 + (s / (SHADES - 1)) * 0.24;
      out[1 + slot * SHADES + s] = word(
        of(slot).map((v) => Math.min(255, Math.round(v * k))) as unknown as Rgb,
      );
    }
  // Then `blend`'s steps between every two slots.
  let i = 1 + SLOT_COUNT * SHADES;
  for (let from = 0; from < SLOT_COUNT; from++)
    for (let to = 0; to < SLOT_COUNT; to++)
      for (let k = 1; k < BLEND_STEPS; k++) out[i++] = word(mix(of(from), of(to), k / BLEND_STEPS));
  return out;
}

export function paletteFor(id: unknown): PaletteId {
  return PALETTES.find((p) => p.id === id)?.id ?? DEFAULT_PALETTE;
}

/** Channel `k` (0 red, 1 green, 2 blue, 3 alpha) of an RGBA word. */
const ch = (w: number, k: number) => (w >>> (k * 8)) & 255;

/** How solid the night sky is (0 to 255): the glass shows through a little. */
export const SKY_ALPHA = 235;

/**
 * Turns a drawn frame into pixels over a night sky, for scenes that want
 * one on a light page (`Scene.night`): each row of sky runs from `top` to
 * `bottom` (RGBA words, as from `colorTable`), and each cell's colour is
 * laid over it by its opacity. The result is as solid as the sky.
 */
export function paintOverSky(
  pixels: Uint32Array,
  cells: Uint8Array,
  opacity: Uint8Array,
  colors: Uint32Array,
  cols: number,
  top: number,
  bottom: number,
) {
  const rows = Math.max(1, Math.floor(cells.length / cols));
  for (let y = 0; y < rows; y++) {
    const t = rows > 1 ? y / (rows - 1) : 0;
    const sky = [0, 1, 2].map((k) => ch(top, k) + (ch(bottom, k) - ch(top, k)) * t);
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const c = cells[i] ? (colors[cells[i]!] ?? 0) : 0;
      const a = cells[i] ? ((opacity[i]! / 255) * ch(c, 3)) / 255 : 0;
      const [r, g, b] = [0, 1, 2].map((k) => Math.round(ch(c, k) * a + sky[k]! * (1 - a)));
      pixels[i] = ((SKY_ALPHA << 24) | (b! << 16) | (g! << 8) | r!) >>> 0;
    }
  }
}
