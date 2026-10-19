import { describe, expect, it } from "vitest";
import { parseTextSize, textZoom } from "./textSize";

describe("text size", () => {
  it("defaults when nothing or nonsense was saved", () => {
    expect(parseTextSize(null)).toBe("default");
    expect(parseTextSize("{oops")).toBe("default");
    expect(parseTextSize('"huge"')).toBe("default");
  });
  it("keeps a saved size, and knows its zoom", () => {
    expect(parseTextSize('"large"')).toBe("large");
    expect(textZoom("default")).toBe(1);
    expect(textZoom("small")).toBeLessThan(1);
    expect(textZoom("larger")).toBeGreaterThan(textZoom("large"));
  });
});
