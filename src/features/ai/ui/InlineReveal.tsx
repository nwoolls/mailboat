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
    // Every frame of the animation (a resize alone can miss the last one),
    // until the panel's own animation has really finished. A timer alone
    // ended the correction too soon on a slow machine, where the page can
    // stall and paint the end of the animation late: the reply then stayed
    // where the last painted frame had left it.
    let ticks = 0;
    let finished = 0;
    let frame = requestAnimationFrame(function tick() {
      hold();
      ticks += 1;
      // A few frames of grace for the animation to start; then two frames
      // with nothing running.
      finished = ticks > 3 && el.getAnimations().length === 0 ? finished + 1 : 0;
      if (finished < 2) frame = requestAnimationFrame(tick);
    });
    // A backstop, before ReplyArea removes the panel.
    const stop = window.setTimeout(() => cancelAnimationFrame(frame), REVEAL_PRESENT_MS - 100);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(stop);
    };
  }, [open]);
  return (
    // inert while it closes: it stays drawn for a moment, but can't be used.
    <div ref={ref} className="inline-reveal grid" data-open={open || undefined} inert={!open}>
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

/** `.inline-reveal`'s duration in index.css. */
export const REVEAL_MS = 180;

/**
 * How long a closing panel stays drawn: well past its animation, since a
 * slow machine can paint the animation late (and the reply is only held
 * in place while the panel is there).
 */
export const REVEAL_PRESENT_MS = 800;
