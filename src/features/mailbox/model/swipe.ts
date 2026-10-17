import type { ThreadSummary } from "../../../platform/tauri/bindings";
import type { ThreadAction } from "./threadActions";

/**
 * Swiping a conversation with two fingers on the trackpad (owner's design,
 * 2026-10-17, after iOS 26 notification swipes, in Mailboat's own style):
 *
 * 1. Stretch: the row barely moves; a button "bud" swells out of its end,
 *    joined to it, its icon and label fading in.
 * 2. Break away: the join thins and lets go; the button is its own
 *    capsule. Letting go here leaves it showing, to click.
 * 3. Armed: a little further (not the full width), a ring round the icon
 *    fills; when it closes the capsule takes an accent wash. Letting go
 *    then does the action.
 *
 * Distances are the fingers' travel in pixels. All tunable here.
 */
export const SWIPE = {
  /** The button capsule's full width. */
  capsule: 92,
  /** Where the bud and row start to come apart. */
  joined: 28,
  /** Where they have fully separated (and a release leaves it open). */
  breakAt: 64,
  /** Where letting go does the action. */
  armAt: 128,
  /** Past this the row resists, like a rubber band. */
  maxPull: 170,
  /** Overlap while joined (negative gap) and the gap once apart. */
  overlap: 14,
  gap: 6,
  /** The finger travel a release under this springs back from. */
  openAt: 40,
  /** Spring for settling (stiffness, damping): slightly bouncy. */
  stiffness: 420,
  damping: 26,
} as const;

export type SwipeSide = "left" | "right";

export type SwipePose = {
  /** How far the row (its content and plate) has moved, in px. */
  shift: number;
  /** The bud/capsule's width, from the row's original edge. */
  budWidth: number;
  /** Icon and label opacity, 0–1. */
  label: number;
  /** The ring round the icon, 0–1 (full = armed). */
  ring: number;
  armed: boolean;
};

const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const easeOut = (t: number) => 1 - (1 - t) ** 3;

/** Past `maxPull` each pixel counts for less. */
export function resisted(d: number, s = SWIPE): number {
  return d <= s.maxPull ? d : s.maxPull + (d - s.maxPull) * 0.25;
}

/** The swipe's shape after `d` pixels of travel (0 or more). */
export function swipePose(d: number, s = SWIPE): SwipePose {
  const dd = resisted(Math.max(0, d), s);
  const budWidth = s.capsule * easeOut(clamp(dd / s.breakAt));
  // Overlapping while joined, then a small gap: the bud breaks away.
  const gap = -s.overlap + (s.overlap + s.gap) * smooth(s.joined, s.breakAt, dd);
  // Past the break the row keeps following the fingers, a little slower.
  const shift = Math.max(0, budWidth + gap) + Math.max(0, dd - s.breakAt) * 0.6;
  return {
    shift,
    budWidth,
    label: smooth(s.joined * 0.4, s.breakAt, dd),
    ring: clamp((dd - s.breakAt) / (s.armAt - s.breakAt)),
    armed: dd >= s.armAt,
  };
}

/** Where a released swipe goes: the action, open with its button, or back. */
export function releaseTo(d: number, s = SWIPE): "commit" | "open" | "close" {
  if (resisted(d, s) >= s.armAt) return "commit";
  return d >= s.openAt ? "open" : "close";
}

/** The travel at which an open swipe rests: separated, ring empty. */
export function openRest(s = SWIPE): number {
  return s.breakAt;
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
    axis = Math.abs(dx) > Math.abs(dy) * 1.5 ? "x" : "y";
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
