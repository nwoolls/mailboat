import { useSyncExternalStore } from "react";

/**
 * A setting kept in the web view's storage, shared by every part of the
 * window: `use()` re-renders when it changes, `set()` changes and saves it.
 * For window-only settings (feature flags, screensaver choices); anything
 * Rust needs lives in SQLite instead.
 */
export function localStore<T>(key: string, parse: (raw: string | null) => T) {
  let current: T | null = null;
  const listeners = new Set<() => void>();
  const get = (): T => {
    current ??= parse(localStorage.getItem(key));
    return current;
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const set = (next: T) => {
    current = next;
    localStorage.setItem(key, JSON.stringify(next));
    for (const listener of listeners) listener();
  };
  return {
    get,
    set,
    /** Back to its default (what an empty store reads as). */
    reset() {
      set(parse(null));
    },
    use(): T {
      return useSyncExternalStore(subscribe, get);
    },
  };
}
