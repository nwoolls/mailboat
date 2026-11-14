import { describe, expect, it } from "vitest";
import { SEARCH_GAP, SEARCH_WIDTH, searchPlacement } from "./titleSearch";

/** The macOS title bar: traffic lights and the sidebar button on the left, ten buttons on the right. */
const LEFT_END = 108;
const RIGHT_GROUP = 332;

function place(bar: number) {
  const placed = searchPlacement(bar, LEFT_END, bar - RIGHT_GROUP);
  return { ...placed, right: placed.left + placed.width };
}

describe("the title bar's search box", () => {
  it("is centered and at its widest in a wide window", () => {
    const p = place(1400);
    expect(p.width).toBe(SEARCH_WIDTH.max);
    expect(p.left + p.width / 2).toBe(700);
  });

  it("never reaches the buttons on either side, at any width", () => {
    for (let bar = 600; bar <= 2000; bar += 1) {
      const p = place(bar);
      expect(p.left, `${bar}`).toBeGreaterThanOrEqual(LEFT_END + SEARCH_GAP);
      expect(p.right, `${bar}`).toBeLessThanOrEqual(bar - RIGHT_GROUP - SEARCH_GAP + 1e-9);
    }
  });

  it("stays centered while it fits, then sits just before the buttons", () => {
    // Narrower than the widest, still centered.
    const middle = place(1000);
    expect(middle.width).toBeLessThan(SEARCH_WIDTH.max);
    expect(middle.left + middle.width / 2).toBe(500);
    // The window's narrowest: no room to center, so it moves left.
    const narrow = place(820);
    expect(narrow.width).toBe(SEARCH_WIDTH.min);
    expect(narrow.right).toBe(820 - RIGHT_GROUP - SEARCH_GAP);
    expect(narrow.left + narrow.width / 2).toBeLessThan(410);
  });

  it("moves without a jump as the window narrows past centering", () => {
    for (let bar = 820; bar < 1100; bar += 1) {
      const a = place(bar);
      const b = place(bar + 1);
      expect(Math.abs(b.left - a.left), `${bar}`).toBeLessThanOrEqual(1);
      expect(Math.abs(b.width - a.width), `${bar}`).toBeLessThanOrEqual(2);
    }
  });

  it("takes what room there is when there is less than its narrowest", () => {
    const p = searchPlacement(500, 108, 300);
    expect(p.width).toBe(300 - 108 - 2 * SEARCH_GAP);
    expect(searchPlacement(300, 200, 210).width).toBe(0);
  });
});
