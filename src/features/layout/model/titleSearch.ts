/** How wide the title bar's search box gets. */
export const SEARCH_WIDTH = { min: 200, max: 440 };
/** Space kept between the search box and the buttons on either side. */
export const SEARCH_GAP = 12;

/** Where the search box sits in the title bar, in pixels from its left edge. */
export type SearchPlacement = { left: number; width: number };

/**
 * Places the title bar's search box between the buttons on its left (ending
 * at `leftEnd`) and those on its right (starting at `rightStart`), in a bar
 * `bar` pixels wide. It is centered on the window, as in VS Code, as wide as
 * it can be without coming within `SEARCH_GAP` of either side. When even its
 * narrowest centered box would reach the buttons, it moves left instead, to
 * sit just before the right-hand buttons, so it never covers them. With less
 * room than its narrowest, it takes what there is.
 */
export function searchPlacement(bar: number, leftEnd: number, rightStart: number): SearchPlacement {
  const center = bar / 2;
  const centered = 2 * Math.min(center - leftEnd, rightStart - center) - 2 * SEARCH_GAP;
  if (centered >= SEARCH_WIDTH.min) {
    const width = Math.min(SEARCH_WIDTH.max, centered);
    return { left: center - width / 2, width };
  }
  const room = Math.max(0, rightStart - leftEnd - 2 * SEARCH_GAP);
  const width = Math.min(SEARCH_WIDTH.min, room);
  return { left: rightStart - SEARCH_GAP - width, width };
}

/**
 * The toolbar buttons that move into the More menu when the window is too
 * narrow for them, in the order they go (owner, 2026-11-14): Labels first,
 * Archive never.
 */
export const OVERFLOW_ORDER = ["labels", "star", "read", "spam", "trash"] as const;
export type OverflowButton = (typeof OVERFLOW_ORDER)[number];

/**
 * How many of `OVERFLOW_ORDER` move into the More menu so the search box
 * keeps its narrowest width between the buttons on both sides: none while
 * everything fits, all of them at most. `fixedRight` is the right-hand
 * buttons' width without any of these; `perButton` is what each adds.
 */
export function overflowCount(
  bar: number,
  leftEnd: number,
  fixedRight: number,
  perButton: number,
): number {
  const room = bar - leftEnd - fixedRight - 2 * SEARCH_GAP - SEARCH_WIDTH.min;
  const fit = Math.max(0, Math.floor(room / perButton));
  return Math.max(0, OVERFLOW_ORDER.length - fit);
}
