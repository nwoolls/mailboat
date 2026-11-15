import { useEffect, useRef, useState } from "react";

/**
 * Whether a sticky bar is stuck over content right now, in the reader's
 * scroll area (`.reader-scroll`). Put the returned ref on an empty marker
 * on the bar's open side: just after a foot (`edge` "bottom"), or just
 * before a header (`edge` "top"). While the marker is out of view past
 * that edge, the bar is pinned there covering something; scrolled to the
 * end (or the top), it isn't.
 */
export function useStuck(edge: "top" | "bottom" = "bottom") {
  const marker = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = marker.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.rootBounds) return;
        const past =
          edge === "bottom"
            ? entry.boundingClientRect.top >= entry.rootBounds.bottom
            : entry.boundingClientRect.bottom <= entry.rootBounds.top;
        setStuck(!entry.isIntersecting && past);
      },
      // A pixel of slack, so being scrolled exactly to the end counts as seen.
      {
        root: el.closest(".reader-scroll"),
        rootMargin: edge === "bottom" ? "0px 0px 1px 0px" : "1px 0px 0px 0px",
      },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [edge]);
  return [marker, stuck] as const;
}
