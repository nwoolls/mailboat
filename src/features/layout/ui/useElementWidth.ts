import { useEffect, useState } from "react";

/**
 * Measures an element's width in CSS pixels and keeps it up to date as it
 * resizes. Returns a ref callback to put on the element. A callback (not a
 * ref object) so measuring starts whenever the element appears: the panes
 * only mount once accounts have loaded, after the first render.
 */
export function useElementWidth<T extends HTMLElement>(): [(el: T | null) => void, number] {
  const [el, setEl] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return [setEl, width];
}
