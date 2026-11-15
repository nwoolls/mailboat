import { expect, test } from "@playwright/test";

/**
 * The title bar's search box (0.3.0, owner report with a screenshot): at
 * narrower windows it ran into the toolbar's first button. At every width
 * down to the window's narrowest it now keeps clear of the buttons on both
 * sides, centered on the window while there is room.
 */
test("the search box never covers the toolbar's buttons", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 700 });
  await page.goto("/tests/browser/harness.html?mode=shell&rows=1");
  const search = page.locator("#title-search").locator("..");
  await expect(search).toBeVisible();

  for (const width of [1400, 1200, 1040, 1000, 950, 900, 880, 850, 820]) {
    await page.setViewportSize({ width, height: 700 });
    const boxes = async () => {
      const [s, start, end] = await Promise.all([
        search.boundingBox(),
        page.locator("[data-toolbar-start]").boundingBox(),
        page.locator("[data-toolbar-end]").boundingBox(),
      ]);
      return { s: s!, start: start!, end: end! };
    };
    // Measured after the toolbar has placed it for this width.
    await expect
      .poll(
        async () => {
          const { s, end } = await boxes();
          return s.x + s.width <= end.x - 8;
        },
        { message: `right edge at ${width}px` },
      )
      .toBe(true);
    const { s, start } = await boxes();
    expect(s.x, `left edge at ${width}px`).toBeGreaterThanOrEqual(start.x + start.width + 8);
    expect(s.width, `width at ${width}px`).toBeGreaterThanOrEqual(200);
    if (width >= 1040)
      expect(Math.abs(s.x + s.width / 2 - width / 2), `centered at ${width}px`).toBeLessThanOrEqual(
        1,
      );
  }
});
