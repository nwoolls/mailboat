import { describe, expect, it } from "vitest";
import {
  OVERFLOW_ORDER,
  overflowCount,
  SEARCH_GAP,
  toolbarLayout,
  SEARCH_WIDTH,
  searchPlacement,
} from "./titleSearch";

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

describe("toolbar buttons moving into More", () => {
  // The macOS bar's right-hand buttons without the five that can move.
  const fixed = 332 - 5 * 30;
  const moved = (bar: number) => overflowCount(bar, LEFT_END, fixed, 30);

  it("moves none while everything fits", () => {
    expect(moved(1280)).toBe(0);
    expect(moved(LEFT_END + fixed + 5 * 30 + 2 * SEARCH_GAP + SEARCH_WIDTH.min)).toBe(0);
  });

  it("moves them one at a time as the window narrows, and never more than there are", () => {
    const widest = LEFT_END + fixed + 5 * 30 + 2 * SEARCH_GAP + SEARCH_WIDTH.min;
    expect(moved(widest - 1)).toBe(1);
    expect(moved(widest - 30)).toBe(1);
    expect(moved(widest - 31)).toBe(2);
    expect(moved(400)).toBe(OVERFLOW_ORDER.length);
    expect(moved(100)).toBe(OVERFLOW_ORDER.length);
  });

  it("starts with Labels and keeps Archive", () => {
    expect(OVERFLOW_ORDER[0]).toBe("labels");
    expect(OVERFLOW_ORDER).not.toContain("archive");
  });
});

describe("the toolbar's layout, measured", () => {
  // As the toolbar measures it: the bar's right padding (8px) after the
  // right-hand group, which holds `shown` of the movable buttons.
  const measured = (bar: number, shown: number) => {
    const rightWidth = 182 + shown * 30;
    return toolbarLayout({
      bar,
      leftEnd: 108,
      rightStart: bar - 8 - rightWidth,
      rightWidth,
      shown,
      perButton: 30,
    });
  };

  it("keeps the search box at its narrowest or wider, counting the bar's padding", () => {
    // Review: without the padding, 664px kept every button and left 192px.
    for (let bar = 560; bar <= 1400; bar += 1) {
      for (let shown = 0; shown <= OVERFLOW_ORDER.length; shown += 1) {
        const { overflow, placement } = measured(bar, shown);
        if (overflow < OVERFLOW_ORDER.length)
          expect(placement.width, `${bar}px, ${shown} shown`).toBeGreaterThanOrEqual(
            SEARCH_WIDTH.min,
          );
      }
    }
  });

  it("places the search box for the buttons that will be shown, not those still there", () => {
    // Narrowed past a boundary with every button still in the bar: the box
    // is placed as if the moved ones had gone, and clears the rest.
    for (let bar = 560; bar <= 1400; bar += 1) {
      const before = measured(bar, OVERFLOW_ORDER.length);
      const after = measured(bar, OVERFLOW_ORDER.length - before.overflow);
      expect(after.overflow, `${bar}px`).toBe(before.overflow);
      expect(before.placement, `${bar}px`).toEqual(after.placement);
    }
  });
});
