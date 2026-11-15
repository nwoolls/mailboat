import type { Label } from "../../../platform/tauri/bindings";

/** WCAG relative luminance of a `#rrggbb` color (0 black … 1 white). */
function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = (Number.parseInt(h.slice(i, i + 2), 16) || 0) / 255;
    return c <= 0.040_45 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG contrast ratio between two colors (1 to 21). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].toSorted((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The text color for a label of `background`: black or white, whichever
 * contrasts more (owner, 2026-11-14: Gmail's own text colors can be hard
 * to read). The same rule as Rust's `labels::text_color_for`, which saves
 * it to Gmail.
 */
export function labelTextColor(background: string): string {
  return contrast(background, "#000000") >= contrast(background, "#ffffff") ? "#000000" : "#ffffff";
}

/**
 * How a label's chip is colored: its Gmail color with readable text, or
 * none (the caller's plain chip). The text color Gmail keeps is ignored,
 * since one set elsewhere can be hard to read on its color.
 */
export function labelChipColors(label: Pick<Label, "colorBg">): {
  background: string;
  color: string;
} | null {
  return label.colorBg ? { background: label.colorBg, color: labelTextColor(label.colorBg) } : null;
}
