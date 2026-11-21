/// <reference types="node" />
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  feedWheel,
  GOO_REACH,
  isCoasting,
  NEW_GESTURE,
  openRest,
  releaseTo,
  SNAP_GAP,
  springStep,
  SWIPE,
  swipeActions,
  swipeLabel,
  swipePose,
} from "./swipe";

describe("swipe pose", () => {
  it("resists a little before it takes", () => {
    expect(swipePose(SWIPE.deadZone).shift).toBeLessThan(SWIPE.deadZone / 2);
  });

  it("then follows the fingers one to one, uncovering the button as one shape", () => {
    const a = swipePose(40);
    const b = swipePose(50);
    expect(b.shift - a.shift).toBeCloseTo(10);
    expect(a.budWidth).toBe(a.shift);
    expect([a.joined, a.separated]).toEqual([true, false]);
  });

  it("stops the button at its width, then the gap opens and it stands apart", () => {
    const p = swipePose(openRest());
    expect(p.budWidth).toBe(SWIPE.capsule);
    expect(p.shift - p.budWidth).toBeCloseTo(SWIPE.apart);
    expect([p.label, p.ring, p.armed]).toEqual([1, 0, false]);
    expect([p.joined, p.separated]).toEqual([false, true]);
  });

  it("keeps the ring empty just past revealing the button", () => {
    expect(swipePose(openRest() + SWIPE.ringAfter).ring).toBe(0);
    expect(swipePose(openRest() + SWIPE.ringAfter + 10).ring).toBeGreaterThan(0);
  });

  it("arms a little further on, with the ring full", () => {
    const at = openRest() + SWIPE.armAfter;
    expect(swipePose(at - 1).armed).toBe(false);
    const p = swipePose(at);
    expect([p.armed, p.ring]).toEqual([true, 1]);
  });

  it("never goes backwards as the fingers travel", () => {
    let last = swipePose(0);
    for (let d = 1; d < 400; d++) {
      const p = swipePose(d);
      expect(p.shift).toBeGreaterThanOrEqual(last.shift);
      expect(p.budWidth).toBeGreaterThanOrEqual(last.budWidth);
      last = p;
    }
  });
});

describe("release", () => {
  it("commits when armed, opens past a short swipe, else springs back", () => {
    expect(releaseTo(openRest() + SWIPE.armAfter)).toBe("commit");
    expect(releaseTo(openRest())).toBe("open");
    expect(releaseTo(20)).toBe("close");
  });

  it("puts an open row away with a small push back", () => {
    const rest = openRest();
    expect(releaseTo(rest - SWIPE.closeBack, SWIPE, rest)).toBe("close");
    expect(releaseTo(rest - 4, SWIPE, rest)).toBe("open");
    // Opening from closed still needs the same travel as before.
    expect(releaseTo(rest - SWIPE.closeBack)).toBe("open");
  });

  it("settles on its target", () => {
    let s = { x: 100, v: 0, done: false };
    for (let i = 0; i < 200 && !s.done; i++) s = springStep(s.x, s.v, 0, 1 / 60);
    expect(s).toEqual({ x: 0, v: 0, done: true });
  });
});

describe("reading the trackpad", () => {
  it("locks to sideways or scrolling on the first clear move", () => {
    expect(feedWheel(NEW_GESTURE, 6, 1).axis).toBe("x");
    const scroll = feedWheel(NEW_GESTURE, 2, 8);
    expect(scroll.axis).toBe("y");
    expect(feedWheel(scroll, 30, 0).dx).toBe(0);
  });

  it("adds up sideways travel until coasting starts", () => {
    let g = NEW_GESTURE;
    for (const d of [4, 9, 12, 7, 11]) g = feedWheel(g, d, 0);
    expect([g.dx, g.released]).toEqual([43, false]);
    for (const d of [10, 9, 8.2, 7.5]) g = feedWheel(g, d, 0);
    expect(g.released).toBe(true);
    const after = feedWheel(g, 7, 0);
    expect(after.dx).toBe(g.dx);
  });

  it("keeps following a smoothly slowing hand when macOS reports the lift", () => {
    let g = NEW_GESTURE;
    for (const d of [12, 10, 9, 8.2, 7.5, 6.9]) g = feedWheel(g, d, 0, false);
    expect(g.released).toBe(false);
    expect(g.dx).toBeCloseTo(53.6);
  });

  it("tells coasting from a hand slowing unevenly", () => {
    expect(isCoasting([20, 18, 16.5, 15])).toBe(true);
    expect(isCoasting([20, 12, 11, 4])).toBe(false);
    expect(isCoasting([5, 6, 5, 4])).toBe(false);
  });
});

describe("what each side does", () => {
  it("archives from the Inbox, moves back to it from Trash, trashes elsewhere", () => {
    const inbox = { unread: true, inInbox: true, inTrash: false, starred: false, inSpam: false };
    expect(swipeActions(inbox)).toEqual({
      left: { kind: "archive", archived: true },
      right: { kind: "read", read: true },
    });
    expect(swipeActions({ ...inbox, inInbox: false }).left).toEqual({
      kind: "trash",
      trashed: true,
    });
    expect(swipeActions({ ...inbox, inInbox: false, inTrash: true }).left).toEqual({
      kind: "archive",
      archived: false,
    });
    expect(swipeActions({ ...inbox, unread: false }).right).toEqual({ kind: "read", read: false });
  });

  it("does what each side was set to, toggling like its key", () => {
    const row = { unread: false, inInbox: true, inTrash: true, starred: true, inSpam: true };
    expect(swipeActions(row, { swipeLeft: "star", swipeRight: "none" })).toEqual({
      left: { kind: "star", starred: false },
      right: null,
    });
    expect(swipeActions(row, { swipeLeft: "trash", swipeRight: "spam" })).toEqual({
      left: { kind: "trash", trashed: false },
      right: { kind: "spam", spam: false },
    });
  });
});

it("labels each button in a word", () => {
  expect(swipeLabel({ kind: "archive", archived: true })).toBe("Archive");
  expect(swipeLabel({ kind: "trash", trashed: true })).toBe("Trash");
  expect(swipeLabel({ kind: "read", read: false })).toBe("Unread");
  expect(swipeLabel({ kind: "spam", spam: false })).toBe("Not spam");
  expect(swipeLabel({ kind: "star", starred: true })).toBe("Star");
});

describe("the button's snap as it separates", () => {
  // The real stylesheet, so this guards what the app draws. (Read from
  // disk: Vitest stubs CSS imports, `?raw` ones too, as empty.)
  const css = readFileSync(resolve(__dirname, "../../../styles/index.css"), "utf8");
  const keyframes = snapKeyframes(css);

  it("is read from the stylesheet", () => {
    expect(keyframes.length).toBeGreaterThanOrEqual(2);
    expect(keyframes[0]!.at).toBe(0);
    expect(keyframes.at(-1)!.at).toBe(1);
  });

  it("never reaches back within the goo's reach of the row", () => {
    // The snap scales the button from its outer edge, so growing past its
    // width moves its near edge toward the row. It starts the moment the
    // gap reaches SNAP_GAP; the finger may stop there.
    const stretch = (largestScale(keyframes) - 1) * SWIPE.capsule;
    expect(SNAP_GAP).toBeGreaterThan(GOO_REACH);
    expect(SNAP_GAP - Math.max(0, stretch)).toBeGreaterThan(GOO_REACH);
  });
});

type Keyframe = { at: number; scale: number; easing: [number, number, number, number] };

const NAMED_EASINGS: Record<string, [number, number, number, number]> = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  "ease-in": [0.42, 0, 1, 1],
  "ease-out": [0, 0, 0.58, 1],
  "ease-in-out": [0.42, 0, 0.58, 1],
};

function easing(text: string): [number, number, number, number] {
  const bezier = /cubic-bezier\(([^)]*)\)/.exec(text);
  if (bezier) {
    const n = bezier[1]!.split(",").map(Number);
    expect(n).toHaveLength(4);
    return n as [number, number, number, number];
  }
  const named = Object.keys(NAMED_EASINGS).find((k) => new RegExp(`(^|\\s)${k}(\\s|$)`).test(text));
  if (!named) throw new Error(`unknown easing in "${text}"`);
  return NAMED_EASINGS[named]!;
}

/** `@keyframes swipe-snap`: each step's offset, scaleX and easing to the next. */
function snapKeyframes(sheet: string): Keyframe[] {
  const rule = /\.swipe-snap\s*\{[^}]*animation:\s*swipe-snap\s+([^;]*);/.exec(sheet);
  if (!rule) throw new Error(".swipe-snap's animation not found");
  const fallback = easing(rule[1]!.replace(/[\d.]+m?s/g, ""));
  const open = sheet.indexOf("{", sheet.indexOf("@keyframes swipe-snap "));
  let depth = 0;
  let close = open;
  for (; close < sheet.length; close++) {
    if (sheet[close] === "{") depth++;
    if (sheet[close] === "}" && --depth === 0) break;
  }
  const block = sheet.slice(open + 1, close);
  return [...block.matchAll(/(from|to|[\d.]+%)\s*\{([^}]*)\}/g)].map((m) => {
    const body = m[2]!;
    const scale = /scaleX\(([\d.]+)\)/.exec(body);
    if (!scale) throw new Error(`a swipe-snap step without scaleX: ${body}`);
    const timing = /animation-timing-function:\s*([^;]+);/.exec(body);
    const at = m[1] === "from" ? 0 : m[1] === "to" ? 1 : Number.parseFloat(m[1]!) / 100;
    return { at, scale: Number(scale[1]), easing: timing ? easing(timing[1]!) : fallback };
  });
}

/**
 * The widest the button gets: each step eases to the next along its
 * cubic-bezier, whose progress can overshoot past 1 or below 0, so the
 * curve is sampled, not just the keyframes' own values.
 */
function largestScale(frames: Keyframe[]): number {
  let most = Math.max(...frames.map((f) => f.scale));
  for (let i = 0; i + 1 < frames.length; i++) {
    const { scale: from, easing: e } = frames[i]!;
    const to = frames[i + 1]!.scale;
    for (let k = 0; k <= 1000; k++) {
      const t = k / 1000;
      // The curve's progress at parameter t; x is monotonic in t for a
      // valid easing, so sampling t covers every moment in time.
      const y = 3 * (1 - t) ** 2 * t * e[1] + 3 * (1 - t) * t ** 2 * e[3] + t ** 3;
      most = Math.max(most, from + (to - from) * y);
    }
  }
  return most;
}
