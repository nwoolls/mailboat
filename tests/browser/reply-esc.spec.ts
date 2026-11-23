import { expect, type Page, test } from "@playwright/test";

/**
 * Esc in a reply's text (owner, 2026-11-22): one press leaves the text and
 * takes the next step at once (back to the list, or the reader hidden), as
 * two presses did; the first used to seem to do nothing. The reply stays
 * with its conversation, text and all, as a new message's card stays a
 * draft. Esc in the reply's other fields still only leaves the field.
 */
const reply = (page: Page) => page.getByRole("region", { name: "Reply" });
const readerOpen = (page: Page) =>
  page.locator(".panel-slide-content.from-right").first().getAttribute("data-open");
const listHidden = (page: Page) =>
  page
    .locator("section.panel")
    .first()
    .evaluate((el) => el.hasAttribute("inert") && el.getBoundingClientRect().width < 1);

async function openReply(page: Page, width: number) {
  await page.setViewportSize({ width, height: 700 });
  await page.goto("/tests/browser/harness.html?mode=shell&rows=1");
  await page.getByRole("option").first().click();
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(reply(page)).toBeVisible();
}

test("in a narrow window, one Esc in a reply goes back to the list, and the reply stays", async ({
  page,
}) => {
  await openReply(page, 480);
  await expect.poll(() => listHidden(page)).toBe(true);
  await page.keyboard.type("Sounds good");
  await page.keyboard.press("Escape");
  await expect.poll(() => listHidden(page)).toBe(false);
  // Back to the conversation: the reply is there, with its text.
  await page.getByRole("option").first().click();
  await expect(reply(page)).toContainText("Sounds good");
});

test("in a wide window, one Esc in a reply hides the reader", async ({ page }) => {
  await openReply(page, 1200);
  expect(await readerOpen(page)).toBe("true");
  await page.keyboard.press("Escape");
  await expect.poll(() => readerOpen(page)).toBe("false");
});

test("Esc in a reply's To field only leaves the field", async ({ page }) => {
  await openReply(page, 1200);
  await reply(page).getByRole("combobox", { name: "To" }).focus();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  expect(await readerOpen(page)).toBe("true");
});
