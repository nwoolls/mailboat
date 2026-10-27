import { PREVIOUS_SHORT_NAME } from "./brand";

/** Saved settings are named `prefs.<name>`. */
export const PREFS_PREFIX = "prefs.";

/**
 * Moves settings saved under their old names (`<previous short name>.<name>`)
 * to `prefs.<name>`, unless already there, and drops the old ones. They
 * arrive with the rest of the web view's storage when the first launch
 * after the rename copies it over; the old app keeps its own copy.
 */
export function carryOverSettings(storage: Storage, oldPrefix = `${PREVIOUS_SHORT_NAME}.`) {
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i));
  for (const key of keys) {
    if (!key?.startsWith(oldPrefix)) continue;
    const next = PREFS_PREFIX + key.slice(oldPrefix.length);
    const value = storage.getItem(key);
    if (storage.getItem(next) === null && value !== null) storage.setItem(next, value);
    storage.removeItem(key);
  }
}

// On import, before anything reads a setting (main.tsx imports this first).
carryOverSettings(localStorage);
