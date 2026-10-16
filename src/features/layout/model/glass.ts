/**
 * How much more see-through the glass is than the default, in percent:
 * every glass tint's strength is scaled down by this much, so the window,
 * the list panel and the reader's layers all get clearer together and keep
 * their differences. 0 is the default look; 100 leaves only the native
 * blur, with no tint at all.
 */
export const GLASS_BOOST_MAX = 100;
export const GLASS_BOOST_STEP = 5;
export const GLASS_BOOST_STORAGE_KEY = "mailboat.glassBoost";

/** A saved boost, kept to 0–100 in steps of 5; anything unreadable is 0. */
export function parseGlassBoost(saved: string | null): number {
  const n = Number(saved);
  if (saved === null || !Number.isFinite(n)) return 0;
  const stepped = Math.round(n / GLASS_BOOST_STEP) * GLASS_BOOST_STEP;
  return Math.min(GLASS_BOOST_MAX, Math.max(0, stepped));
}

/** The factor applied to every glass tint's strength (1 = default). */
export function glassScale(boost: number): number {
  return 1 - boost / 100;
}
