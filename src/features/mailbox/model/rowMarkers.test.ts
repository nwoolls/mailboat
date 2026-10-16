import { describe, expect, it } from "vitest";
import { parseRowMarkers, tint } from "./rowMarkers";

describe("parseRowMarkers", () => {
  it("keeps a known choice", () => {
    expect(parseRowMarkers("ring")).toBe("ring");
    expect(parseRowMarkers("glassDot")).toBe("glassDot");
  });

  it("falls back to the glass bar for nothing, junk or a retired style", () => {
    expect(parseRowMarkers(null)).toBe("glassBar");
    expect(parseRowMarkers("sparkles")).toBe("glassBar");
    expect(parseRowMarkers("avatar")).toBe("glassBar");
  });
});

describe("tint", () => {
  it("mixes the colour with transparency", () => {
    expect(tint("#5b9bff", 40)).toBe("color-mix(in srgb, #5b9bff 40%, transparent)");
  });
});
