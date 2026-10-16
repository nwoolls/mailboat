import { describe, expect, it } from "vitest";
import { nextMenuIndex } from "./menuNavigation";

describe("nextMenuIndex", () => {
  it("starts at the first item going down and the last going up", () => {
    expect(nextMenuIndex(-1, 3, "ArrowDown")).toBe(0);
    expect(nextMenuIndex(-1, 3, "ArrowUp")).toBe(2);
  });

  it("steps and wraps around", () => {
    expect(nextMenuIndex(0, 3, "ArrowDown")).toBe(1);
    expect(nextMenuIndex(2, 3, "ArrowDown")).toBe(0);
    expect(nextMenuIndex(0, 3, "ArrowUp")).toBe(2);
  });

  it("has nowhere to go in an empty menu", () => {
    expect(nextMenuIndex(-1, 0, "ArrowDown")).toBe(-1);
  });
});
