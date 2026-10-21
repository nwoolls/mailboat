import { describe, expect, it } from "vitest";
import { assistantLayout, cardSize, nearestSpot, spotPosition } from "./snap";

const viewport = { width: 1400, height: 900 };
const card = cardSize(viewport);

describe("snapping", () => {
  it("uses Gmail's size, shrunk for small windows", () => {
    expect(card).toEqual({ width: 500, height: 560 });
    expect(cardSize({ width: 400, height: 500 })).toEqual({ width: 368, height: 436 });
  });

  it("widens for the writing assistant, still inside the window", () => {
    expect(cardSize(viewport, true)).toEqual({ width: 840, height: 560 });
    expect(cardSize({ width: 820, height: 600 }, true).width).toBe(788);
    // Resting bottom-right, it grows to the left.
    expect(spotPosition("bottom-right", viewport, cardSize(viewport, true)).x).toBe(544);
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

  it("opens the assistant beside the form without moving it", () => {
    // Lower right (home): the panel opens to the left; the form stays.
    const home = spotPosition("bottom-right", viewport, card);
    const open = assistantLayout(home, card, viewport, true);
    expect(open).toEqual({ left: home.x - 340, width: 840, side: "left", panelWidth: 340 });
    expect(open.left + open.width).toBe(home.x + card.width);
    // Closed: just the form, same side (it collapses back that way).
    expect(assistantLayout(home, card, viewport, false)).toEqual({
      left: home.x,
      width: 500,
      side: "left",
      panelWidth: 0,
    });
    // Lower left: no room on the left, so it opens to the right.
    const left = spotPosition("bottom-left", viewport, card);
    expect(assistantLayout(left, card, viewport, true)).toMatchObject({
      left: left.x,
      side: "right",
    });
  });

  it("moves the card only when neither side has room", () => {
    const narrow = { width: 900, height: 700 };
    const form = { x: 200, y: 100 };
    const layout = assistantLayout(form, card, narrow, true);
    expect(layout.side).toBe("left");
    expect(layout.left).toBe(16);
    expect(layout.left + layout.width).toBeLessThanOrEqual(narrow.width - 16);
    // A very narrow window: a narrower panel, still inside.
    const tiny = assistantLayout({ x: 16, y: 0 }, card, { width: 820, height: 600 }, true);
    expect(tiny.panelWidth).toBe(820 - 32 - 500);
  });
});
