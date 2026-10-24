import { expect, test } from "@playwright/test";

/**
 * Choosing "Search mail" in ⌘K focuses the search box (owner report,
 * 2026-10-24: it didn't). The action used to run while the palette's modal
 * dialog was still open, when the box couldn't take focus, and closing the
 * dialog then put focus back where it had been.
 */
for (const how of ["Return", "click"] as const) {
  test(`Search mail by ${how} focuses the search box`, async ({ page }) => {
    await page.goto("/tests/browser/harness.html?mode=palette");
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await expect(palette).toBeVisible();
    if (how === "Return") {
      await page.keyboard.type("search");
      await page.keyboard.press("Enter");
    } else {
      await palette.getByRole("option", { name: "Search mail" }).click();
    }
    await expect(palette).toBeHidden();
    await expect(page.getByRole("textbox", { name: "Search" })).toBeFocused();
  });
}
