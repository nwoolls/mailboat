import { expect, test } from "@playwright/test";

/**
 * Windows (owner report, 2026-10-25): the mouse wheel over an email didn't
 * scroll the reader, though the list and Settings scrolled. Runs in
 * Chromium, WebView2's engine, with the Windows styles on.
 */
test("the wheel over an email scrolls the reader", async ({ page }) => {
  await page.goto("/tests/browser/harness.html?mode=inline");
  await page.evaluate(() => (document.documentElement.dataset.platform = "windows"));
  const frame = page.getByTitle("Message content").first();
  await expect(frame).toBeVisible();
  // A short reader, so there's something to scroll.
  await page.evaluate(() => {
    document.querySelector<HTMLElement>("#root > div")!.style.height = "360px";
  });
  await page.waitForTimeout(500);
  const scrollTop = () => page.evaluate(() => document.querySelector(".reader-scroll")!.scrollTop);
  const box = (await frame.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 100));
  const before = await scrollTop();
  await page.mouse.wheel(0, 200);
  await page.waitForTimeout(600);
  expect(await scrollTop()).toBeGreaterThan(before);
});
