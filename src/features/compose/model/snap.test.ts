import { describe, expect, it } from "vitest";
import { cardSize, nearestSpot, spotPosition } from "./snap";

const viewport = { width: 1400, height: 900 };
const card = cardSize(viewport);

describe("snapping", () => {
  it("uses Gmail's size, shrunk for small windows", () => {
    expect(card).toEqual({ width: 500, height: 560 });
    expect(cardSize({ width: 400, height: 500 })).toEqual({ width: 368, height: 436 });
  });

  it("places spots inside the window's edges", () => {
    expect(spotPosition("bottom-right", viewport, card)).toEqual({ x: 884, y: 324 });
    expect(spotPosition("top-left", viewport, card)).toEqual({ x: 16, y: 48 });
    expect(spotPosition("top", viewport, card)).toEqual({ x: 450, y: 48 });
  });

  it("dropped still, it goes to the nearest spot", () => {
    expect(nearestSpot({ x: 40, y: 60 }, { x: 0, y: 0 }, viewport, card)).toBe("top-left");
    expect(nearestSpot({ x: 860, y: 300 }, { x: 0, y: 0 }, viewport, card)).toBe("bottom-right");
  });

  it("a flick carries it to where it was heading", () => {
    // Let go near the left edge, but thrown hard to the right.
    const at = { x: 100, y: 48 };
    expect(nearestSpot(at, { x: 0, y: 0 }, viewport, card)).toBe("top-left");
    expect(nearestSpot(at, { x: 5000, y: 0 }, viewport, card)).toBe("top-right");
  });
});
