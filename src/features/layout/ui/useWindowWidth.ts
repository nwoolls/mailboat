import { useSyncExternalStore } from "react";

function subscribe(changed: () => void) {
  window.addEventListener("resize", changed);
  return () => window.removeEventListener("resize", changed);
}

/** The window's width in CSS pixels, kept current as it resizes. */
export function useWindowWidth(): number {
  return useSyncExternalStore(subscribe, () => window.innerWidth);
}
