import { expect, test } from "@playwright/test";

/**
 * Windows with no AI set up (owner report, 2026-10-29): "Reply with AI" was
 * hidden but a new message's AI button still showed, and opened a panel with
 * an Apple Intelligence error and an empty list. The button now follows the
 * same rule: only while a writing provider is ready.
 */
test("a new message has an AI button while a writing provider is ready", async ({ page }) => {
  await page.goto("/tests/browser/harness.html?mode=card");
  await expect(page.getByRole("button", { name: "Write with AI" })).toBeVisible();
});

test("a new message has no AI button when no AI is set up", async ({ page }) => {
  await page.goto("/tests/browser/harness.html?mode=card&ai=none");
  await expect(
    page.getByRole("button", { name: "Attach files" }).or(page.getByText("New message")),
  ).toBeVisible();
  // Give the status a moment to arrive: the button must stay away, not just be late.
  await page.waitForTimeout(800);
  await expect(page.getByRole("button", { name: "Write with AI" })).toHaveCount(0);
});

test("the inline reply has an AI button while a writing provider is ready", async ({ page }) => {
  await page.goto("/tests/browser/harness.html?mode=inline");
  await expect(page.getByTitle("Message content").first()).toBeVisible();
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(page.locator('section[aria-label="Reply"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Write with AI" })).toBeVisible();
});

test("the inline reply has no AI button when no AI is set up", async ({ page }) => {
  await page.goto("/tests/browser/harness.html?mode=inline&ai=none");
  await expect(page.getByTitle("Message content").first()).toBeVisible();
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(page.locator('section[aria-label="Reply"]')).toBeVisible();
  await page.waitForTimeout(800);
  await expect(page.getByRole("button", { name: "Write with AI" })).toHaveCount(0);
});
