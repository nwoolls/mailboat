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
