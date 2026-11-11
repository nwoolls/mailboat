import { expect, test } from "@playwright/test";

/**
 * Settings → Signatures: a click anywhere in the signature's box puts the
 * cursor in the editor, not only a click on its text. The address here has
 * no signature yet, so all but the first line of the box is empty.
 */
test("a click on the empty part of the signature box starts typing there", async ({ page }) => {
  await page.goto("/tests/browser/harness.html?mode=shell");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Signatures" }).click();
  await page.getByRole("button", { name: "Add" }).click();
  const dialog = page.getByRole("dialog");
  const editor = dialog.getByRole("textbox", { name: "Message" });
  await expect(editor).toBeFocused();
  // Take the focus away, so only the click can bring it back.
  await dialog.getByRole("heading", { name: "Signature" }).click();
  await expect(editor).not.toBeFocused();

  const box = editor.locator("xpath=ancestor::div[contains(@class,'overflow-y-auto')][1]");
  const area = await box.boundingBox();
  const line = await editor.locator("p").first().boundingBox();
  if (!area || !line) throw new Error("the signature box isn't laid out");
  // Well below the first line, and near the box's right edge.
  expect(area.y + area.height - 10).toBeGreaterThan(line.y + line.height);
  await page.mouse.click(area.x + area.width - 10, area.y + area.height - 10);
  await expect(editor).toBeFocused();

  await page.keyboard.type("Maya Chen");
  await expect(editor).toHaveText("Maya Chen");

  // A long signature still stops at the box's height and scrolls in it.
  const before = area.height;
  await page.keyboard.type("\n".repeat(20));
  await expect.poll(() => box.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  const after = await box.boundingBox();
  expect(after?.height).toBeGreaterThan(before);
  expect(after?.height).toBeLessThanOrEqual(288);
});
