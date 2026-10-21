import { useEffect, useState } from "react";

/**
 * Whether something that animates away should still be drawn: true while
 * `open`, and for `ms` after it closes, so its closing animation can play
 * before it's removed.
 */
export function usePresence(open: boolean, ms: number): boolean {
  const [shown, setShown] = useState(open);
  // Opening shows it at once (derived during render, not in an effect).
  if (open && !shown) setShown(true);
  useEffect(() => {
    if (open || !shown) return;
    const timer = window.setTimeout(() => setShown(false), ms);
    return () => window.clearTimeout(timer);
  }, [open, shown, ms]);
  return shown;
}
