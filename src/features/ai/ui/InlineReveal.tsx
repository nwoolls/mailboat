import { useLayoutEffect, useRef } from "react";

/**
 * The writing assistant above an inline reply, growing open and shrinking
 * closed quickly. The reply below it (the next element) is held where it
 * was on screen: each frame the reader scrolls so the reply's top is back
 * where it started, so the conversation above moves instead and nothing
 * is pushed below the fold. Measured against the reply itself, not added
 * up from size changes, which drifted (the browser also scrolls on its
 * own when content shrinks at the bottom).
 *
 * Only while the reply is on screen. Opening together with the reply
 * (Reply with AI), the reply is still below the fold being scrolled into
 * view, and holding it there pinned it out of sight.
 */
export function InlineReveal({ open, children }: { open: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const scroller = el?.closest(".reader-scroll");
    const reply = el?.nextElementSibling;
    if (!el || !scroller || !reply) return;
    const view = scroller.getBoundingClientRect();
    const top = reply.getBoundingClientRect().top;
    if (top < view.top || top > view.bottom) return;
    // Opening, where it was before the panel took any room (in case the
    // panel already has some height by now).
    const where =
      reply.getBoundingClientRect().top - (open ? el.getBoundingClientRect().height : 0);
    const hold = () => {
      scroller.scrollTop += reply.getBoundingClientRect().top - where;
    };
    // Every frame of the animation (a resize alone can miss the last one).
    let frame = requestAnimationFrame(function tick() {
      hold();
      frame = requestAnimationFrame(tick);
    });
    // Until the panel would be gone (ReplyArea keeps it REVEAL_MS + 100).
    const stop = window.setTimeout(() => cancelAnimationFrame(frame), REVEAL_MS + 100);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(stop);
    };
  }, [open]);
  return (
    <div ref={ref} className="inline-reveal grid" data-open={open || undefined}>
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

/** `.inline-reveal`'s duration in index.css. */
export const REVEAL_MS = 180;
