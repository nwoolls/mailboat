import { expect, test } from "@playwright/test";

/**
 * Many attachments (owner report, 2026-10-22): each chip took room from
 * the writing area until almost none was left. The chips now scroll past
 * two rows, and the writing area keeps a few lines.
 */
test("many attachments leave room to write", async ({ page }) => {
  await page.goto("/tests/browser/harness.html?mode=card");
  const form = page.getByRole("form", { name: "New message" });
  await expect(form).toBeVisible();
  const files = Array.from({ length: 30 }, (_, i) => ({
    name: `scan-${String(i + 1).padStart(2, "0")}-of-the-signed-contract.pdf`,
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4"),
  }));
  await form.getByLabel("Attach files").setInputFiles(files);
  const chips = form.getByRole("list", { name: "Attachments" });
  await expect(chips.getByRole("listitem")).toHaveCount(30);
  expect((await chips.boundingBox())!.height).toBeLessThanOrEqual(80);
  // The writing area: the editor's scrolling box, not its (empty) text.
  const room = await form
    .locator(".ProseMirror")
    .evaluate((el) => el.closest(".overflow-y-auto")!.getBoundingClientRect().height);
  expect(room).toBeGreaterThanOrEqual(100);
});
