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
    holdReply(el, scroller, reply, open);
    // Nothing to undo here: the hold belongs to the reply, not to this
    // panel. A panel removed while closing (ReplyArea's timer can come
    // before the frames a stall held up) leaves its hold to finish, and the
    // next hold on the reply (opening or closing again, or React running
    // this effect twice in development) takes over from it.
  }, [open]);
  return (
    // inert while it closes: it stays drawn for a moment, but can't be used.
    <div ref={ref} className="inline-reveal grid" data-open={open || undefined} inert={!open}>
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

/** A reply being held in place: where its top belongs, and how to stop. */
type Hold = { where: number; stop: () => void };

/** The hold on each reply, at most one: a new one takes over the old one's place. */
const holds = new WeakMap<Element, Hold>();

/** Ways a person scrolls the reader, which end a hold rather than being undone by it. */
const BY_HAND = ["wheel", "touchstart"] as const;

function holdReply(panel: HTMLElement, scroller: Element, reply: Element, open: boolean): void {
  const prior = holds.get(reply);
  prior?.stop();
  // A hold still going (the panel reopened before the last one's frames
  // came) keeps its place: the reply is still on its way back to it.
  let where = prior?.where;
  if (where === undefined) {
    const view = scroller.getBoundingClientRect();
    const top = reply.getBoundingClientRect().top;
    if (top < view.top || top > view.bottom) return;
    // Opening, where it was before the panel took any room (in case the
    // panel already has some height by now).
    where = top - (open ? panel.getBoundingClientRect().height : 0);
  }
  const at = where;
  // Every frame of the animation (a resize alone can miss the last one),
  // until the panel's own animation has really finished. Counted in
  // frames, never by the clock: on a slow machine the page can stall past
  // any timer and paint the end of the animation late, and a hold ended by
  // a timer (or by the panel's removal) left the reply where the last
  // painted frame had put it (a 700ms stall: 1 to 194px off).
  let ticks = 0;
  let finished = 0;
  let frame = 0;
  const stop = () => {
    cancelAnimationFrame(frame);
    for (const type of BY_HAND) window.removeEventListener(type, stop, { capture: true });
    if (holds.get(reply) === hold) holds.delete(reply);
  };
  const hold: Hold = { where: at, stop };
  holds.set(reply, hold);
  for (const type of BY_HAND) window.addEventListener(type, stop, { capture: true });
  const tick = () => {
    // The reply gone (sent, or the conversation changed): nothing to hold.
    if (!reply.isConnected || !scroller.isConnected) return stop();
    scroller.scrollTop += reply.getBoundingClientRect().top - at;
    ticks += 1;
    // A few frames of grace for the animation to start; then two frames
    // with nothing running (a removed panel has none). A backstop in
    // frames, which a stall doesn't use up.
    finished = ticks > 3 && panel.getAnimations().length === 0 ? finished + 1 : 0;
    if (finished < 2 && ticks < HOLD_MAX_FRAMES) frame = requestAnimationFrame(tick);
    else stop();
  };
  frame = requestAnimationFrame(tick);
}

/** The most frames a hold lasts, well past `.inline-reveal`'s 180ms at any refresh rate. */
const HOLD_MAX_FRAMES = 120;

/** `.inline-reveal`'s duration in index.css. */
export const REVEAL_MS = 180;

/**
 * How long a closing panel stays drawn: well past its animation, since a
 * slow machine can paint the animation late. Removed before that is
 * painted, the hold still finishes (`holdReply`).
 */
export const REVEAL_PRESENT_MS = 800;
