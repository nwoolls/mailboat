import { expect, type Page, test } from "@playwright/test";

/**
 * An open conversation with the keyboard (owner, 2026-11-23): → or Enter
 * from the list hands it the keyboard with an email outlined; ↑ / ↓ go
 * through the emails (reading down a long one first), → / ← open and
 * close the outlined one, and ← on a closed one or Esc go back to the
 * list. Esc in a reply's text hands the keyboard to the conversation.
 */
const outlined = (page: Page) => page.locator("section[data-outlined]");
const cards = (page: Page) => page.locator(".reader-scroll section[data-message-id]");
const readerOpen = (page: Page) =>
  page.locator(".panel-slide-content.from-right").first().getAttribute("data-open");
const outlinedIndex = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll(".reader-scroll section[data-message-id]")].findIndex((c) =>
      c.hasAttribute("data-outlined"),
    ),
  );

async function preview(page: Page) {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto("/tests/browser/harness.html?mode=shell&rows=1&conversation=all");
  await page.getByRole("option").first().click();
  await expect(cards(page).first()).toBeVisible();
  // Back on the list, as after a click on a row.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

test("→ hands the conversation the keyboard, ↑ / ↓ move the outline", async ({ page }) => {
  await preview(page);
  await expect(outlined(page)).toHaveCount(0);
  await page.keyboard.press("ArrowRight");
  await expect(outlined(page)).toHaveCount(1);
  const start = await outlinedIndex(page);
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect.poll(() => outlinedIndex(page)).toBe(0);
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => outlinedIndex(page)).toBe(1);
  // The list's selection didn't move meanwhile.
  await expect(page.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
  expect(start).toBeGreaterThanOrEqual(0);
});

test("→ opens the outlined email, ← closes it, ← again goes back to the list", async ({ page }) => {
  await preview(page);
  await page.keyboard.press("ArrowRight");
  // The first email is closed in a conversation opened at its newest.
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowUp");
  await expect.poll(() => outlinedIndex(page)).toBe(0);
  const header = cards(page).first().locator(":scope > button");
  const wasOpen = await header.getAttribute("aria-expanded");
  if (wasOpen === "true") await page.keyboard.press("ArrowLeft");
  await expect(header).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("ArrowRight");
  await expect(header).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("ArrowLeft");
  await expect(header).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("ArrowLeft");
  await expect(outlined(page)).toHaveCount(0);
  expect(await readerOpen(page)).toBe("true");
});

test("Esc goes back to the list, and the next Esc hides the reader", async ({ page }) => {
  await preview(page);
  await page.keyboard.press("Enter");
  await expect(outlined(page)).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(outlined(page)).toHaveCount(0);
  expect(await readerOpen(page)).toBe("true");
  await page.keyboard.press("Escape");
  await expect.poll(() => readerOpen(page)).toBe("false");
});

test("↓ reads down a long email before outlining the next", async ({ page }) => {
  await preview(page);
  await page.keyboard.press("ArrowRight");
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowUp");
  await expect.poll(() => outlinedIndex(page)).toBe(0);
  await page.keyboard.press("ArrowRight");
  // Made long, as a newsletter would be.
  await cards(page)
    .first()
    .evaluate((card) => {
      const tall = document.createElement("div");
      tall.style.height = "3000px";
      card.append(tall);
    });
  const before = await page.evaluate(() => document.querySelector(".reader-scroll")!.scrollTop);
  await page.keyboard.press("ArrowDown");
  await expect
    .poll(() => page.evaluate(() => document.querySelector(".reader-scroll")!.scrollTop))
    .toBeGreaterThan(before);
  expect(await outlinedIndex(page)).toBe(0);
});

test("a click in the conversation gives it the keyboard", async ({ page }) => {
  await preview(page);
  await page.locator(".reader-scroll h1").click();
  await page.keyboard.press("ArrowDown");
  await expect(outlined(page)).toHaveCount(1);
  await expect(page.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
});

test("Esc in a reply's text outlines the reply; ↑ / ↓ move from it and Enter goes back in", async ({
  page,
}) => {
  await preview(page);
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  const reply = page.getByRole("region", { name: "Reply" });
  const text = reply.getByRole("textbox", { name: "Message" });
  const replyOutlined = page.locator(".reader-scroll[data-outline-reply]");
  await expect(text).toBeFocused();
  await page.keyboard.type("Sounds good");
  await page.keyboard.press("Escape");
  // The reply itself is outlined, not an email.
  await expect(replyOutlined).toHaveCount(1);
  await expect(outlined(page)).toHaveCount(0);
  expect(await readerOpen(page)).toBe("true");
  await expect(reply).toContainText("Sounds good");
  // ↑ goes to the last email, ↓ back to the reply.
  await page.keyboard.press("ArrowUp");
  await expect(outlined(page)).toHaveCount(1);
  await expect(replyOutlined).toHaveCount(0);
  expect(await outlinedIndex(page)).toBe((await cards(page).count()) - 1);
  await page.keyboard.press("ArrowDown");
  await expect(replyOutlined).toHaveCount(1);
  // Enter puts the cursor back in the text, where the keys type again.
  await page.keyboard.press("Enter");
  await expect(text).toBeFocused();
  await expect(replyOutlined).toHaveCount(0);
  await page.keyboard.type(" then");
  await expect(reply).toContainText("then");
});
