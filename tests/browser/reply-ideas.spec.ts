import { expect, type Page, test } from "@playwright/test";

/**
 * Reply with AI (owner, 2026-10-24): the reply ideas arrive a few seconds
 * after the reply has scrolled into view, usually in two rows, while the
 * stand-ins took one, so the reply was pushed down. The stand-ins now
 * take two rows, and the ideas' space stays that tall.
 */
function chipArea(page: Page) {
  return page.getByRole("complementary", { name: "Write with AI" }).locator(".flex-wrap");
}

for (const width of [760, 420])
  test(`${width}px reader: the ideas don't change the panel's height`, async ({ page }) => {
    // The ideas wait for the test (`&ideas=held`): when they came 800 ms
    // after the click, a busy runner sometimes looked later than that and
    // found the stand-ins already gone (docs/ROADMAP.md → Flaky tests).
    await page.goto("/tests/browser/harness.html?mode=inline&ideas=held");
    await expect(page.getByTitle("Message content")).toBeVisible();
    await page.evaluate((w) => {
      document.querySelector<HTMLElement>("#root > div")!.style.width = `${w}px`;
    }, width);
    await page.getByRole("button", { name: "Reply with AI", exact: true }).click();
    const area = chipArea(page);
    // The stand-ins, in two rows.
    await expect(area.locator("span[aria-hidden]")).toHaveCount(3);
    const tops = await area
      .locator("span[aria-hidden]")
      .evaluateAll(
        (els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().top))).size,
      );
    expect(tops).toBe(2);
    const before = (await area.boundingBox())!.height;
    // The ideas arrive, once the app has asked for them.
    await expect.poll(() => page.evaluate(() => "__releaseIdeas" in window)).toBe(true);
    await page.evaluate(() =>
      (window as unknown as { __releaseIdeas: () => void }).__releaseIdeas(),
    );
    await expect(area.getByRole("button", { name: "Say yes" })).toBeVisible();
    expect((await area.boundingBox())!.height).toBe(before);
  });
