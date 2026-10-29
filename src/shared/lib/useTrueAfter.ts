import { useEffect, useState } from "react";

/** True once `active` has stayed true for `ms`; false again as soon as it isn't. */
export function useTrueAfter(active: boolean, ms: number): boolean {
  const [elapsed, setElapsed] = useState(false);
  // Reset during render when activity stops, rather than in an effect.
  if (!active && elapsed) setElapsed(false);
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setElapsed(true), ms);
    return () => clearTimeout(timer);
  }, [active, ms]);
  return active && elapsed;
}
