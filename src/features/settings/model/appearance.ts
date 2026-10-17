/**
 * Appearance settings that only the window uses, kept in the web view's
 * storage so they apply before the first paint (no flash of the defaults).
 *
 * Transparency is an adjustment, in percentage points, to the glass tint
 * the owner picked for each area (`--glass-*-base` in `index.css`), so one
 * setting works in both light and dark, whose tints differ. Negative is
 * clearer, positive more solid; 0 is the default. Sliders show it as a
 * see-through percentage instead (`seeThrough`).
 */
export type Appearance = {
  /** The sidebar and the reader, which sit on the window's glass. */
  sidebarTint: number;
  /** The conversation list's panel. */
  listTint: number;
};

export const APPEARANCE_STORAGE_KEY = "mailboat.appearance";

export const DEFAULT_APPEARANCE: Appearance = { sidebarTint: 0, listTint: 0 };

/** How far each slider goes. The sidebar's default is nearly clear already. */
export const TINT_RANGE = {
  sidebarTint: { min: -6, max: 40 },
  listTint: { min: -30, max: 40 },
} as const;

function clampTint(key: keyof Appearance, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  const { min, max } = TINT_RANGE[key];
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Saved appearance; anything missing or unreadable is the default. */
export function parseAppearance(raw: string | null): Appearance {
  let saved: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === "object") saved = parsed as Record<string, unknown>;
  } catch {
    // Fall through to the defaults.
  }
  return {
    sidebarTint: clampTint("sidebarTint", saved.sidebarTint),
    listTint: clampTint("listTint", saved.listTint),
  };
}

export function withTint(a: Appearance, key: keyof Appearance, value: number): Appearance {
  return { ...a, [key]: clampTint(key, value) };
}

/** The CSS custom properties that carry it (see `index.css`). */
export function appearanceVars(a: Appearance): Record<string, string> {
  return {
    "--glass-sidebar-adjust": `${a.sidebarTint}%`,
    "--glass-panel-adjust": `${a.listTint}%`,
  };
}

/**
 * How see-through an area is, in percent: 100 minus its tint. `base` is the
 * area's default tint for the current light or dark look (e.g. 6.5). This
 * is what the sliders show, since "93% see-through" means more than an
 * adjustment like "+5".
 */
export function seeThrough(base: number, tint: number): number {
  return Math.round(100 - Math.min(100, Math.max(0, base + tint)));
}

/**
 * The sliders run in see-through terms (right is clearer), so their value
 * is the tint flipped, and their ends are the tint range flipped.
 */
export function sliderRange(key: keyof Appearance): { min: number; max: number } {
  return { min: -TINT_RANGE[key].max, max: -TINT_RANGE[key].min };
}

export function isDefault(a: Appearance): boolean {
  return a.sidebarTint === 0 && a.listTint === 0;
}
