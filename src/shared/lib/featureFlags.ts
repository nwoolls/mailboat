import { localStore } from "./localStore";

/**
 * Switches for the playful extras, in Settings → Toybox (they began as
 * feature flags, hence the name; the storage key stays so choices made
 * then are kept). Window-only, so they live in the web view's storage like the
 * appearance settings, and every part of the window sees a change at once.
 */
export type FeatureFlags = {
  /** The soft glow drifting behind an empty list, drawn to the pointer. */
  emptyGlow: boolean;
  /** Screensavers over an empty list (which one: Settings → Toybox). */
  screensavers: boolean;
};

export type FeatureFlagId = keyof FeatureFlags;

/** What Settings lists, in order. */
export const FEATURE_FLAGS: readonly { id: FeatureFlagId; label: string; description: string }[] = [
  {
    id: "emptyGlow",
    label: "Glow",
    description:
      "A soft glow drifts behind the empty view and follows the pointer. Hidden while the screensaver plays, and when there’s something to play with.",
  },
  {
    id: "screensavers",
    label: "Screensavers",
    description:
      "After a minute without input, a pixel-art scene plays over the empty view. Also in the command palette as “Start screensaver”.",
  },
];

export const DEFAULT_FLAGS: FeatureFlags = { emptyGlow: true, screensavers: true };

export const FLAGS_STORAGE_KEY = "prefs.featureFlags";

/** Saved flags; anything missing or unreadable is its default. */
export function parseFlags(raw: string | null): FeatureFlags {
  let saved: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === "object") saved = parsed as Record<string, unknown>;
  } catch {
    // Fall through to the defaults.
  }
  const flags = { ...DEFAULT_FLAGS };
  for (const id of Object.keys(DEFAULT_FLAGS) as FeatureFlagId[])
    if (typeof saved[id] === "boolean") flags[id] = saved[id];
  return flags;
}

const store = localStore(FLAGS_STORAGE_KEY, parseFlags);

/** Turns a flag on or off, remembers it, and updates everything showing it. */
export function setFeatureFlag(id: FeatureFlagId, on: boolean) {
  store.set({ ...store.get(), [id]: on });
}

/** Every switch back to its default. */
export function resetFeatureFlags() {
  store.reset();
}

/** The flags, re-rendering when one changes. */
export function useFeatureFlags(): FeatureFlags {
  return store.use();
}
