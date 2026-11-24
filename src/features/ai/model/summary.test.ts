import { describe, expect, it } from "vitest";
import { pointsSoFar, summaryPoints } from "./summary";

describe("summaryPoints", () => {
  it("reads bullet lines and drops anything around them", () => {
    expect(summaryPoints("Here you go:\n- Moved to **Thursday**\n• Bring numbers\n")).toEqual([
      "Moved to Thursday",
      "Bring numbers",
    ]);
    expect(summaryPoints("1. First\n2. Second")).toEqual(["First", "Second"]);
  });

  it("keeps prose as one point", () => {
    expect(summaryPoints("Sam moved the review.\nBring numbers.")).toEqual([
      "Sam moved the review. Bring numbers.",
    ]);
    expect(summaryPoints("  ")).toEqual([]);
  });
});

describe("pointsSoFar", () => {
  it("leaves out a bullet whose first word hasn't arrived yet", () => {
    expect(pointsSoFar("-")).toEqual([]);
    expect(pointsSoFar("- Lunch")).toEqual(["Lunch"]);
    expect(pointsSoFar("- Lunch moved\n-")).toEqual(["Lunch moved"]);
  });
});
