import { expect, test } from "@playwright/test";

/**
 * A new message's subject line is a one-line editor, not a text box
 * (docs/ROADMAP.md → 0.4.0 → Templates). Editors behave differently in
 * WebView2, so its text-box behavior is checked here too, in Chromium with
 * the Windows styles on: typing, a paste of several lines kept on one, Return
 * sending (here asking for a recipient), and Tab moving on to the message.
 */
test("the subject line behaves as a text box did", async ({ page }) => {
  await page.goto("/tests/browser/harness.html?mode=card");
  await page.evaluate(() => (document.documentElement.dataset.platform = "windows"));
  const card = page.locator("section.compose-card");
  const subject = card.getByRole("textbox", { name: "Subject" });
  await subject.click();
  await page.keyboard.type("Lunch on Friday?");
  await expect(subject).toHaveText("Lunch on Friday?");

  await page.keyboard.press("ControlOrMeta+A");
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text/plain", "Two\nlines");
    document.activeElement?.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
  });
  await expect(subject).toHaveText("Two lines");
  await expect(subject.locator("p")).toHaveCount(1);

  await page.keyboard.press("Enter");
  await expect(card.getByRole("alert")).toHaveText("Add at least one recipient.");
  await expect(subject.locator("p")).toHaveCount(1);

  await page.keyboard.press("Tab");
  await expect(card.getByRole("textbox", { name: "Message" })).toBeFocused();
});
