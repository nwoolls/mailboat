import { expect, test } from "@playwright/test";

/**
 * A new message in the floating composer: a click anywhere in the empty
 * space under the text puts the cursor in the message, not only a click on
 * its first line.
 */
test("a click on the empty part of a new message starts typing there", async ({ page }) => {
  await page.goto("/tests/browser/harness.html?mode=card");
  const card = page.locator("section.compose-card");
  const editor = card.getByRole("textbox", { name: "Message" });
  await expect(editor).toBeVisible();
  await card.getByRole("textbox", { name: "Subject" }).click();
  await expect(editor).not.toBeFocused();

  const box = editor.locator("xpath=ancestor::div[contains(@class,'overflow-y-auto')][1]");
  const area = await box.boundingBox();
  const line = await editor.locator("p").first().boundingBox();
  if (!area || !line) throw new Error("the message isn't laid out");
  expect(area.y + area.height - 10).toBeGreaterThan(line.y + line.height);
  await page.mouse.click(area.x + area.width - 10, area.y + area.height - 10);
  await expect(editor).toBeFocused();

  await page.keyboard.type("See you Monday");
  await expect(editor).toHaveText("See you Monday");

  // A long message scrolls in the same space, which keeps its size.
  await page.keyboard.type("\n".repeat(40));
  await expect.poll(() => box.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  expect((await box.boundingBox())?.height).toBe(area.height);
});
