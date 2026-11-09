import { expect, test } from "@playwright/test";

/**
 * The window is not a page (owner report, 2026-11-06): with nothing left in
 * the inbox, a sideways swipe pulled the whole app sideways inside the
 * window. The page itself must not take a gesture the lists leave over:
 * `overscroll-behavior: none` on the root (the rubber band itself can't be
 * made in a headless browser, so this checks what stops it), and nothing
 * that makes the page scroll sideways.
 */
test("the page doesn't bounce or scroll sideways, with an empty list too", async ({ page }) => {
  await page.goto("/tests/browser/harness.html?mode=empty");
  const root = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return {
      x: style.overscrollBehaviorX,
      y: style.overscrollBehaviorY,
      wide: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });
  expect(root).toEqual({ x: "none", y: "none", wide: false });

  // A sideways flick over the empty list moves nothing.
  await page.mouse.move(500, 300);
  await page.mouse.wheel(120, 0);
  await page.mouse.wheel(-240, 0);
  const moved = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
  expect(moved).toEqual({ x: 0, y: 0 });
});
