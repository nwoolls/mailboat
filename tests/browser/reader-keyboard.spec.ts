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

/**
 * Esc from the conversation goes through the app's Esc rules: picked
 * conversations are dropped first, then back to the list, which takes
 * the keyboard (found in review: the conversation swallowed Esc).
 */
test("Esc in the conversation drops picked conversations first, then goes to the list", async ({
  page,
}) => {
  await preview(page);
  // Picks the previewed conversation (picked rows show as selected too, so
  // the first Esc keeping the outline is what shows the picks went first).
  await page.keyboard.press("x");
  await page.keyboard.press("ArrowRight");
  await expect(outlined(page)).toHaveCount(1);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  await expect(outlined(page)).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(outlined(page)).toHaveCount(0);
  await expect(page.locator('[role="listbox"][aria-label="Conversations"]')).toBeFocused();
  expect(await readerOpen(page)).toBe("true");
});

/** → on a focused splitter resizes; it doesn't move into the conversation (review). */
test("→ on a focused splitter doesn't take the keyboard into the conversation", async ({
  page,
}) => {
  await preview(page);
  await page.getByRole("separator").last().focus();
  await page.keyboard.press("ArrowRight");
  await expect(outlined(page)).toHaveCount(0);
  await expect(page.getByRole("separator").last()).toBeFocused();
});

/**
 * Keys in a menu over the conversation are the menu's, not the
 * conversation's (review: the email's menu and the outline both moved).
 */
test("keys in a menu inside the conversation don't move the outline", async ({ page }) => {
  await preview(page);
  await page.keyboard.press("ArrowRight");
  const before = await outlinedIndex(page);
  await page.evaluate(() => {
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.tabIndex = -1;
    document.querySelector(".reader-scroll > div")!.append(menu);
    menu.focus();
  });
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  expect(await outlinedIndex(page)).toBe(before);
});

/**
 * The outline scrolled out of view: the next arrow outlines the first
 * email showing and stops there, rather than moving past it at once (review).
 */
test("an arrow after the outline scrolled away outlines the first email showing", async ({
  page,
}) => {
  await preview(page);
  await page.keyboard.press("ArrowRight");
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowUp");
  await expect.poll(() => outlinedIndex(page)).toBe(0);
  // Scrolled down by hand (a wheel), well past the outlined email.
  const showing = await page.evaluate(async () => {
    const reader = document.querySelector<HTMLElement>(".reader-scroll")!;
    const emails = [...reader.querySelectorAll("section[data-message-id]")];
    // Into the middle of the tallest email, which fills the reader (the
    // reader stayed put on the next arrow only for an email that fit).
    const tall = emails.reduce((a, b) =>
      b.getBoundingClientRect().height > a.getBoundingClientRect().height ? b : a,
    );
    reader.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, bubbles: true }));
    reader.scrollTop += tall.getBoundingClientRect().top - reader.getBoundingClientRect().top + 300;
    // Past where the last arrow's scroll was heading, and its window.
    await new Promise((done) => setTimeout(done, 800));
    const top = reader.getBoundingClientRect().top;
    return emails.findIndex((c) => c.getBoundingClientRect().bottom > top);
  });
  const scrolled = await page.evaluate(() => document.querySelector(".reader-scroll")!.scrollTop);
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => outlinedIndex(page)).toBe(showing);
  // It's showing already, so the reader stays where it was scrolled to.
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => document.querySelector(".reader-scroll")!.scrollTop)).toBe(
    scrolled,
  );
});

/**
 * A click inside an email's text outlines that email, not the one outlined
 * before (review). The frame hands focus back to the email's holder
 * (`MessageFrame`); headless WebKit doesn't move focus into the frame on a
 * click, so the test does what the frame's hand-back does.
 */
test("a click inside an email's text outlines that email", async ({ page }) => {
  await preview(page);
  await page.keyboard.press("ArrowRight");
  const open = await page.evaluate(() =>
    [...document.querySelectorAll(".reader-scroll section[data-message-id]")].flatMap((c, i) =>
      c.querySelector('iframe[title="Message content"]') ? [i] : [],
    ),
  );
  expect(open.length).toBeGreaterThan(0);
  const target = open[open.length - 1]!;
  // Outline another email first.
  await page.keyboard.press("ArrowUp");
  await expect.poll(() => outlinedIndex(page)).not.toBe(target);
  await cards(page)
    .nth(target)
    .evaluate((card) => {
      const frame = card.querySelector('iframe[title="Message content"]')!;
      frame.closest<HTMLElement>('[tabindex="-1"]')!.focus({ preventScroll: true });
    });
  await expect.poll(() => outlinedIndex(page)).toBe(target);
});

/**
 * Back into the reply's text from its outline, the cursor is where it was:
 * typing lands in the middle, not at the start or end (review).
 */
test("Enter back into the reply keeps the cursor where it was", async ({ page }) => {
  await preview(page);
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  const reply = page.getByRole("region", { name: "Reply" });
  const text = reply.getByRole("textbox", { name: "Message" });
  await expect(text).toBeFocused();
  await page.keyboard.type("See you Friday");
  // The cursor after "See you".
  for (let i = 0; i < " Friday".length; i++) await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Escape");
  await expect(page.locator(".reader-scroll[data-outline-reply]")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(text).toBeFocused();
  await page.keyboard.type(" on");
  await expect(text).toContainText("See you on Friday");
});

/**
 * Focus on an email's header (Tab, or a click), then ↓: the outline moves
 * on and so does the keyboard, so Enter opens the outlined email, not the
 * header left behind (review).
 */
test("Enter after ↓ from a focused header opens the outlined email", async ({ page }) => {
  await preview(page);
  await page.keyboard.press("ArrowRight");
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowUp");
  await expect.poll(() => outlinedIndex(page)).toBe(0);
  const header = (i: number) => cards(page).nth(i).locator(":scope > button");
  await expect(header(0)).toHaveAttribute("aria-expanded", "false");
  await expect(header(1)).toHaveAttribute("aria-expanded", "false");
  await header(0).focus();
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => outlinedIndex(page)).toBe(1);
  await page.keyboard.press("Enter");
  await expect(header(1)).toHaveAttribute("aria-expanded", "true");
  await expect(header(0)).toHaveAttribute("aria-expanded", "false");
});

/**
 * An arrow's smooth scroll still on its way when the layout moves the
 * reader (an email above growing, which the browser makes up for by
 * moving the reader down): the next arrow goes on from where the reader
 * is, not from where the last one was heading (found in CI, where the
 * scroll was slower to arrive: ↓ jumped back up).
 */
test("an arrow after the layout moved the reader goes on from where it is", async ({ page }) => {
  await preview(page);
  await page.keyboard.press("ArrowRight");
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowUp");
  await expect.poll(() => outlinedIndex(page)).toBe(0);
  await page.keyboard.press("ArrowRight");
  await expect(cards(page).first().locator(":scope > button")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  const result = await page.evaluate(async () => {
    const reader = document.querySelector<HTMLElement>(".reader-scroll")!;
    const frame = () => new Promise((done) => requestAnimationFrame(done));
    // The first email made long, and the reader part way down it.
    const tall = document.createElement("div");
    tall.style.height = "3000px";
    reader.querySelector("section[data-message-id]")!.append(tall);
    reader.scrollTo({ top: 1500, behavior: "instant" });
    await frame();
    // ↑ starts a smooth scroll up through it; before it arrives, the
    // reader is moved well down, as the layout would.
    reader.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    await frame();
    reader.scrollTo({ top: 3000, behavior: "instant" });
    const moved = reader.scrollTop;
    reader.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await new Promise((done) => setTimeout(done, 600));
    return { moved, after: reader.scrollTop };
  });
  // On down from where the layout put it, not back up from the old aim.
  expect(result.after).toBeGreaterThan(result.moved);
});
