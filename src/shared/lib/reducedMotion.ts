import { useSyncExternalStore } from "react";

const REDUCE = "(prefers-reduced-motion: reduce)";

/** Whether the system asks for less motion, following it as it changes. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(REDUCE);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(REDUCE).matches,
  );
}
