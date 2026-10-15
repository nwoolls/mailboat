import { describe, expect, it } from "vitest";
import { clampWidth, LIST_WIDTH, listMaxWidth, READER_MIN_WIDTH } from "./panes";

describe("clampWidth", () => {
  it("keeps a width inside its bounds", () => {
    expect(clampWidth(100, 180, 360)).toBe(180);
    expect(clampWidth(500, 180, 360)).toBe(360);
    expect(clampWidth(250.6, 180, 360)).toBe(251);
  });

  it("prefers the minimum when the bounds cross (window too narrow)", () => {
    expect(clampWidth(300, 260, 200)).toBe(260);
  });
});

describe("listMaxWidth", () => {
  it("leaves the reader its minimum width", () => {
    expect(listMaxWidth(1000)).toBe(1000 - READER_MIN_WIDTH);
  });

  it("never goes below the list's own minimum", () => {
    expect(listMaxWidth(400)).toBe(LIST_WIDTH.min);
  });
});
