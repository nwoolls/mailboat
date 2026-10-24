import { expect, test } from "@playwright/test";

/**
 * Show original (Milestone 8): starts on the conversation's newest email,
 * summarises it with a failed check marked, keeps a long source scrolling
 * inside the dialog (which stays within the window), and switches email.
 */
test("shows the newest email's original, and others when picked", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.goto("/tests/browser/harness.html?mode=original");
  const dialog = page.getByRole("dialog", { name: "Original email" });
  await expect(dialog).toBeVisible();
  // The newest of the five (ids 10 to 14).
  await expect(dialog.locator("dd", { hasText: "Email 14" })).toBeVisible();
  await expect(dialog.locator("dd", { hasText: "FAIL with domain example.com" })).toHaveClass(
    /text-danger/,
  );
  await expect(dialog.locator("dd", { hasText: "PASS with domain example.com" })).not.toHaveClass(
    /text-danger/,
  );

  const box = await dialog.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(700);
  const source = dialog.locator("pre");
  const scrolls = await source.evaluate((el) => el.scrollHeight > el.clientHeight);
  expect(scrolls).toBe(true);
  await expect(dialog.getByRole("button", { name: "Download" })).toBeInViewport();

  await dialog.getByRole("combobox", { name: "Email" }).selectOption("11");
  await expect(dialog.locator("dd", { hasText: "Email 11" })).toBeVisible();
});
