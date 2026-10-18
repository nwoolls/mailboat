import { useSyncExternalStore } from "react";

/**
 * Feature flags: switches for features still being tried, in Settings →
 * Advanced. Window-only, so they live in the web view's storage like the
 * appearance settings, and every part of the window sees a change at once.
 */
export type FeatureFlags = {
  /** The soft glow drifting behind an empty list, drawn to the pointer. */
  emptyGlow: boolean;
  /** The sandscape screensaver over an empty list. */
  sandscape: boolean;
};

export type FeatureFlagId = keyof FeatureFlags;

/** What Settings lists, in order. */
export const FEATURE_FLAGS: readonly { id: FeatureFlagId; label: string; description: string }[] = [
  {
    id: "emptyGlow",
    label: "Empty list glow",
    description:
      "A soft glow drifts behind an empty list and follows the pointer. Hidden while the screensaver plays.",
  },
  {
    id: "sandscape",
    label: "Sandscape screensaver",
    description:
      "After a minute without input, layered sand trickles over an empty list. Also in ⌘K as “Start screensaver”.",
  },
];

export const DEFAULT_FLAGS: FeatureFlags = { emptyGlow: true, sandscape: true };

export const FLAGS_STORAGE_KEY = "mailboat.featureFlags";

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

let current: FeatureFlags | null = null;
const listeners = new Set<() => void>();

function snapshot(): FeatureFlags {
  current ??= parseFlags(localStorage.getItem(FLAGS_STORAGE_KEY));
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Turns a flag on or off, remembers it, and updates everything showing it. */
export function setFeatureFlag(id: FeatureFlagId, on: boolean) {
  current = { ...snapshot(), [id]: on };
  localStorage.setItem(FLAGS_STORAGE_KEY, JSON.stringify(current));
  for (const listener of listeners) listener();
}

/** The flags, re-rendering when one changes. */
export function useFeatureFlags(): FeatureFlags {
  return useSyncExternalStore(subscribe, snapshot);
}
