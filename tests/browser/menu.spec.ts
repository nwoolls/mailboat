import { expect, test } from "@playwright/test";

/**
 * A menu with a very long item (owner report, 2026-10-21: "Block <long
 * address>" stretched the list's menu across most of the window) stays
 * capped, and the item is cut off with "…" with its full text on hover.
 */
test("a long item doesn't widen the menu", async ({ page }) => {
  await page.goto("/tests/browser/harness.html?mode=menu");
  const menu = page.getByRole("menu", { name: "Conversation" });
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(320);
  const label = menu.getByRole("menuitem", { name: /^Block / }).locator("span");
  const full = await label.getAttribute("title");
  expect(full).toMatch(/^Block .*@example\.com$/);
  // Cut off: its text is wider than the room it has.
  const cut = await label.evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(cut).toBe(true);
  // The short item keeps its key hint in view.
  await expect(menu.getByRole("menuitem", { name: /^Archive/ }).locator("kbd")).toBeInViewport();
});
