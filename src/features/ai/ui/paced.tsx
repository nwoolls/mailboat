import { useEffect, useRef, useState } from "react";
import { drainRate, nextShown, sharedStart, streamRate, wordCut, words } from "../model/pace";

function reducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

/**
 * The part of an answer to show now, let out at an even pace (see
 * `model/pace`) a whole word at a time. `done` is true once the whole
 * answer is in: the rest then shows within about a second, and
 * `onCaughtUp` is called once all of it is on screen. Text that is
 * already complete when this first renders (a summary from the cache)
 * shows at once, and so does everything with reduced motion.
 */
export function usePacedText(text: string, done: boolean, onCaughtUp?: () => void): string {
  const [cut, setCut] = useState(() => (done ? text.length : 0));
  const live = useRef({
    text,
    done,
    shown: done ? text.length : 0,
    /** Where the shown text ends (`cut`, kept here for the next frame). */
    cut: done ? text.length : 0,
    last: null as number | null,
    /** The pace set when the whole answer came in. */
    drain: null as number | null,
    frame: 0,
    reported: false,
    onCaughtUp,
  });

  useEffect(() => {
    const l = live.current;
    // Replaced rather than continued (a new summary over the old one): only
    // what both begin with stays shown.
    if (!text.startsWith(l.text)) {
      l.shown = Math.min(l.shown, sharedStart(l.text, text));
      l.cut = Math.min(l.cut, l.shown);
    }
    l.text = text;
    if (!done) {
      l.reported = false;
      l.drain = null;
    }
    l.done = done;
    l.onCaughtUp = onCaughtUp;
    if (l.frame) return;
    const instant = reducedMotion();
    const tick = (t: number) => {
      const dt = l.last === null ? 0 : Math.min(0.05, (t - l.last) / 1000);
      l.last = t;
      const behind = l.text.length - l.shown;
      if (l.done) l.drain ??= drainRate(behind);
      l.shown = instant
        ? l.text.length
        : nextShown(l.shown, l.text.length, l.drain ?? streamRate(behind), dt);
      // A word already on screen stays while the text only continues (asked
      // again, the summary shown isn't trimmed back to its last whole word).
      l.cut = Math.max(l.cut, wordCut(l.text, l.shown, l.done));
      setCut(l.cut);
      if (l.shown >= l.text.length) {
        l.frame = 0;
        l.last = null;
        if (l.done && !l.reported) {
          l.reported = true;
          l.onCaughtUp?.();
        }
        return;
      }
      l.frame = requestAnimationFrame(tick);
    };
    l.frame = requestAnimationFrame(tick);
  }, [text, done, onCaughtUp]);

  useEffect(() => {
    const l = live.current;
    return () => {
      cancelAnimationFrame(l.frame);
      l.frame = 0;
    };
  }, []);

  return text.slice(0, cut);
}

/**
 * Text whose words fade in as they're added. Each word keeps its element
 * as more arrive, so only the new ones animate.
 */
export function FadeWords({ text }: { text: string }) {
  return (
    <>
      {words(text).map((w, i) =>
        /^\s/.test(w) ? (
          w
        ) : (
          // oxlint-disable-next-line react/no-array-index-key -- a word's place is its identity: the text only grows
          <span key={i} className="ai-word">
            {w}
          </span>
        ),
      )}
    </>
  );
}

/** The ✦ while AI is working: the large star turns a quarter, the small one twinkles. */
export function ThinkingSparkle({
  size = 14,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={`ai-sparkle shrink-0 overflow-visible ${className}`}
    >
      <path
        className="ai-sparkle-big"
        d="M15 2L15.5387 4.39157C15.9957 6.42015 17.5798 8.00431 19.6084 8.46127L22 9L19.6084 9.53873C17.5798 9.99569 15.9957 11.5798 15.5387 13.6084L15 16L14.4613 13.6084C14.0043 11.5798 12.4202 9.99569 10.3916 9.53873L8 9L10.3916 8.46127C12.4201 8.00431 14.0043 6.42015 14.4613 4.39158L15 2Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <path
        className="ai-sparkle-small"
        d="M7 12L7.38481 13.7083C7.71121 15.1572 8.84275 16.2888 10.2917 16.6152L12 17L10.2917 17.3848C8.84275 17.7112 7.71121 18.8427 7.38481 20.2917L7 22L6.61519 20.2917C6.28879 18.8427 5.15725 17.7112 3.70827 17.3848L2 17L3.70827 16.6152C5.15725 16.2888 6.28879 15.1573 6.61519 13.7083L7 12Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

/** A label with a light sweeping across it ("Writing…"), for while AI works. */
export function Shimmer({ children }: { children: React.ReactNode }) {
  return <span className="ai-shimmer">{children}</span>;
}
