import { describe, expect, it } from "vitest";
import { glassScale, parseGlassBoost } from "./glass";

describe("glass transparency", () => {
  it("reads a saved boost, kept to the slider's range and steps", () => {
    expect(parseGlassBoost("20")).toBe(20);
    expect(parseGlassBoost("22")).toBe(20);
    expect(parseGlassBoost("90")).toBe(90);
    expect(parseGlassBoost("150")).toBe(100);
    expect(parseGlassBoost("-5")).toBe(0);
  });

  it("falls back to the default look", () => {
    expect(parseGlassBoost(null)).toBe(0);
    expect(parseGlassBoost("lots")).toBe(0);
  });

  it("scales every tint by the same factor, so areas keep their differences", () => {
    expect(glassScale(0)).toBe(1);
    expect(glassScale(20)).toBeCloseTo(0.8);
  });
});
