import { expect, type Page, test } from "@playwright/test";

/**
 * Toolbar motion (0.3.0, owner): starring spins the star; only a change on
 * the same conversations plays it, not choosing another conversation or
 * the star coming back from the More menu. The read button shows Mark as
 * unread from the start for an unread conversation opening marks read, so
 * it doesn't switch on every click (owner). Buttons moving into and out of the More
 * menu as the window narrows and widens fade, rather than vanish.
 */
const starIcon = (page: Page) =>
  page
    .locator(
      "[data-toolbar-end] button[aria-label^='Star'], [data-toolbar-end] button[aria-label^='Unstar']",
    )
    .locator("span")
    .first();
const readButton = (page: Page) => page.locator("[data-toolbar-end] button[aria-label^='Mark as']");
/** The CSS animation an element runs. */
const animation = (el: Element) => getComputedStyle(el).animationName;
const running = (page: Page) => starIcon(page).evaluate((el) => el.getAnimations().length);

async function open(page: Page) {
  await page.setViewportSize({ width: 1400, height: 800 });
  await page.goto("/tests/browser/harness.html?mode=shell&rows=1");
  await page.getByRole("option").first().click();
}

test("starring spins the star; picking another conversation doesn't", async ({ page }) => {
  await open(page);
  await expect(starIcon(page)).not.toHaveClass(/icon-spin/);
  await page.keyboard.press("s");
  await expect(starIcon(page)).toHaveClass(/icon-spin\b/);
  // Another conversation (not starred) once the spin is over: nothing
  // plays, though the star's state changed.
  await page.waitForTimeout(600);
  await page.getByRole("option").nth(2).click();
  await expect(page.locator("[data-toolbar-end] button[aria-label^='Star']")).toBeVisible();
  expect(await running(page)).toBe(0);
});

test("the star doesn't spin again when it comes back from the More menu", async ({ page }) => {
  await open(page);
  await page.keyboard.press("s");
  await page.waitForTimeout(600);
  // Narrow enough that the star moves into More, then wide again.
  await page.setViewportSize({ width: 560, height: 800 });
  await expect(starIcon(page)).toHaveCount(0);
  await page.setViewportSize({ width: 1400, height: 800 });
  await expect(starIcon(page)).toBeVisible();
  expect(await starIcon(page).getAttribute("class")).not.toMatch(/icon-spin/);
});

test("the read button doesn't flicker when opening an unread conversation", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 800 });
  // `threads=distinct`: each conversation opens read or unread as its row
  // is, so opening an unread one really marks it read.
  await page.goto("/tests/browser/harness.html?mode=shell&rows=1&threads=distinct");
  const rows = page.locator('[role="option"]');
  const read = rows.filter({ hasNot: page.locator(".font-semibold") });
  const icon = () => readButton(page).locator("span").first().locator("svg").innerHTML();
  // A read conversation: Mark as unread, the closed envelope.
  await read.first().click();
  await expect(readButton(page)).toHaveAttribute("aria-label", /Mark as unread/);
  const closed = await icon();
  // An unread one, which opening marks read: the closed envelope from the
  // start (the owner's rule, with "on open" reading), never the open one,
  // through to its being marked read.
  await page.evaluate(() => {
    const seen = new Set<string>();
    (window as unknown as { readIcons: Set<string> }).readIcons = seen;
    const header = document.querySelector("header")!;
    const note = () => {
      const svg = header.querySelector("[data-toolbar-end] button[aria-label^='Mark as'] span svg");
      if (svg) seen.add(svg.innerHTML);
    };
    new MutationObserver(note).observe(header, {
      subtree: true,
      childList: true,
      attributes: true,
    });
  });
  // By position: once read, it no longer matches `unread`.
  const all = await rows.evaluateAll((els) =>
    els.map((el) => !!el.querySelector(".font-semibold")),
  );
  const target = rows.nth(all.indexOf(true));
  await target.click();
  // Marked read by opening: the button now says Mark as unread.
  await expect(readButton(page)).toHaveAttribute("aria-label", /Mark as unread/);
  expect(
    await page.evaluate(() => [...(window as unknown as { readIcons: Set<string> }).readIcons]),
  ).toEqual([closed]);
  // Marked by hand from then on, the button follows what it will do:
  // unread now, which shows Mark as read with the open one, then read.
  await page.keyboard.press("u");
  await expect(readButton(page)).toHaveAttribute("aria-label", /Mark as read/);
  expect(await icon()).not.toBe(closed);
  await page.keyboard.press("u");
  await expect(readButton(page)).toHaveAttribute("aria-label", /Mark as unread/);
  expect(await icon()).toBe(closed);
});

test("buttons fade out into the More menu and fade back in", async ({ page }) => {
  await open(page);
  const bar = page.locator("header").first();
  // Each copy, as it's added: where it sits, against the bar.
  await page.evaluate(() => {
    const placed: { left: number; right: number; bar: number }[] = [];
    (window as unknown as { ghosts: typeof placed }).ghosts = placed;
    const header = document.querySelector("header")!;
    new MutationObserver((changes) => {
      for (const c of changes)
        for (const n of c.addedNodes)
          if (n instanceof HTMLElement && n.classList.contains("tool-leave")) {
            const r = n.getBoundingClientRect();
            placed.push({
              left: r.left,
              right: r.right,
              bar: header.getBoundingClientRect().right,
            });
          }
    }).observe(header, { childList: true });
  });
  await page.setViewportSize({ width: 560, height: 800 });
  const placed = () =>
    page.evaluate(
      () =>
        (window as unknown as { ghosts: { left: number; right: number; bar: number }[] }).ghosts,
    );
  // A copy fades out where each button was, then goes. Read from the
  // record, not looked for on screen: a copy lives about 160 ms, which a
  // slow runner's check can miss (docs/ROADMAP.md → Flaky tests).
  await expect.poll(async () => (await placed()).length).toBeGreaterThan(0);
  await expect(bar.locator(".tool-leave")).toHaveCount(0);
  const ghosts = await placed();
  // In the bar's right half, where the buttons were, not pushed off it.
  for (const g of ghosts) {
    expect(g.right).toBeLessThanOrEqual(g.bar);
    expect(g.left).toBeGreaterThan(g.bar / 2);
  }
  await page.setViewportSize({ width: 1400, height: 800 });
  await expect(
    page.locator("[data-toolbar-end] [data-overflow].tool-appear").first(),
  ).toBeVisible();
});

test("Archive and Move to Inbox cross-fade, and so do the read envelopes", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 800 });
  await page.goto("/tests/browser/harness.html?mode=shell&rows=1");
  // In All Mail an archived conversation stays, so its button turns into
  // Move to Inbox on the same conversation.
  const nav = page.locator("nav").first();
  await nav.getByRole("button", { name: "More", exact: true }).click();
  await nav.getByRole("button", { name: "All Mail", exact: true }).click();
  await page.getByRole("option").first().click();
  const archive = page.locator("[data-toolbar-end] button").first();
  await expect(archive).toHaveAttribute("aria-label", /^Archive/);
  await expect(archive.locator("span").first()).not.toHaveClass(/icon-swap/);
  await page.keyboard.press("e");
  await expect(archive).toHaveAttribute("aria-label", /^Move to Inbox/);
  await expect(archive.locator("span").first()).toHaveClass(/icon-swap/);
  // Both icons, the new one fading in and the old one out over it.
  await expect(archive.locator(".icon-swap-out")).toHaveCount(1);
  expect(await archive.locator("span").first().evaluate(animation)).toBe("icon-swap");
  expect(await archive.locator(".icon-swap-out").evaluate(animation)).toBe("icon-swap-out");
  // The read envelope, marked by hand.
  await page.keyboard.press("u");
  await page.keyboard.press("u");
  await expect(readButton(page).locator("span").first()).toHaveClass(/icon-swap/);
});
