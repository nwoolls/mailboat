import { SHORT_NAME } from "./brand";

/** Saved settings are named `prefs.<name>`. */
export const PREFS_PREFIX = "prefs.";

/**
 * Copies settings saved under their old names (`<short name>.<name>`) to
 * `prefs.<name>`, unless already there. Copied, not moved: an installed
 * copy of the app may still read the old names.
 */
export function carryOverSettings(storage: Storage, oldPrefix = `${SHORT_NAME}.`) {
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i));
  for (const key of keys) {
    if (!key?.startsWith(oldPrefix)) continue;
    const next = PREFS_PREFIX + key.slice(oldPrefix.length);
    const value = storage.getItem(key);
    if (storage.getItem(next) === null && value !== null) storage.setItem(next, value);
  }
}

// On import, before anything reads a setting (main.tsx imports this first).
carryOverSettings(localStorage);
