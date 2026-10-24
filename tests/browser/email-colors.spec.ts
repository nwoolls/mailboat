import { expect, test } from "@playwright/test";

/**
 * "Original colors" floated over the top right of the email and hid the
 * end of its first line (owner, 2026-10-21 and 10-24: "obscuring email
 * text isn't an option"). It now sits in the line above the email: beside
 * "Block images" when that's shown, or on a line of its own.
 */
for (const [colors, what] of [
  ["1", "beside Block images"],
  ["2", "on its own line"],
] as const)
  test(`the colors switch sits above the email, ${what}`, async ({ page }) => {
    await page.goto(`/tests/browser/harness.html?mode=inline&colors=${colors}`);
    const frame = page.getByTitle("Message content");
    await expect(frame).toBeVisible();
    const button = page.getByRole("button", { name: "Original colors" });
    await expect(button).toBeVisible();
    await expect(page.getByRole("button", { name: "Block images" })).toHaveCount(
      colors === "1" ? 1 : 0,
    );
    const b = (await button.boundingBox())!;
    const f = (await frame.boundingBox())!;
    expect(b.y + b.height).toBeLessThanOrEqual(f.y);
  });
