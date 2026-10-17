import { describe, expect, it } from "vitest";
import {
  feedWheel,
  isCoasting,
  NEW_GESTURE,
  openRest,
  releaseTo,
  springStep,
  SWIPE,
  swipeActions,
  swipeLabel,
  swipePose,
} from "./swipe";

describe("swipe pose", () => {
  it("starts joined: the bud grows while the row barely moves", () => {
    const p = swipePose(16);
    expect(p.budWidth).toBeGreaterThan(p.shift);
    expect(p.label).toBeLessThan(0.5);
    expect(p.armed).toBe(false);
  });

  it("breaks away into a capsule with a gap, label shown", () => {
    const p = swipePose(SWIPE.breakAt);
    expect(p.budWidth).toBeCloseTo(SWIPE.capsule);
    expect(p.shift - p.budWidth).toBeCloseTo(SWIPE.gap);
    expect(p.label).toBe(1);
    expect(p.ring).toBe(0);
  });

  it("arms a little further on, with the ring full", () => {
    expect(swipePose(SWIPE.armAt - 1).armed).toBe(false);
    const p = swipePose(SWIPE.armAt);
    expect([p.armed, p.ring]).toEqual([true, 1]);
    expect(SWIPE.armAt).toBeLessThan(200);
  });

  it("never goes backwards as the fingers travel", () => {
    let last = swipePose(0);
    for (let d = 1; d < 300; d++) {
      const p = swipePose(d);
      expect(p.shift).toBeGreaterThanOrEqual(last.shift);
      expect(p.budWidth).toBeGreaterThanOrEqual(last.budWidth);
      last = p;
    }
  });
});

describe("release", () => {
  it("commits when armed, opens past a short swipe, else springs back", () => {
    expect(releaseTo(SWIPE.armAt)).toBe("commit");
    expect(releaseTo(SWIPE.openAt + 1)).toBe("open");
    expect(releaseTo(10)).toBe("close");
    expect(releaseTo(openRest())).toBe("open");
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

  it("tells coasting from a hand slowing unevenly", () => {
    expect(isCoasting([20, 18, 16.5, 15])).toBe(true);
    expect(isCoasting([20, 12, 11, 4])).toBe(false);
    expect(isCoasting([5, 6, 5, 4])).toBe(false);
  });
});

describe("what each side does", () => {
  it("archives from the Inbox, trashes elsewhere, nothing in Trash", () => {
    const inbox = { unread: true, inInbox: true, inTrash: false };
    expect(swipeActions(inbox)).toEqual({
      left: { kind: "archive", archived: true },
      right: { kind: "read", read: true },
    });
    expect(swipeActions({ ...inbox, inInbox: false }).left).toEqual({
      kind: "trash",
      trashed: true,
    });
    expect(swipeActions({ ...inbox, inInbox: false, inTrash: true }).left).toBeNull();
    expect(swipeActions({ ...inbox, unread: false }).right).toEqual({ kind: "read", read: false });
  });
});

it("labels each button in a word", () => {
  expect(swipeLabel({ kind: "archive", archived: true })).toBe("Archive");
  expect(swipeLabel({ kind: "trash", trashed: true })).toBe("Trash");
  expect(swipeLabel({ kind: "read", read: false })).toBe("Unread");
});
