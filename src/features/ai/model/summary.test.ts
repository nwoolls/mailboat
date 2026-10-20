import { describe, expect, it } from "vitest";
import { summaryPoints } from "./summary";

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
