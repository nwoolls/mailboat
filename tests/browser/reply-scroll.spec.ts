import { expect, type Page, test } from "@playwright/test";

/**
 * Reply with AI (owner reports, 2026-10-22 and 10-24): the reader stopped
 * partway down the last email, or showed only the AI chat with the reply
 * below it. The reply, down to its Send button, should end up in view,
 * and all of it when it fits.
 */
async function replyInView(page: Page) {
  return page.evaluate(() => {
    const reader = document.querySelector(".reader-scroll")!.getBoundingClientRect();
    const reply = document.querySelector('section[aria-label="Reply"]')!.getBoundingClientRect();
    return {
      top: reply.top - reader.top,
      bottom: reader.bottom - reply.bottom,
      fits: reply.height <= reader.height,
    };
  });
}

for (const height of [640, 360])
  for (const button of ["Reply", "Reply with AI"]) {
    test(`${button}, ${height}px reader: the reply scrolls into view`, async ({ page }) => {
      await page.goto("/tests/browser/harness.html?mode=inline");
      await expect(page.getByTitle("Message content")).toBeVisible();
      await page.evaluate((h) => {
        document.querySelector<HTMLElement>("#root > div")!.style.height = `${h}px`;
      }, height);
      await page.getByRole("button", { name: button, exact: true }).click();
      await expect(page.locator('section[aria-label="Reply"]')).toBeVisible();
      // The smooth scroll and the panel's reveal take a moment, longer on a
      // slow machine (CI): not a fixed wait then one look (it once found the
      // reply 397 px above the reader mid-scroll), but polled until the reply
      // is in view: its end (the Send button) always, all of it when it fits.
      const inView = async () => {
        const { top, bottom, fits } = await replyInView(page);
        return bottom >= -1 && (!fits || top >= -1);
      };
      await expect
        .poll(inView, { message: "the reply scrolls into view", timeout: 15_000 })
        .toBe(true);
      // And it stays there: a scroll that overshot or came back would show now.
      await page.waitForTimeout(600);
      const { top, bottom, fits } = await replyInView(page);
      expect(bottom).toBeGreaterThanOrEqual(-1);
      if (fits) expect(top).toBeGreaterThanOrEqual(-1);
    });
  }
