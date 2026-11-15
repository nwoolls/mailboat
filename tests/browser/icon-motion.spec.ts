import { expect, type Page, test } from "@playwright/test";

/**
 * Toolbar motion (0.3.0, owner): starring spins the star; only a change on
 * the same conversations plays it, not choosing another conversation or
 * the star coming back from the More menu. The read button shows Mark as
 * unread from the start for an unread conversation opening marks read, so
 * it doesn't switch on every click (owner). Buttons moving into and out of the More
 * menu as the window narrows and widens fade, rather than vanish.
 */
const starIcon = (page: Page) =>
  page
    .locator(
      "[data-toolbar-end] button[aria-label^='Star'], [data-toolbar-end] button[aria-label^='Unstar']",
    )
    .locator("span")
    .first();
const readButton = (page: Page) => page.locator("[data-toolbar-end] button[aria-label^='Mark as']");
const running = (page: Page) => starIcon(page).evaluate((el) => el.getAnimations().length);

async function open(page: Page) {
  await page.setViewportSize({ width: 1400, height: 800 });
  await page.goto("/tests/browser/harness.html?mode=shell&rows=1");
  await page.getByRole("option").first().click();
}

test("starring spins the star; picking another conversation doesn't", async ({ page }) => {
  await open(page);
  await expect(starIcon(page)).not.toHaveClass(/icon-spin/);
  await page.keyboard.press("s");
  await expect(starIcon(page)).toHaveClass(/icon-spin\b/);
  // Another conversation (not starred) once the spin is over: nothing
  // plays, though the star's state changed.
  await page.waitForTimeout(600);
  await page.getByRole("option").nth(2).click();
  await expect(page.locator("[data-toolbar-end] button[aria-label^='Star']")).toBeVisible();
  expect(await running(page)).toBe(0);
});

test("the star doesn't spin again when it comes back from the More menu", async ({ page }) => {
  await open(page);
  await page.keyboard.press("s");
  await page.waitForTimeout(600);
  // Narrow enough that the star moves into More, then wide again.
  await page.setViewportSize({ width: 560, height: 800 });
  await expect(starIcon(page)).toHaveCount(0);
  await page.setViewportSize({ width: 1400, height: 800 });
  await expect(starIcon(page)).toBeVisible();
  expect(await starIcon(page).getAttribute("class")).not.toMatch(/icon-spin/);
});

test("the read button doesn't flicker when opening an unread conversation", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 800 });
  await page.goto("/tests/browser/harness.html?mode=shell&rows=1");
  const rows = page.locator('[role="option"]');
  const unread = rows.filter({ has: page.locator(".font-semibold") });
  const read = rows.filter({ hasNot: page.locator(".font-semibold") });
  const icon = () => readButton(page).locator("svg").innerHTML();
  // A read conversation: Mark as unread, the closed envelope.
  await read.first().click();
  await expect(readButton(page)).toHaveAttribute("aria-label", /Mark as unread/);
  const closed = await icon();
  // An unread one, which opening marks read: the closed envelope from the
  // start (the owner's rule, with "on open" reading), not the open one first.
  await unread.first().click();
  await expect(readButton(page)).toHaveAttribute("aria-label", /Mark as read/);
  expect(await icon()).toBe(closed);
  // Marked by hand from then on, the button follows what it will do: read
  // now, then unread again, which shows Mark as read with the open one.
  await page.keyboard.press("u");
  await expect(readButton(page)).toHaveAttribute("aria-label", /Mark as unread/);
  expect(await icon()).toBe(closed);
  await page.keyboard.press("u");
  await expect(readButton(page)).toHaveAttribute("aria-label", /Mark as read/);
  expect(await icon()).not.toBe(closed);
});

test("buttons fade out into the More menu and fade back in", async ({ page }) => {
  await open(page);
  const bar = page.locator("header").first();
  await page.setViewportSize({ width: 560, height: 800 });
  // A copy fades out where each button was, then goes.
  await expect(bar.locator(".tool-leave").first()).toBeAttached();
  await expect(bar.locator(".tool-leave")).toHaveCount(0);
  await page.setViewportSize({ width: 1400, height: 800 });
  await expect(
    page.locator("[data-toolbar-end] [data-overflow].tool-appear").first(),
  ).toBeVisible();
});
