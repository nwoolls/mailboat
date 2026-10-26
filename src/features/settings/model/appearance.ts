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
  /** One of `ACCENTS`, by id. */
  accent: AccentId;
};

/**
 * Accent colours, as macOS offers (no yellow: white text and icons sit on
 * the accent, and wouldn't read on it). Blue is the app's own.
 */
export const ACCENTS = [
  { id: "blue", label: "Blue", color: "hsl(217 85% 62%)" },
  { id: "purple", label: "Purple", color: "hsl(266 65% 64%)" },
  { id: "pink", label: "Pink", color: "hsl(330 70% 62%)" },
  { id: "red", label: "Red", color: "hsl(2 72% 60%)" },
  { id: "orange", label: "Orange", color: "hsl(26 85% 56%)" },
  { id: "green", label: "Green", color: "hsl(142 50% 46%)" },
  { id: "graphite", label: "Graphite", color: "hsl(240 4% 56%)" },
] as const;

export type AccentId = (typeof ACCENTS)[number]["id"];

export const APPEARANCE_STORAGE_KEY = "prefs.appearance";

export const DEFAULT_APPEARANCE: Appearance = { sidebarTint: 0, listTint: 0, accent: "blue" };

function accentFor(id: unknown): AccentId {
  return ACCENTS.find((a) => a.id === id)?.id ?? "blue";
}

/**
 * What may be stored: enough to reach fully clear (0% tint) and fully
 * solid (100%) from each area's default tint in light or dark (sidebar
 * 6.5% dark, 10% light; list 34% dark, 37% light, in `index.css`). The CSS
 * clamps the sum to 0–100% either way.
 */
export const TINT_RANGE = {
  sidebarTint: { min: -10, max: 93.5 },
  listTint: { min: -37, max: 66 },
} as const;

/** Kept to half points, so a default of 6.5% can reach exactly 0. */
function clampTint(key: TintKey, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  const { min, max } = TINT_RANGE[key];
  return Math.min(max, Math.max(min, Math.round(value * 2) / 2));
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
    accent: accentFor(saved.accent),
  };
}

type TintKey = "sidebarTint" | "listTint";

export function withTint(a: Appearance, key: TintKey, value: number): Appearance {
  return { ...a, [key]: clampTint(key, value) };
}

/** The CSS custom properties that carry it (see `index.css`). */
export function appearanceVars(a: Appearance): Record<string, string> {
  return {
    "--glass-sidebar-adjust": `${a.sidebarTint}%`,
    "--glass-panel-adjust": `${a.listTint}%`,
    "--color-accent": ACCENTS.find((x) => x.id === a.accent)!.color,
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
 * The adjustment that makes an area `percent` see-through, from its
 * default tint `base` (the sliders run 0–100% see-through, right being
 * clearer).
 */
export function tintFor(base: number, percent: number): number {
  return 100 - Math.min(100, Math.max(0, percent)) - base;
}

export function isDefault(a: Appearance): boolean {
  return a.sidebarTint === 0 && a.listTint === 0 && a.accent === "blue";
}
