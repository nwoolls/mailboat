import { describe, expect, it } from "vitest";
import { stuckAfterScroll } from "./stickToEnd";

const byHand = (top: number, lastTop: number, end: number) => ({ top, lastTop, end, byHand: true });
const byLayout = (top: number, lastTop: number, end: number) => ({
  top,
  lastTop,
  end,
  byHand: false,
});

describe("stuckAfterScroll", () => {
  it("sticks when the person scrolls down to the end", () => {
    expect(stuckAfterScroll(false, byHand(500, 200, 500))).toBe(true);
    expect(stuckAfterScroll(false, byHand(499, 200, 500))).toBe(true);
  });

  it("lets go when the person scrolls up short of the end", () => {
    expect(stuckAfterScroll(true, byHand(400, 500, 500))).toBe(false);
    // Slowly, a few pixels at a time: the first step is enough.
    expect(stuckAfterScroll(true, byHand(497, 500, 500))).toBe(false);
  });

  it("lets go on a move up of a pixel, so slow steps add up", () => {
    expect(stuckAfterScroll(true, byHand(499, 500, 500))).toBe(false);
  });

  it("stays as it was while the person scrolls down short of the end", () => {
    expect(stuckAfterScroll(true, byHand(200, 100, 500))).toBe(true);
    expect(stuckAfterScroll(false, byHand(200, 100, 500))).toBe(false);
  });

  it("stays as it was on a scroll that didn't move", () => {
    expect(stuckAfterScroll(false, byHand(500, 500, 500))).toBe(false);
  });

  it("ignores the layout moving the reader", () => {
    // Pulled up to a shorter end, which then grew again (an idea clicked).
    expect(stuckAfterScroll(true, byLayout(2002, 2084, 2074))).toBe(true);
    // Moved down onto the end to keep the view in place as content above grew.
    expect(stuckAfterScroll(false, byLayout(620, 500, 620))).toBe(false);
  });
});
