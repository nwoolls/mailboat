import { describe, expect, it } from "vitest";
import { contrast, labelChipColors, labelTextColor } from "./labelColors";

describe("a label's text color", () => {
  it("is black or white, whichever contrasts more", () => {
    expect(labelTextColor("#000000")).toBe("#ffffff");
    expect(labelTextColor("#ffffff")).toBe("#000000");
    expect(labelTextColor("#fad165")).toBe("#000000");
    expect(labelTextColor("#1c4587")).toBe("#ffffff");
    // A mid blue: black reads better than white on it.
    expect(labelTextColor("#4a86e8")).toBe("#000000");
  });

  it("measures contrast as WCAG does", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#777777")).toBeCloseTo(1, 5);
  });

  it("ignores a hard-to-read text color kept in Gmail", () => {
    // A light blue with Gmail's darker blue text, as some labels come.
    const chip = labelChipColors({ colorBg: "#c9daf8" })!;
    expect(chip.color).toBe("#000000");
    expect(contrast(chip.background, chip.color)).toBeGreaterThan(contrast("#c9daf8", "#285bac"));
    expect(labelChipColors({ colorBg: null })).toBeNull();
  });
});
