import { expect, type Page, test } from "@playwright/test";

/**
 * Clicking the folder already shown (owner, 2026-11-12, as in Apple Mail):
 * the preview and the selected row stay. During a search it only clears the
 * search, as the search box's clear button does. Another folder still
 * closes the preview. The whole window with the demo's Inbox listed.
 */
async function previewFirst(page: Page) {
  await page.goto("/tests/browser/harness.html?mode=shell&rows=1");
  const first = page.getByRole("option").first();
  await first.click();
  await expect(page.locator(".reader-scroll")).toBeVisible();
  return first;
}

const inbox = (page: Page) => page.getByRole("button", { name: "Inbox", exact: true }).first();

test("clicking the folder shown leaves the preview and the selected row", async ({ page }) => {
  const first = await previewFirst(page);
  await inbox(page).click();
  await expect(page.locator(".reader-scroll")).toBeVisible();
  await expect(first).toHaveAttribute("aria-selected", "true");
});

test("during a search, clicking the folder shown only clears the search", async ({ page }) => {
  await page.goto("/tests/browser/harness.html?mode=shell&rows=1");
  await page
    .getByRole("combobox", { name: "Search mail" })
    .or(page.getByLabel("Search mail"))
    .first()
    .fill("lisbon");
  const first = page.getByRole("option").first();
  const id = await first.getAttribute("data-thread-id");
  await first.click();
  await expect(page.locator(".reader-scroll")).toBeVisible();
  await inbox(page).click();
  await expect(page.getByLabel("Search mail").first()).toHaveValue("");
  // Still previewed and selected, in the folder's list now.
  await expect(page.locator(`[data-thread-id="${id}"]`)).toHaveAttribute("aria-selected", "true");
});

test("clicking another folder still closes the preview", async ({ page }) => {
  await previewFirst(page);
  await page.getByRole("button", { name: "Starred", exact: true }).first().click();
  // Nothing previewed or selected any more (the reader slides closed).
  await expect(page.locator('[role="option"][aria-selected="true"]')).toHaveCount(0);
});
