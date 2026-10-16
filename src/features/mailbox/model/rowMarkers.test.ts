import { describe, expect, it } from "vitest";
import { parseRowMarkers } from "./rowMarkers";

describe("parseRowMarkers", () => {
  it("keeps a known choice", () => {
    expect(parseRowMarkers("avatar")).toBe("avatar");
    expect(parseRowMarkers("noDot")).toBe("noDot");
  });

  it("falls back to the bar for nothing or junk", () => {
    expect(parseRowMarkers(null)).toBe("bar");
    expect(parseRowMarkers("sparkles")).toBe("bar");
  });
});
