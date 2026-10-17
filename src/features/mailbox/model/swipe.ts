import type { ThreadSummary } from "../../../platform/tauri/bindings";
import type { ThreadAction } from "./threadActions";

/**
 * Swiping a conversation with two fingers on the trackpad (owner's design,
 * 2026-10-17, after iOS 26 notification swipes, in Mailboat's own style):
 *
 * 0. A little resistance first: the first few pixels barely give.
 * 1. Stretch: the row follows the fingers one to one, uncovering a button
 *    of fixed width under its end, same height and corners as the row.
 *    Until it's fully uncovered the two are one shape (no corners between
 *    them), so it looks like the row growing. Icon and word fade in.
 * 2. Break away: once its inner corners would come into view they split
 *    from the row (the goo blur necks, then lets go at ~7px) and the
 *    button springs a little. Letting go here leaves it showing, to click.
 * 3. Armed: a little further, a ring round the icon fills; when it closes
 *    the button takes an accent wash. Letting go then does the action.
 *
 * Distances are pixels of finger travel; `shift` is how far the row has
 * moved. All tunable here.
 */
export const SWIPE = {
  /** Finger travel that barely moves the row before the swipe takes. */
  deadZone: 12,
  /** How much the row gives within the dead zone (fraction). */
  deadGive: 0.25,
  /** The button's width (room for icon, word and padding). */
  capsule: 104,
  /** The gap once button and row have separated (the blur lets go ~7px). */
  apart: 10,
  /** Row travel past separation at which letting go does the action. */
  armAfter: 72,
  /** Past this row travel, each pixel counts for less (rubber band). */
  maxPull: 200,
  /** Row travel under which a release springs back instead of opening. */
  openAt: 48,
  /** Spring for settling (stiffness, damping): slightly bouncy. */
  stiffness: 420,
  damping: 26,
} as const;

export type SwipeSide = "left" | "right";

export type SwipePose = {
  /** How far the row (its content and plate) has moved, in px. */
  shift: number;
  /** How much of the button is uncovered, from the row's original edge. */
  budWidth: number;
  /** Not yet fully uncovered: button and row are drawn as one shape. */
  joined: boolean;
  /** Clearly apart (past where the join lets go). */
  separated: boolean;
  /** Icon and label opacity, 0–1. */
  label: number;
  /** The ring round the icon, 0–1 (full = armed). */
  ring: number;
  armed: boolean;
};

/** The gap at which the goo blur lets go of the join (see SwipeLayers). */
export const SNAP_GAP = 7;

const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Row travel for `d` of finger travel: resisting at first, then 1:1, then rubbery. */
export function rowShift(d: number, s = SWIPE): number {
  const x = Math.max(0, d);
  const held = Math.min(x, s.deadZone) * s.deadGive;
  const free = held + Math.max(0, x - s.deadZone);
  return free <= s.maxPull ? free : s.maxPull + (free - s.maxPull) * 0.25;
}

/** Row travel at which letting go does the action. */
export function armShift(s = SWIPE): number {
  return s.capsule + s.apart + s.armAfter;
}

/** The swipe's shape after `d` pixels of finger travel (0 or more). */
export function swipePose(d: number, s = SWIPE): SwipePose {
  const shift = rowShift(d, s);
  const separated = s.capsule + s.apart;
  return {
    shift,
    budWidth: Math.min(shift, s.capsule),
    joined: shift < s.capsule,
    separated: shift - s.capsule >= SNAP_GAP,
    label: smooth(s.capsule * 0.35, s.capsule, shift),
    ring: clamp((shift - separated) / s.armAfter),
    armed: shift >= armShift(s),
  };
}

/** Where a released swipe goes: the action, open with its button, or back. */
export function releaseTo(d: number, s = SWIPE): "commit" | "open" | "close" {
  const shift = rowShift(d, s);
  if (shift >= armShift(s)) return "commit";
  return shift >= s.openAt ? "open" : "close";
}

/** The finger travel at which an open swipe rests: separated, ring empty. */
export function openRest(s = SWIPE): number {
  return s.deadZone + (s.capsule + s.apart - s.deadZone * s.deadGive);
}

/** One step of a damped spring towards `target` (dt in seconds). */
export function springStep(
  x: number,
  v: number,
  target: number,
  dt: number,
  s: { stiffness: number; damping: number } = SWIPE,
): { x: number; v: number; done: boolean } {
  const a = -s.stiffness * (x - target) - s.damping * v;
  const nv = v + a * dt;
  const nx = x + nv * dt;
  const done = Math.abs(nx - target) < 0.5 && Math.abs(nv) < 5;
  return done ? { x: target, v: 0, done } : { x: nx, v: nv, done };
}

/**
 * Reading a two-finger swipe from wheel events. Browsers don't say when
 * the fingers lift, so a release is inferred: the events stop, or they
 * turn into macOS's coasting (momentum), a smooth decay that's ignored
 * until it ends so it can't carry the swipe on.
 */
export type WheelGesture = {
  /** Locked on the first clear movement: sideways swipes, or scrolling. */
  axis: "x" | "y" | null;
  /** Total sideways travel: positive is fingers moving left. */
  dx: number;
  /** Recent sideways deltas, newest last, for spotting coasting. */
  recent: number[];
  /** Released (coasting or stopped); later events are ignored. */
  released: boolean;
};

export const NEW_GESTURE: WheelGesture = { axis: null, dx: 0, recent: [], released: false };

/** No events for this long ends a gesture. */
export const GESTURE_IDLE_MS = 110;

export function feedWheel(g: WheelGesture, dx: number, dy: number): WheelGesture {
  if (g.released) return g;
  let axis = g.axis;
  if (axis === null) {
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return g;
    axis = Math.abs(dx) > Math.abs(dy) * 2 ? "x" : "y";
  }
  if (axis === "y") return { ...g, axis };
  const recent = [...g.recent, dx].slice(-4);
  return { axis, dx: g.dx + dx, recent, released: isCoasting(recent) };
}

/**
 * Four deltas the same way, each a little smaller than the last: the
 * steady decay of momentum, not a hand slowing (which is uneven).
 */
export function isCoasting(recent: number[]): boolean {
  if (recent.length < 4) return false;
  for (let i = 1; i < recent.length; i++) {
    const prev = recent[i - 1]!;
    const cur = recent[i]!;
    if (Math.sign(prev) !== Math.sign(cur) || cur === 0) return false;
    const ratio = Math.abs(cur) / Math.abs(prev);
    if (ratio < 0.75 || ratio > 0.98) return false;
  }
  return true;
}

/**
 * What each side does to a conversation: left archives (or, where
 * archiving doesn't apply, trashes); right toggles read. Nothing to the
 * left in Trash.
 */
export function swipeActions(
  t: Pick<ThreadSummary, "unread" | "inInbox" | "inTrash">,
): Record<SwipeSide, ThreadAction | null> {
  return {
    left: t.inInbox
      ? { kind: "archive", archived: true }
      : t.inTrash
        ? null
        : { kind: "trash", trashed: true },
    right: { kind: "read", read: t.unread },
  };
}

/** The button's word: short, to fit the capsule. */
export function swipeLabel(action: ThreadAction): string {
  switch (action.kind) {
    case "archive":
      return action.archived ? "Archive" : "Inbox";
    case "trash":
      return action.trashed ? "Trash" : "Restore";
    case "read":
      return action.read ? "Read" : "Unread";
    default:
      return "";
  }
}
