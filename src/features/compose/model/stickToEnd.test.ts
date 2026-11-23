import { describe, expect, it } from "vitest";
import { stuckAfterScroll } from "./stickToEnd";

describe("stuckAfterScroll", () => {
  it("sticks at the end, however it got there", () => {
    expect(stuckAfterScroll(false, { top: 500, lastTop: 200, end: 500 })).toBe(true);
    expect(stuckAfterScroll(true, { top: 499, lastTop: 499, end: 500 })).toBe(true);
    // Content shrank (the assistant closed): clamped up, but to the end.
    expect(stuckAfterScroll(true, { top: 300, lastTop: 500, end: 300 })).toBe(true);
  });

  it("isn't caught again by a shrink that clamps a released reader to the end", () => {
    expect(stuckAfterScroll(false, { top: 300, lastTop: 400, end: 300 })).toBe(false);
  });

  it("lets go when moved up short of the end", () => {
    expect(stuckAfterScroll(true, { top: 400, lastTop: 500, end: 500 })).toBe(false);
    // Slowly, a few pixels at a time: the first step is enough.
    expect(stuckAfterScroll(true, { top: 497, lastTop: 500, end: 500 })).toBe(false);
  });

  it("stays as it was while moving down toward the end", () => {
    expect(stuckAfterScroll(true, { top: 200, lastTop: 100, end: 500 })).toBe(true);
    expect(stuckAfterScroll(false, { top: 200, lastTop: 100, end: 500 })).toBe(false);
  });
});
