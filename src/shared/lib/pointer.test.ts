import { describe, expect, it } from "vitest";
import { isRealMove } from "./pointer";

describe("isRealMove", () => {
  it("ignores pointer events that don't move", () => {
    expect(isRealMove(null, { clientX: 5, clientY: 5 })).toBe(false);
    expect(isRealMove({ x: 5, y: 5 }, { clientX: 5, clientY: 5 })).toBe(false);
    expect(isRealMove({ x: 5, y: 5 }, { clientX: 6, clientY: 6 })).toBe(false);
    expect(isRealMove({ x: 5, y: 5 }, { clientX: 12, clientY: 5 })).toBe(true);
  });
});
