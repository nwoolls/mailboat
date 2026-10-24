import { expect, type Page, test } from "@playwright/test";

/**
 * Reply with AI (owner report, 2026-10-22): the reader stopped partway
 * down the last email, with the reply and the AI chat still below. The
 * whole reply (header to Send) should end up in view.
 */
async function replyInView(page: Page) {
  return page.evaluate(() => {
    const reader = document.querySelector(".reader-scroll")!.getBoundingClientRect();
    const reply = document.querySelector('section[aria-label="Reply"]')!.getBoundingClientRect();
    return { top: reply.top - reader.top, bottom: reader.bottom - reply.bottom };
  });
}

for (const button of ["Reply", "Reply with AI"]) {
  test(`${button}: the whole reply scrolls into view`, async ({ page }) => {
    await page.goto("/tests/browser/harness.html?mode=inline");
    await expect(page.getByTitle("Message content")).toBeVisible();
    await page.getByRole("button", { name: button, exact: true }).click();
    await expect(page.locator('section[aria-label="Reply"]')).toBeVisible();
    // Long enough for the smooth scroll and the panel's reveal to finish.
    await page.waitForTimeout(2500);
    const { top, bottom } = await replyInView(page);
    expect(top).toBeGreaterThanOrEqual(-1);
    expect(bottom).toBeGreaterThanOrEqual(-1);
  });
}
