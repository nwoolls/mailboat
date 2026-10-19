import { useEffect, useRef, useState } from "react";

/**
 * Whether a sticky foot is stuck over content right now. Put the returned
 * ref on an empty marker just after the foot: while the marker is below
 * the bottom of the scroll area (`.reader-scroll`), the foot is pinned
 * there covering something; scrolled to the end, it isn't.
 */
export function useStuck() {
  const marker = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = marker.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.rootBounds) return;
        setStuck(!entry.isIntersecting && entry.boundingClientRect.top >= entry.rootBounds.bottom);
      },
      // A pixel of slack, so being scrolled exactly to the end counts as seen.
      { root: el.closest(".reader-scroll"), rootMargin: "0px 0px 1px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [marker, stuck] as const;
}
