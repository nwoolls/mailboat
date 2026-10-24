import { useCallback, useEffect, useRef, useState } from "react";
import { events } from "../../../platform/tauri/bindings";
import type { ThreadId, ThreadSummary } from "../../../platform/tauri/bindings";
import { IS_TAURI } from "../../../platform/tauri/ipc";
import {
  feedWheel,
  GESTURE_IDLE_MS,
  NEW_GESTURE,
  openRest,
  releaseTo,
  springStep,
  SWIPE,
  type SwipeSide,
  swipeActions,
  type WheelGesture,
} from "../model/swipe";
import type { ThreadAction } from "../model/threadActions";
import { listPrefs } from "./listPrefs";

/** The row being swiped (or left open), and how far. */
export type SwipeState = {
  id: ThreadId;
  side: SwipeSide;
  /** Finger travel, 0 or more (see `swipePose`). */
  d: number;
  /**
   * Following the fingers, resting open with its button, settling,
   * sliding out after an archive, gone (hidden until the list drops the
   * row, so it never flashes back in place), or gliding back (the row
   * stayed, e.g. archived in All Mail).
   */
  mode: "drag" | "open" | "settle" | "out" | "gone" | "back";
  /** Where this swipe started, if on a row that was already open. */
  from?: number | null;
  /**
   * Pulled past closed the other way within the same swipe: the row moves
   * with the fingers, but that side's button doesn't show (it takes a new
   * swipe), as in Mail and Mimestream. Always springs back on release.
   */
  bare?: boolean;
};

function actionOf(threads: ThreadSummary[], s: SwipeState): ThreadAction | null {
  const t = threads.find((x) => x.id === s.id);
  return t ? swipeActions(t, listPrefs.get())[s.side] : null;
}

/**
 * Archive, Trash and Spam (and their undoing) usually take the row out of
 * the view, so it slides out; read and star leave it, so it springs back.
 */
function movesAway(action: ThreadAction): boolean {
  return action.kind === "archive" || action.kind === "trash" || action.kind === "spam";
}

/** How long a committed archive slides out before it's done. */
const SLIDE_OUT_MS = 140;
/** A row still listed this long after its action stayed in the view. */
const STAYED_MS = 600;
/** How long a row that stayed takes to glide back. */
const BACK_MS = 200;

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
  // A row that slid out is forgotten once the list has dropped it (worked
  // out here, during render, so it never shows again in between).
  if (swipe?.mode === "gone" && !threads.some((t) => t.id === swipe.id)) setSwipe(null);
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
        const step = springStep(
          x,
          v,
          target,
          dt,
          target === 0 ? { stiffness: SWIPE.closeStiffness, damping: SWIPE.closeDamping } : SWIPE,
        );
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
      const to = s.bare ? "close" : releaseTo(s.d, undefined, s.from ?? null);
      const action = actionOf(live.current.threads, s);
      if (to === "commit" && action) {
        if (movesAway(action)) {
          // Slides on out, then goes (the row leaves the list).
          setSwipe({ ...s, mode: "out" });
          window.setTimeout(() => {
            live.current.onAction(s.id, action);
            // Stays hidden until the list drops it (see above).
            setSwipe({ ...s, mode: "gone" });
            window.setTimeout(() => {
              // Still listed: it belongs in this view, so it glides back.
              setSwipe((now) =>
                now?.id === s.id && now.mode === "gone" ? { ...s, d: 0, mode: "back" } : now,
              );
              window.setTimeout(
                () => setSwipe((now) => (now?.id === s.id && now.mode === "back" ? null : now)),
                BACK_MS,
              );
            }, STAYED_MS);
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
    let resumedFrom: number | null = null;
    let idle = 0;
    let ended = false;
    // macOS says when fingers touch and lift (src-tauri/src/trackpad.rs).
    // Once heard from, only a lift lets go: holding still, or swiping back
    // while still touching, never acts. A mouse wheel never reports, so
    // there the old guess (events stop, or coasting) still applies.
    let reported = false;
    let touching = false;

    const finish = () => {
      const s = live.current.swipe;
      if (s && s.mode === "drag") release(s);
    };
    const reset = () => {
      gesture = NEW_GESTURE;
      row = null;
      ended = false;
    };
    // Quiet for a moment: the gesture is over (unless fingers are still
    // down, holding). Coasting after a lift keeps it going until it stops.
    const resetWhenQuiet = () => {
      window.clearTimeout(idle);
      idle = window.setTimeout(() => {
        if (reported && touching) return;
        if (!ended) finish();
        reset();
      }, GESTURE_IDLE_MS);
    };
    const onWheel = (e: WheelEvent) => {
      // On a trackpad, a new swipe only begins with fingers on it. After a
      // quick flick macOS keeps sending "coasting" events once they lift;
      // after a pause in those, they used to start a fresh swipe on
      // whatever row had moved under the pointer (the next one, once the
      // swiped row left), which then archived itself (owner report,
      // 2026-10-19). Coasting can finish a swipe, never start one.
      if (gesture === NEW_GESTURE && reported && !touching) return;
      resetWhenQuiet();
      if (gesture === NEW_GESTURE) {
        const el = (e.target as Element).closest<HTMLElement>("[data-thread-id]");
        row = el ? Number(el.dataset.threadId) : null;
        // Swiping an open row again carries on from where it rests.
        const open = live.current.swipe;
        const resuming = open && open.id === row && open.mode !== "drag";
        start = resuming ? (open.side === "left" ? 1 : -1) * open.d : 0;
        resumedFrom = resuming ? open.d : null;
        side = resuming ? open.side : null;
      }
      gesture = feedWheel(gesture, e.deltaX, e.deltaY, !reported);
      if (gesture.axis === "y") {
        // Scrolling the list closes an open row.
        if (live.current.swipe?.mode === "open") close();
        return;
      }
      if (gesture.axis !== "x" || row === null) return;
      // Sideways: ours, not the page's (or a back/forward gesture).
      e.preventDefault();
      if (ended) return;
      if (gesture.released && !reported) {
        ended = true;
        finish();
        return;
      }
      const total = start + gesture.dx;
      if (side === null) {
        if (total === 0) return;
        side = total > 0 ? "left" : "right";
      }
      const signed = (side === "left" ? 1 : -1) * total;
      cancelAnimationFrame(frame.current);
      if (signed < 0) {
        // Past closed, the other way: the row follows, no button.
        const other: SwipeSide = side === "left" ? "right" : "left";
        setSwipe({ id: row, side: other, d: -signed, mode: "drag", bare: true });
        return;
      }
      const t = live.current.threads.find((x) => x.id === row);
      const can = t ? swipeActions(t, listPrefs.get())[side] !== null : false;
      // A side with nothing to do barely gives.
      const d = can ? signed : Math.min(12, signed * 0.15);
      setSwipe({ id: row, side, d, mode: "drag", from: resumedFrom });
    };
    // A click anywhere but the open row's button closes it.
    const onPointerDown = (e: PointerEvent) => {
      if (!(e.target as Element).closest("[data-swipe-button]")) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && live.current.swipe?.mode === "open") close();
    };
    const lifted = IS_TAURI
      ? events.trackpadEvent.listen((e) => {
          reported = true;
          touching = e.payload.touching;
          if (touching) {
            // A new touch is a new gesture (it also stops any coasting).
            window.clearTimeout(idle);
            reset();
            return;
          }
          if (!ended) finish();
          ended = true;
          resetWhenQuiet();
        })
      : null;
    list.addEventListener("wheel", onWheel, { passive: false });
    list.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      void lifted?.then((stop) => stop());
      window.clearTimeout(idle);
      list.removeEventListener("wheel", onWheel);
      list.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [list, release, close]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  return { swipe, commit };
}
