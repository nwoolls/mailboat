import { describe, expect, it } from "vitest";
import { approach } from "./glow";

describe("approach", () => {
  it("closes about 63% of the gap after one time constant", () => {
    expect(approach(0, 100, 0.5, 0.5)).toBeCloseTo(63.2, 1);
  });

  it("is the same whether the frames are short or long", () => {
    let fast = 0;
    for (let i = 0; i < 12; i++) fast = approach(fast, 100, 1 / 120, 0.3);
    let slow = 0;
    for (let i = 0; i < 6; i++) slow = approach(slow, 100, 1 / 60, 0.3);
    expect(fast).toBeCloseTo(slow, 6);
  });

  it("never overshoots", () => {
    expect(approach(0, 100, 10, 0.3)).toBeLessThanOrEqual(100);
    expect(approach(90, 100, 0.016, 0.3)).toBeGreaterThan(90);
  });
});
