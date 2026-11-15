import { expect, test } from "@playwright/test";

/**
 * Taking an address out of compose's suggestions: the × on the
 * highlighted suggestion or Shift+Delete, with Undo, and Settings →
 * Composing lists it with Restore.
 */
const open = "/tests/browser/harness.html?mode=card&contacts=demo&settings=composing";

test("the × takes a suggestion out, and Undo brings it back", async ({ page }) => {
  await page.goto(open);
  const to = page.getByRole("combobox", { name: "To" });
  await to.click();
  await to.pressSequentially("pri");
  const options = page.getByRole("listbox").getByRole("option");
  await expect(options).toHaveCount(2);
  // The × shows on the highlighted one only.
  const remove = page.getByRole("button", { name: /from suggestions$/ });
  await expect(remove).toHaveCount(1);
  await expect(remove).toHaveAccessibleName("Remove priya@x.example from suggestions");
  await remove.click();
  await expect(options).toHaveCount(1);
  await expect(options.first()).toContainText("priya.r@y.example");
  // Still typing in the To line.
  await expect(to).toBeFocused();
  await expect(to).toHaveValue("pri");
  await expect(page.getByText("priya@x.example won't be suggested")).toBeVisible();
  // Settings lists it meanwhile.
  await expect(
    page.getByRole("button", { name: "Restore priya@x.example to suggestions" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  // (Clicking Undo left the line, which made what was typed a chip.)
  await to.click();
  await to.pressSequentially("pri");
  await expect(options).toHaveCount(2);
  await expect(page.getByRole("button", { name: /^Restore / })).toHaveCount(0);
});

test("Shift+Delete takes the highlighted one out; Settings restores it", async ({ page }) => {
  await page.goto(open);
  const to = page.getByRole("combobox", { name: "To" });
  await to.click();
  await to.pressSequentially("pri");
  const options = page.getByRole("listbox").getByRole("option");
  await page.keyboard.press("ArrowDown");
  await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Shift+Delete");
  await expect(options).toHaveCount(1);
  await expect(options.first()).toContainText("priya@x.example");
  // Text in the box is untouched.
  await expect(to).toHaveValue("pri");
  // Plain Delete is just editing.
  await page.keyboard.press("Delete");
  await expect(options).toHaveCount(1);
  await expect(to).toHaveValue("pri");
  await page.getByRole("button", { name: "Restore priya.r@y.example to suggestions" }).click();
  await expect(page.getByRole("button", { name: /^Restore / })).toHaveCount(0);
  await to.click();
  await to.pressSequentially("pri");
  await expect(options).toHaveCount(2);
});
