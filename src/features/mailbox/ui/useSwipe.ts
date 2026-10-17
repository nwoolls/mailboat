import { useCallback, useEffect, useRef, useState } from "react";
import type { ThreadId, ThreadSummary } from "../../../platform/tauri/bindings";
import {
  feedWheel,
  GESTURE_IDLE_MS,
  NEW_GESTURE,
  openRest,
  releaseTo,
  springStep,
  type SwipeSide,
  swipeActions,
  type WheelGesture,
} from "../model/swipe";
import type { ThreadAction } from "../model/threadActions";

/** The row being swiped (or left open), and how far. */
export type SwipeState = {
  id: ThreadId;
  side: SwipeSide;
  /** Finger travel, 0 or more (see `swipePose`). */
  d: number;
  /**
   * Following the fingers, resting open with its button, settling, or
   * sliding out after an archive.
   */
  mode: "drag" | "open" | "settle" | "out";
};

function actionOf(threads: ThreadSummary[], s: SwipeState): ThreadAction | null {
  const t = threads.find((x) => x.id === s.id);
  return t ? swipeActions(t)[s.side] : null;
}

/** How long a committed archive slides out before it's done. */
const SLIDE_OUT_MS = 140;

/**
 * Two-finger swipes on the list's rows (see `model/swipe.ts`): reads the
 * trackpad's wheel events on `list`, animates, and does the action.
 */
export function useSwipe(
  list: HTMLElement | null,
  threads: ThreadSummary[],
  onAction: (id: ThreadId, action: ThreadAction) => void,
) {
  const [swipe, setSwipe] = useState<SwipeState | null>(null);
  // Read inside event handlers, which outlive renders.
  const live = useRef({ swipe, threads, onAction });
  useEffect(() => {
    live.current = { swipe, threads, onAction };
  });
  const frame = useRef(0);

  const animate = useCallback(
    (from: SwipeState, target: number, done: (s: SwipeState) => SwipeState | null) => {
      cancelAnimationFrame(frame.current);
      let x = from.d;
      let v = 0;
      let last = performance.now();
      const tick = (now: number) => {
        const dt = Math.min(0.032, (now - last) / 1000);
        last = now;
        const step = springStep(x, v, target, dt);
        x = step.x;
        v = step.v;
        if (step.done) {
          setSwipe(done({ ...from, d: target }));
          return;
        }
        setSwipe({ ...from, d: x, mode: "settle" });
        frame.current = requestAnimationFrame(tick);
      };
      frame.current = requestAnimationFrame(tick);
    },
    [],
  );

  /** Lets go: does the action, rests open, or springs back. */
  const release = useCallback(
    (s: SwipeState) => {
      const to = releaseTo(s.d);
      const action = actionOf(live.current.threads, s);
      if (to === "commit" && action) {
        if (s.side === "left") {
          // Slides on out, then goes (the row leaves the list).
          setSwipe({ ...s, mode: "out" });
          window.setTimeout(() => {
            live.current.onAction(s.id, action);
            setSwipe(null);
          }, SLIDE_OUT_MS);
        } else {
          live.current.onAction(s.id, action);
          animate(s, 0, () => null);
        }
        return;
      }
      if (to === "open") animate(s, openRest(), (r) => ({ ...r, mode: "open" }));
      else animate(s, 0, () => null);
    },
    [animate],
  );

  /** Closes an open (or settling) row. */
  const close = useCallback(() => {
    const s = live.current.swipe;
    if (s && s.mode !== "drag") animate(s, 0, () => null);
  }, [animate]);

  /** The open row's button was clicked. */
  const commit = useCallback(() => {
    const s = live.current.swipe;
    if (s) release({ ...s, d: 10_000 });
  }, [release]);

  useEffect(() => {
    if (!list) return;
    let gesture: WheelGesture = NEW_GESTURE;
    let row: ThreadId | null = null;
    let start = 0;
    // One side per gesture: set by its first movement (or the open row's
    // side). Swiping back past closed stops there, as in Mimestream: the
    // other side needs a new swipe.
    let side: SwipeSide | null = null;
    let idle = 0;
    let ended = false;

    const finish = () => {
      const s = live.current.swipe;
      if (s && s.mode === "drag") release(s);
    };
    const onWheel = (e: WheelEvent) => {
      window.clearTimeout(idle);
      idle = window.setTimeout(() => {
        if (!ended) finish();
        gesture = NEW_GESTURE;
        row = null;
        ended = false;
      }, GESTURE_IDLE_MS);
      if (gesture === NEW_GESTURE) {
        const el = (e.target as Element).closest<HTMLElement>("[data-thread-id]");
        row = el ? Number(el.dataset.threadId) : null;
        // Swiping an open row again carries on from where it rests.
        const open = live.current.swipe;
        const resuming = open && open.id === row && open.mode !== "drag";
        start = resuming ? (open.side === "left" ? 1 : -1) * open.d : 0;
        side = resuming ? open.side : null;
      }
      gesture = feedWheel(gesture, e.deltaX, e.deltaY);
      if (gesture.axis === "y") {
        // Scrolling the list closes an open row.
        if (live.current.swipe?.mode === "open") close();
        return;
      }
      if (gesture.axis !== "x" || row === null) return;
      // Sideways: ours, not the page's (or a back/forward gesture).
      e.preventDefault();
      if (ended) return;
      if (gesture.released) {
        ended = true;
        finish();
        return;
      }
      const total = start + gesture.dx;
      if (side === null) {
        if (total === 0) return;
        side = total > 0 ? "left" : "right";
      }
      const travel = Math.max(0, (side === "left" ? 1 : -1) * total);
      const t = live.current.threads.find((x) => x.id === row);
      const can = t ? swipeActions(t)[side] !== null : false;
      cancelAnimationFrame(frame.current);
      // A side with nothing to do barely gives.
      const d = can ? travel : Math.min(12, travel * 0.15);
      setSwipe({ id: row, side, d, mode: "drag" });
    };
    // A click anywhere but the open row's button closes it.
    const onPointerDown = (e: PointerEvent) => {
      if (!(e.target as Element).closest("[data-swipe-button]")) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && live.current.swipe?.mode === "open") close();
    };
    list.addEventListener("wheel", onWheel, { passive: false });
    list.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(idle);
      list.removeEventListener("wheel", onWheel);
      list.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [list, release, close]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  return { swipe, commit };
}
