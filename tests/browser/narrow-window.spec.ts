import { expect, type Page, test } from "@playwright/test";

/**
 * A narrower window (0.3.0, owner's choice from a mockup): the sidebar folds
 * away once it no longer fits beside the list and the reader, and its
 * button floats it instead; narrower still, the list and the reader take
 * turns, with a way back from the conversation. Toolbar buttons that don't
 * fit move into the More menu. Widening brings everything back.
 */

/** The docked sidebar: shown unless its column is folded away (inert). */
const dockedSidebar = (page: Page) => page.locator("nav").first();
const sidebarFolded = (page: Page) =>
  dockedSidebar(page).evaluate((nav) => nav.closest("[inert]") !== null);
const list = (page: Page) => page.locator("section.panel").first();
const listHidden = (page: Page) =>
  list(page).evaluate((el) => el.hasAttribute("inert") && el.getBoundingClientRect().width < 1);

async function open(page: Page, width: number) {
  await page.setViewportSize({ width, height: 700 });
  await page.goto("/tests/browser/harness.html?mode=shell&rows=1");
  await expect(page.getByRole("option").first()).toBeVisible();
}

test("a wide window shows everything, as before", async ({ page }) => {
  await open(page, 1200);
  expect(await sidebarFolded(page)).toBe(false);
  await page.getByRole("option").first().click();
  await expect(page.locator(".reader-scroll")).toBeVisible();
  expect(await listHidden(page)).toBe(false);
  await expect(page.getByTitle("Labels", { exact: false }).first()).toBeVisible();
});

test("a medium window folds the sidebar, which its button floats", async ({ page }) => {
  await open(page, 700);
  expect(await sidebarFolded(page)).toBe(true);
  // The list and the reader still sit side by side.
  await page.getByRole("option").first().click();
  await expect(page.locator(".reader-scroll")).toBeVisible();
  expect(await listHidden(page)).toBe(false);
  // The sidebar's button floats it over the list. A second click leaves it
  // there (hovering the button floats it too, so a click that put it away
  // fought the hover); the pointer leaving puts it away.
  const toggle = page.locator("[data-toolbar-start] button");
  const peek = page.locator(".sidebar-peek");
  await toggle.click();
  await expect(peek).toBeVisible();
  // Watched for the next 400ms: it never starts to slide away.
  await peek.evaluate((el) => {
    const w = window as unknown as { __peekLeft?: boolean };
    w.__peekLeft = false;
    new MutationObserver(() => {
      if (el.hasAttribute("data-leaving") || !el.isConnected) w.__peekLeft = true;
    }).observe(el, { attributes: true });
  });
  await toggle.click();
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => (window as unknown as { __peekLeft: boolean }).__peekLeft)).toBe(
    false,
  );
  await expect(peek).toBeVisible();
  await page.mouse.move(650, 400);
  await expect(peek).toHaveCount(0);
  // The keyboard shortcut still opens and closes it.
  await page.keyboard.press("Control+Meta+s");
  await expect(peek).toBeVisible();
  await page.keyboard.press("Control+Meta+s");
  await expect(peek).toHaveCount(0);
  // Widened, the sidebar is back where it was.
  await page.setViewportSize({ width: 1200, height: 700 });
  await expect.poll(() => sidebarFolded(page)).toBe(false);
});

test("a narrow window shows the list or the conversation, with a way back", async ({ page }) => {
  await open(page, 480);
  expect(await sidebarFolded(page)).toBe(true);
  // No reader button: there's no room to show both.
  await expect(page.locator('[data-toolbar-end] button[aria-label*="reader" i]')).toHaveCount(0);
  await page.getByRole("option").first().click();
  await expect(page.locator(".reader-scroll")).toBeVisible();
  await expect.poll(() => listHidden(page)).toBe(true);
  const back = page.getByRole("button", { name: "Back to Inbox" });
  await back.click();
  await expect.poll(() => listHidden(page)).toBe(false);
  // Esc and ⌘[ go back too.
  await page.getByRole("option").first().click();
  await expect.poll(() => listHidden(page)).toBe(true);
  await page.keyboard.press("Escape");
  await expect.poll(() => listHidden(page)).toBe(false);
  await page.getByRole("option").first().click();
  await expect.poll(() => listHidden(page)).toBe(true);
  await page.keyboard.press("Meta+BracketLeft");
  await expect.poll(() => listHidden(page)).toBe(false);
});

test("toolbar buttons that don't fit are in the More menu, and nothing overlaps", async ({
  page,
}) => {
  await open(page, 480);
  await page.getByRole("option").first().click();
  for (const name of ["Labels", "Star", "Spam"]) {
    await expect(page.locator(`[data-toolbar-end] button[aria-label^="${name}"]`)).toHaveCount(0);
  }
  await expect(page.locator('[data-toolbar-end] button[aria-label^="Archive"]')).toHaveCount(1);
  const [search, end] = await Promise.all([
    page.locator("#title-search").locator("..").boundingBox(),
    page.locator("[data-toolbar-end]").boundingBox(),
  ]);
  expect(search!.x + search!.width).toBeLessThanOrEqual(end!.x);
  await page.getByTitle("More", { exact: true }).click();
  const menu = page.getByRole("menu", { name: "More" });
  for (const name of [/^Labels/, /^Star/, /Mark as/, /^Report spam/]) {
    await expect(menu.getByRole("menuitem", { name })).toBeVisible();
  }
  // Trash is the last to go: at this width it still fits.
  await expect(menu.getByRole("menuitem", { name: /^Move to Trash/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 420, height: 700 });
  await expect(page.locator('[data-toolbar-end] button[aria-label^="Move to Trash"]')).toHaveCount(
    0,
  );
  await page.getByTitle("More", { exact: true }).click();
  await expect(menu.getByRole("menuitem", { name: /^Move to Trash/ })).toBeVisible();
  // Labels opens its picker from there.
  await menu.getByRole("menuitem", { name: /^Labels/ }).click();
  await expect(
    page.getByRole("dialog").or(page.getByRole("listbox", { name: /label/i })),
  ).toBeVisible();
});

test("the way back stays at the top of a long conversation, and is easy to hit", async ({
  page,
}) => {
  await page.setViewportSize({ width: 480, height: 600 });
  await page.goto("/tests/browser/harness.html?mode=shell&rows=1&conversation=all");
  await page.getByRole("option").first().click();
  const reader = page.locator(".reader-scroll");
  await expect(reader).toBeVisible();
  // Scrolled to the end once the conversation has loaded, and measured in
  // the same step, so the reader's own scrolling can't come between.
  const at = () =>
    reader.evaluate((el) => {
      el.scrollTo(0, el.scrollHeight);
      const bar = el.querySelector(".reader-back button")!.getBoundingClientRect();
      const frame = el.getBoundingClientRect();
      return { scrolled: el.scrollTop, top: bar.top - frame.top, height: bar.height };
    });
  await expect.poll(async () => (await at()).scrolled).toBeGreaterThan(200);
  const placed = await at();
  // At the reader's top edge, not scrolled away above it, and easy to hit.
  expect(placed.top).toBeGreaterThanOrEqual(0);
  expect(placed.top).toBeLessThan(8);
  expect(placed.height).toBeGreaterThanOrEqual(32);
  const back = page.locator(".reader-back button");
  await back.click();
  await expect.poll(() => listHidden(page)).toBe(false);
});

test("with Labels moved into More, the menu keeps the toolbar's order and l still opens it", async ({
  page,
}) => {
  await open(page, 420);
  await page.getByRole("option").first().click();
  await page.keyboard.press("Escape");
  await expect.poll(() => listHidden(page)).toBe(false);
  // Every movable button has gone; the menu lists them as the toolbar did.
  await page.getByTitle("More", { exact: true }).click();
  const items = await page
    .getByRole("menu", { name: "More" })
    .getByRole("menuitem")
    .allTextContents();
  expect(items.slice(0, 5).map((t) => t.replace(/[a-z#!]$/, "").trim())).toEqual([
    "Labels…",
    "Star",
    "Mark as read",
    "Report spam",
    "Move to Trash",
  ]);
  await page.keyboard.press("Escape");
  // l opens the label picker, under the More button.
  const picker = page.getByRole("dialog", { name: "Labels" });
  await page.keyboard.press("l");
  await expect(picker).toBeVisible();
  const [at, more] = await Promise.all([
    picker.boundingBox(),
    page.getByTitle("More", { exact: true }).boundingBox(),
  ]);
  expect(Math.abs(at!.y - (more!.y + more!.height))).toBeLessThan(16);
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);
  // So does Labels in the command palette.
  await page.keyboard.press("Meta+k");
  await page.keyboard.type("Labels");
  await page.keyboard.press("Enter");
  await expect(picker).toBeVisible();
});

test("going back doesn't happen while typing, and Esc puts a floating sidebar away first", async ({
  page,
}) => {
  await open(page, 480);
  await page.getByRole("option").first().click();
  await expect.poll(() => listHidden(page)).toBe(true);
  // ⌘[ in a reply being written leaves the conversation where it is.
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  await page.keyboard.type("Sounds good");
  await page.keyboard.press("Meta+BracketLeft");
  await page.waitForTimeout(200);
  expect(await listHidden(page)).toBe(true);
  await page.keyboard.press("Escape");
  // A sidebar floated by its shortcut, with focus outside it: Esc puts it
  // away, and the conversation stays.
  const peek = page.locator(".sidebar-peek");
  await page.keyboard.press("Control+Meta+s");
  await expect(peek).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(peek).toHaveCount(0);
  expect(await listHidden(page)).toBe(true);
});

test("focus follows the pane that shows", async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 700 });
  // Each conversation its own, so j shows a different one.
  await page.goto("/tests/browser/harness.html?mode=shell&rows=1&threads=distinct");
  await page.getByRole("option").first().click();
  await expect.poll(() => listHidden(page)).toBe(true);
  await expect(page.locator("[data-reader-back]")).toBeFocused();
  await expect(page.locator("[data-reader-back]")).toHaveAccessibleName("Back to Inbox");
  await page.keyboard.press("Enter");
  await expect.poll(() => listHidden(page)).toBe(false);
  await expect(page.getByRole("listbox", { name: "Conversations" })).toBeFocused();
  // Return opens the conversation again from the focused list.
  await page.keyboard.press("Enter");
  await expect.poll(() => listHidden(page)).toBe(true);
  await expect(page.locator("[data-reader-back]")).toBeFocused();
  // j moves to the next conversation, whose way back takes the focus.
  const chosen = page.locator('[role="option"][aria-selected="true"]');
  const first = await chosen.getAttribute("data-thread-id");
  await page.keyboard.press("j");
  await expect(chosen).not.toHaveAttribute("data-thread-id", first ?? "");
  await expect(page.locator("[data-reader-back]")).toBeFocused();
});
