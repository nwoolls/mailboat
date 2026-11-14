import { describe, expect, it } from "vitest";
import { dropChar, lensPart } from "./deepRain";

describe("rain in the Toybox's styles", () => {
  it("draws bigger drops as rounder, bolder characters", () => {
    expect([1, 2, 4, 6].map(dropChar)).toEqual([".", "o", "O", "@"]);
  });

  it("sees a drop as a lens: glint at the top left, dark rim, light low down", () => {
    expect(lensPart(-0.35, -0.42, true)).toBe("glint");
    // A small drop has no glint.
    expect(lensPart(-0.35, -0.42, false)).toBe("clear");
    expect(lensPart(0.9, 0, true)).toBe("rim");
    expect(lensPart(0, 0.6, true)).toBe("low");
    expect(lensPart(0, 0, true)).toBe("clear");
    expect(lensPart(1, 1, true)).toBeNull();
  });
});
