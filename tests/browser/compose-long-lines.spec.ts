import { expect, test } from "@playwright/test";

/**
 * A reply with a long unbroken line (a row of "=" under a quoted
 * disclaimer, a long link) stays as wide as the reader: the line breaks at
 * the edge. It made the reply wider than the reader, which then scrolled
 * sideways to keep the cursor in view, cutting off the left of every email
 * and of the reply (owner, 2026-11-19).
 */
test("a long unbroken line in a reply wraps instead of widening the reader", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto("/tests/browser/harness.html?mode=inline");
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  const editor = page
    .locator('section[aria-label="Reply"]')
    .getByRole("textbox", { name: "Message" });
  await expect(editor).toBeFocused();
  // Pasted, as from another app.
  await editor.evaluate(
    (el, text) => {
      const data = new DataTransfer();
      data.setData("text/plain", text);
      el.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
      );
    },
    `Thanks, Maya.\n\n${"=".repeat(140)}\nSee https://example.com/notices/${"x".repeat(120)} for details.\n${"=".repeat(140)}`,
  );
  await page.keyboard.press("End");
  await page.waitForTimeout(200);
  const reader = page.locator(".reader-scroll");
  const { scrollWidth, clientWidth, scrollLeft } = await reader.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
    scrollLeft: el.scrollLeft,
  }));
  expect(scrollLeft).toBe(0);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  // Every line of the reply ends inside it.
  const overflow = await editor.evaluate((el) => {
    const right = el.getBoundingClientRect().right;
    return Math.max(
      ...[...el.querySelectorAll("p")].map((p) => p.getBoundingClientRect().right - right),
    );
  });
  expect(overflow).toBeLessThanOrEqual(1);
});
