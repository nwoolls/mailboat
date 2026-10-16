import { describe, expect, it } from "vitest";
import { wholePixelSlack } from "./pixelSnap";

describe("wholePixelSlack", () => {
  it("tops a fractional height up to the next whole pixel", () => {
    expect(wholePixelSlack(812.25)).toBeCloseTo(0.75);
    expect(wholePixelSlack(812.5)).toBeCloseTo(0.5);
  });

  it("adds nothing to whole heights, even with float noise", () => {
    expect(wholePixelSlack(812)).toBe(0);
    expect(wholePixelSlack(812.0000001)).toBe(0);
  });
});
