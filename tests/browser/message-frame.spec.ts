import { expect, type Page, test } from "@playwright/test";

/**
 * Blank space under an email (owner report, 2026-10-22): an email's frame
 * could grow but never shrink, so after the reader was briefly narrower
 * (the sidebar docking, the AI panel opening, a window resize) it kept the
 * taller height with empty space below the text.
 */
async function frameHeight(page: Page) {
  return page.getByTitle("Message content").evaluate((el) => el.getBoundingClientRect().height);
}

async function setReaderWidth(page: Page, width: number) {
  await page.evaluate((w) => {
    document.querySelector<HTMLElement>("#root > div")!.style.width = `${w}px`;
  }, width);
}

test("an email's frame shrinks back when the reader widens again", async ({ page }) => {
  await page.goto("/tests/browser/harness.html?mode=inline");
  await expect(page.getByTitle("Message content")).toBeVisible();
  await expect.poll(() => frameHeight(page)).toBeGreaterThan(200);
  const wide = await frameHeight(page);

  await setReaderWidth(page, 320);
  await expect.poll(() => frameHeight(page)).toBeGreaterThan(wide * 1.5);

  await setReaderWidth(page, 760);
  await expect.poll(() => frameHeight(page)).toBeLessThanOrEqual(wide + 1);
});
