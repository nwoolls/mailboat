import { expect, test } from "@playwright/test";

/**
 * Recent searches (Milestone 8, owner request 2026-10-19): offered when
 * the search box is focused, narrowed by typing, picked by keys or click,
 * removed one at a time or all, and drawn above the panel below.
 */
test("recent searches are offered, picked, saved and removed", async ({ page }) => {
  await page.goto("/tests/browser/harness.html?mode=search");
  const box = page.getByRole("searchbox", { name: "Search mail" });
  const list = page.getByRole("listbox", { name: "Recent searches" });
  const searching = page.getByRole("status", { name: "Searching for" });

  await box.focus();
  await expect(list.getByRole("option")).toHaveText(["invoice march", "from:sam", "Invoice"]);
  // Above the panel under the title bar, not hidden behind it.
  const option = list.getByRole("option").first();
  const at = (await option.boundingBox())!;
  const top = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x!, y!)?.closest("[role=option]")?.textContent,
    [at.x + 20, at.y + at.height / 2],
  );
  expect(top).toBe("invoice march");

  // Typing narrows it; ↓ and Return pick.
  await box.fill("invo");
  await expect(list.getByRole("option")).toHaveText(["invoice march", "Invoice"]);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(searching).toHaveText("invoice march");
  await expect(list).toBeHidden();

  // Return saves a new search at the top.
  await box.fill("budget");
  await page.keyboard.press("Enter");
  await box.fill("");
  await expect(list.getByRole("option").first()).toHaveText("budget");

  // Esc puts the list away first, leaving the focus in the box.
  await page.keyboard.press("Escape");
  await expect(list).toBeHidden();
  await expect(box).toBeFocused();

  // Remove one, then clear the rest.
  await box.blur();
  await box.focus();
  await list.getByRole("option", { name: /from:sam/ }).hover();
  await page.getByRole("button", { name: "Remove “from:sam”" }).click();
  await expect(list.getByRole("option", { name: /from:sam/ })).toHaveCount(0);
  await expect(box).toBeFocused();
  await page.getByRole("button", { name: "Clear recent searches" }).click();
  await expect(list).toBeHidden();
  // Gone for good, not just from the list on screen.
  expect(await page.evaluate(() => localStorage.getItem("mailboat.searchHistory"))).toBe("[]");
});
