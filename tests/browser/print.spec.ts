import { expect, test } from "@playwright/test";

/**
 * Printing a conversation (0.3.0): the toolbar's More menu has Print…, which
 * loads every email for paper and opens the print dialog once they have
 * loaded. On paper only the printout shows: the app is gone, and each email's
 * frame is as tall as its content, so nothing is cut off.
 */
test("prints the whole conversation, and only it", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  // An image in one email arrives late: its frame loads only then.
  await page.route("**/print-slow-image.png", async (route) => {
    await new Promise((done) => setTimeout(done, 600));
    await route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        "base64",
      ),
    });
  });
  await page.goto("/tests/browser/harness.html?mode=shell&rows=1&conversation=all");
  await page.getByRole("option").first().click();
  await expect(page.locator(".reader-scroll")).toBeVisible();

  await page.getByTitle("More", { exact: true }).click();
  await page.getByRole("menuitem", { name: "Print…" }).click();

  // The dialog opens once, with all five emails loaded and grown to their
  // content (one of them answers late).
  const order = () =>
    page.evaluate(() => (window as unknown as { __order?: string[] }).__order ?? []);
  await expect.poll(order).toContain("window_print 5/5");
  await page.waitForTimeout(200);
  expect((await order()).filter((c) => c.startsWith("window_print"))).toHaveLength(1);

  // Out of sight on screen.
  const root = page.locator(".print-root");
  await expect(root).toBeHidden();

  await page.emulateMedia({ media: "print" });
  await expect(root).toBeVisible();
  await expect(page.locator("#root")).toBeHidden();
  await expect(root.locator(".print-subject")).toHaveText("Lisbon in May?");
  await expect(root.locator(".print-count")).toHaveText("5 messages");
  const frames = root.locator("iframe");
  await expect(frames).toHaveCount(5);
  for (const frame of await frames.all()) {
    const [height, content] = await frame.evaluate((f: HTMLIFrameElement) => [
      f.getBoundingClientRect().height,
      f.contentDocument!.documentElement.scrollHeight,
    ]);
    expect(height).toBeGreaterThan(100);
    expect(Math.abs(height - content)).toBeLessThanOrEqual(1);
  }
});
