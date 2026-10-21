import { useLayoutEffect, useRef } from "react";

/**
 * The writing assistant above an inline reply, growing open and shrinking
 * closed quickly. The reader scrolls by the same amount each frame, so the
 * reply being written stays where it is and the conversation above moves
 * up instead (nothing is pushed below the fold).
 */
export function InlineReveal({ open, children }: { open: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const scroller = el?.closest(".reader-scroll");
    if (!el || !scroller) return;
    let height = el.getBoundingClientRect().height;
    const observer = new ResizeObserver(() => {
      const next = el.getBoundingClientRect().height;
      scroller.scrollTop += next - height;
      height = next;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className="inline-reveal grid" data-open={open || undefined}>
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}
