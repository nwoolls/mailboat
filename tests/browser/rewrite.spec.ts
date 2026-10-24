import { expect, test } from "@playwright/test";

/**
 * Rewrite in the composer's formatting bar (AI Spike 2): off until text
 * is selected; a choice sends only the selection and puts the answer in
 * its place, inside the same paragraph; one ⌘Z puts it back. (The harness
 * has no toast, so its Undo isn't clicked here.)
 * The fake `ai_rewrite` answers with the text in capitals.
 */
test("rewrites only the selected words, in place, and undoes", async ({ page }) => {
  await page.goto("/tests/browser/harness.html?mode=card");
  const editor = page.getByRole("textbox", { name: "Message" });
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.type("Hi Sam, send the report by fri. Thanks");

  const button = page.getByRole("button", { name: /^Rewrite/ });
  await expect(button).toBeDisabled();

  // Select "send the report by fri" (22 characters, before ". Thanks").
  await page.keyboard.press("End");
  for (let i = 0; i < ". Thanks".length; i++) await page.keyboard.press("ArrowLeft");
  for (let i = 0; i < "send the report by fri".length; i++)
    await page.keyboard.press("Shift+ArrowLeft");
  await expect(button).toBeEnabled();

  await button.click();
  await page.getByRole("menuitem", { name: "Shorter" }).click();
  await expect(editor).toHaveText("Hi Sam, SEND THE REPORT BY FRI. Thanks");
  // Still one paragraph: the words went back inside it.
  await expect(editor.locator("p")).toHaveCount(1);

  await page.keyboard.press("Meta+z");
  await expect(editor).toHaveText("Hi Sam, send the report by fri. Thanks");
});
