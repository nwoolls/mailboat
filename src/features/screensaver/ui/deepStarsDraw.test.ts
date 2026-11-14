import { describe, expect, it } from "vitest";
import { crossFade } from "./deepStarsDraw";

describe("an ASCII star crossing cells", () => {
  it("is all in its own cell, sharp, most of the way across", () => {
    for (const frac of [0.2, 0.5, 0.75]) expect(crossFade(frac).share).toBe(0);
  });

  it("fades into the neighbor it is heading toward near the edge, half and half on it", () => {
    expect(crossFade(0.9).step).toBe(1);
    expect(crossFade(0.1).step).toBe(-1);
    expect(crossFade(0.9).share).toBeGreaterThan(0);
    expect(crossFade(0.999).share).toBeCloseTo(0.5, 2);
    expect(crossFade(0.001).share).toBeCloseTo(0.5, 2);
  });

  it("hands over smoothly: the share only grows toward the edge", () => {
    let last = 0;
    for (let f = 0.5; f < 1; f += 0.01) {
      const { share } = crossFade(f);
      expect(share).toBeGreaterThanOrEqual(last);
      last = share;
    }
  });
});
