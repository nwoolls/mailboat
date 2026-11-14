/**
 * How the Toybox is drawn (Settings → Toybox → Style). Pixel art is how
 * everything began; ASCII art draws in monospace characters on tiles. So
 * far every toy has an ASCII look, and the screensavers follow one at a
 * time (`screensaver/model/looks.ts`).
 */
export type ToyboxStyle = "pixel" | "ascii";

export const TOYBOX_STYLES: readonly { id: ToyboxStyle; label: string }[] = [
  { id: "pixel", label: "Pixel art" },
  { id: "ascii", label: "ASCII art" },
];

export const TOYBOX_STYLE_KEY = "prefs.toyboxStyle";

/** The saved style, or pixel art. */
export function parseStyle(raw: string | null): ToyboxStyle {
  let saved: unknown = null;
  try {
    saved = raw ? JSON.parse(raw) : null;
  } catch {
    // Fall through to pixel art.
  }
  return TOYBOX_STYLES.find((s) => s.id === saved)?.id ?? "pixel";
}
