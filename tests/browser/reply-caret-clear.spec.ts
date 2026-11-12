import { expect, test } from "@playwright/test";

/**
 * Typing new lines at the end of an inline reply: the line being typed on
 * stays above the pinned formatting and Send bar, at any reader width (in a
 * narrow reader the bar wraps onto more rows and is taller). Owner report,
 * 2026-11-12: the caret ended up under the bar.
 */
for (const width of [760, 560, 440])
  test(`${width}px reader: the line being typed stays above the Send bar`, async ({ page }) => {
    await page.goto("/tests/browser/harness.html?mode=inline");
    await expect(page.getByTitle("Message content")).toBeVisible();
    await page.evaluate((w) => {
      document.querySelector<HTMLElement>("#root > div")!.style.width = `${w}px`;
    }, width);
    await page.getByRole("button", { name: "Reply", exact: true }).click();
    const editor = page
      .locator('section[aria-label="Reply"]')
      .getByRole("textbox", { name: "Message" });
    await expect(editor).toBeFocused();
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press("Enter");
      await page.keyboard.type(`Line ${i + 1}`);
    }
    await page.waitForTimeout(300);
    const { lineBottom, footTop, footHeight } = await page.evaluate(() => {
      const node = window.getSelection()!.anchorNode!;
      const line = (node.nodeType === 1 ? (node as Element) : node.parentElement!).closest("p")!;
      const foot = document.querySelector(".reader-foot")!.getBoundingClientRect();
      return {
        lineBottom: line.getBoundingClientRect().bottom,
        footTop: foot.top,
        footHeight: foot.height,
      };
    });
    console.log(width, { lineBottom, footTop, footHeight });
    expect(lineBottom, "the line's bottom, against the bar's top").toBeLessThanOrEqual(footTop);
  });
