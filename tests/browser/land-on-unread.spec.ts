import { expect, test } from "@playwright/test";

/**
 * Opening a conversation lands on its first unread email (owner request,
 * 2026-10-22): read ones collapsed above, the first unread one's card at
 * the top of the reader, even though the expanded emails are measured
 * (and grow) after it opens.
 */
test("a conversation opens scrolled to its first unread email", async ({ page }) => {
  await page.goto("/tests/browser/harness.html?mode=unread");
  const card = page.locator('section[data-message-id="13"]');
  await expect(card).toBeVisible();
  await page.waitForTimeout(1200);
  const offset = await card.evaluate(
    (el) =>
      el.getBoundingClientRect().top - el.closest(".reader-scroll")!.getBoundingClientRect().top,
  );
  expect(Math.abs(offset)).toBeLessThanOrEqual(1);
});
