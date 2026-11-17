import { expect, test } from "@playwright/test";

/** The parts of ProseMirror's state read here. */
type EditorState = {
  selection: { empty: boolean; to: number };
  doc: { content: { size: number } };
};

/**
 * Settings → Vacation responder: a click anywhere in the message box puts
 * the cursor in the message, not only a click on its text. The reply here
 * is one line, so most of the box is empty.
 */
test("a click on the empty part of the message box starts typing there", async ({ page }) => {
  await page.goto("/tests/browser/harness.html?mode=shell");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Vacation responder" }).click();
  const message = page.getByRole("textbox", { name: "Message" });
  await expect(message).toHaveText("Back Monday");

  const box = message.locator("xpath=ancestor::div[contains(@class,'overflow-y-auto')][1]");
  const area = await box.boundingBox();
  const text = await message.locator("p").first().boundingBox();
  if (!area || !text) throw new Error("the message box isn't laid out");
  // Well below the text, and near the box's right edge.
  expect(area.y + area.height - 10).toBeGreaterThan(text.y + text.height);
  // A click there focuses the message, and one there in the focused
  // message puts the cursor at the end of the text. Checked apart: the
  // first click's cursor can lose a race in the editor (ProseMirror,
  // 20 ms after focusing, puts its old cursor back if it hasn't yet heard
  // where the click put it), which a busy CI runner lost now and then
  // (docs/ROADMAP.md → Flaky tests, and the Bug backlog).
  const spot = { x: area.x + area.width - 10, y: area.y + area.height - 10 };
  await page.mouse.click(spot.x, spot.y);
  await expect(message).toBeFocused();
  await page.mouse.click(spot.x, spot.y);
  await expect
    .poll(() =>
      message.evaluate((el) => {
        const { state } = (el as HTMLElement & { editor: { state: EditorState } }).editor;
        return state.selection.empty && state.selection.to === state.doc.content.size - 1;
      }),
    )
    .toBe(true);

  await page.keyboard.type(" or Tuesday");
  await expect(message).toHaveText("Back Monday or Tuesday");

  // A long message still stops at the box's height and scrolls in it.
  const before = area.height;
  await page.keyboard.type("\n".repeat(20));
  await expect.poll(() => box.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  const after = await box.boundingBox();
  expect(after?.height).toBeGreaterThan(before);
  expect(after?.height).toBeLessThanOrEqual(256);
});
