import { expect, type Page, test } from "@playwright/test";

/**
 * Reading with the keyboard (owner, 2026-10-24): `n` / `p` bring the next
 * or previous email to the top of the reader, opening a folded one, and
 * Space / ⇧Space page through it. Five emails, the first three read and
 * folded; it opens at the first unread one (13).
 */
async function topEmail(page: Page) {
  return page.evaluate(() => {
    const reader = document.querySelector(".reader-scroll")!;
    const top = reader.getBoundingClientRect().top;
    const cards = [...reader.querySelectorAll<HTMLElement>("section[data-message-id]")];
    return cards.find((c) => Math.abs(c.getBoundingClientRect().top - top) <= 1)?.dataset.messageId;
  });
}

test("n and p step through the emails, opening folded ones", async ({ page }) => {
  await page.goto("/tests/browser/harness.html?mode=unread");
  await expect(page.locator('section[data-message-id="13"]')).toBeVisible();
  await page.waitForTimeout(1700);
  await expect.poll(() => topEmail(page)).toBe("13");
  await page.keyboard.press("p");
  await expect.poll(() => topEmail(page)).toBe("12");
  await expect(page.locator('section[data-message-id="12"] > button')).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await page.keyboard.press("n");
  await expect.poll(() => topEmail(page)).toBe("13");
  await page.keyboard.press("n");
  await expect.poll(() => topEmail(page)).toBe("14");
});

for (const ms of [40, 80, 120, 160, 200]) {
  test(`n ${ms}ms after p steps on, while the email is still opening`, async ({ page }) => {
    // While `p` holds an email at the top as it opens, it wobbles by a
    // pixel or so; `n` then took it for the next one and went nowhere.
    await page.goto("/tests/browser/harness.html?mode=unread");
    await expect(page.locator('section[data-message-id="13"]')).toBeVisible();
    await page.waitForTimeout(1700);
    await page.keyboard.press("p");
    await page.waitForTimeout(ms);
    await page.keyboard.press("n");
    await expect.poll(() => topEmail(page), { timeout: 1500 }).toBe("13");
  });
}

test("an email removed while n / p holds it leaves the reader where it is", async ({ page }) => {
  // Code review R4-06: a removed email measures as 0, and the hold kept
  // aligning to it, scrolling the reader away. Only shows with the reader
  // below the top of the window, as in the app.
  await page.goto("/tests/browser/harness.html?mode=unread");
  await expect(page.locator('section[data-message-id="13"]')).toBeVisible();
  await page.evaluate(() => {
    document.querySelector<HTMLElement>("#root")!.style.paddingTop = "150px";
  });
  await page.waitForTimeout(1700);
  await page.keyboard.press("n");
  await expect.poll(() => topEmail(page)).toBe("14");
  await page.waitForTimeout(500);
  await page.keyboard.press("p");
  const moved = await page.evaluate(async () => {
    const reader = document.querySelector<HTMLElement>(".reader-scroll")!;
    document.querySelector('section[data-message-id="13"]')!.remove();
    const before = reader.scrollTop;
    await new Promise((done) => setTimeout(done, 400));
    return { before, after: reader.scrollTop };
  });
  expect(moved.before).toBeGreaterThan(100);
  expect(moved.after).toBe(moved.before);
});

test("Space and ⇧Space page through the open email", async ({ page }) => {
  await page.goto("/tests/browser/harness.html?mode=unread");
  await expect(page.locator('section[data-message-id="13"]')).toBeVisible();
  await page.waitForTimeout(1700);
  const scrollTop = () => page.locator(".reader-scroll").evaluate((el) => el.scrollTop);
  const start = await scrollTop();
  await page.keyboard.press("Space");
  await expect.poll(scrollTop).toBeGreaterThan(start + 400);
  await page.keyboard.press("Shift+Space");
  await expect.poll(scrollTop).toBeLessThan(start + 5);
});
