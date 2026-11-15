import { expect, type Page, test } from "@playwright/test";

/**
 * Label color and visibility (0.3.0, from the owner's mockup): a label's
 * menu opens from a ⋮ button on its sidebar row (and right-click) and sets
 * its color, where it shows in the sidebar, and whether it shows on
 * conversations; hidden labels sit in a closed Hidden fold; conversations'
 * rows show up to two label chips after the subject, then "+N".
 */
async function open(page: Page) {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto("/tests/browser/harness.html?mode=shell&rows=1&labels=1");
  await expect(page.getByRole("option").first()).toBeVisible();
  const nav = page.locator("nav").first();
  await nav.getByRole("button", { name: "Labels", exact: true }).click();
  return nav;
}

const order = (page: Page) =>
  page.evaluate(() => (window as unknown as { __order?: string[] }).__order ?? []);

test("hidden labels sit in a closed Hidden fold, with their menu", async ({ page }) => {
  const nav = await open(page);
  for (const name of ["Clients", "Receipts", "Travel", "Quiet"])
    await expect(nav.getByRole("button", { name, exact: true })).toBeVisible();
  // In the closed fold: clipped to nothing and inert until it opens.
  const folded = (name: string) =>
    nav.getByRole("button", { name, exact: true }).evaluate((el) => el.closest("[inert]") !== null);
  expect(await folded("Archive box")).toBe(true);
  expect(await folded("Receipts")).toBe(false);
  await nav.getByRole("button", { name: "Hidden", exact: true }).click();
  await expect.poll(() => folded("Archive box")).toBe(false);
  // Its menu can show it again.
  await nav.getByRole("button", { name: "Archive box", exact: true }).hover();
  await nav.getByRole("button", { name: "Archive box: label options" }).click();
  await page.getByRole("menuitem", { name: "Show in sidebar" }).click();
  await page
    .getByRole("menu", { name: "Where Archive box shows" })
    .getByRole("menuitemradio", { name: "Always" })
    .click();
  await expect.poll(() => order(page)).toContain('label_set_sidebar 104 "show"');
});

test("a label's ⋮ button shows on hover and opens its menu", async ({ page }) => {
  const nav = await open(page);
  const dots = nav.getByRole("button", { name: "Receipts: label options" });
  await expect(dots).toHaveCSS("opacity", "0");
  await nav.getByRole("button", { name: "Receipts", exact: true }).hover();
  await expect(dots).toHaveCSS("opacity", "1");
  await dots.click();
  const menu = page.getByRole("menu", { name: "Receipts menu" });
  for (const name of ["Rename…", "Color", "Show in sidebar", "Delete…"])
    await expect(menu.getByRole("menuitem", { name, exact: true })).toBeVisible();
  // A switch, heard as on or off, not only shown with a ✓.
  await expect(
    menu.getByRole("menuitemcheckbox", { name: "Show on conversations" }),
  ).toHaveAttribute("aria-checked", "true");

  // Color is a submenu beside the label's menu, which stays open (owner).
  await menu.getByRole("menuitem", { name: "Color", exact: true }).click();
  const colors = page.getByRole("menu", { name: "Color for Receipts" });
  await expect(colors).toBeVisible();
  await expect(menu).toBeVisible();
  const [parentBox, subBox] = await Promise.all([menu.boundingBox(), colors.boundingBox()]);
  expect(subBox!.x).toBeGreaterThan(parentBox!.x + parentBox!.width / 2);
  await expect(colors.getByRole("menuitem", { name: /^Color #/ })).toHaveCount(4);
  await colors.getByRole("menuitem", { name: "Color #4a86e8" }).click();
  await expect.poll(() => order(page)).toContain('label_set_color 102 "#4a86e8"');

  // Show on conversations toggles off.
  await nav.getByRole("button", { name: "Receipts", exact: true }).click({ button: "right" });
  await page.getByRole("menuitemcheckbox", { name: "Show on conversations" }).click();
  await expect.poll(() => order(page)).toContain("label_set_on_conversations 102 false");
});

test("rows show up to two label chips after the subject, then +N", async ({ page }) => {
  await open(page);
  const rows = page.getByRole("option");
  const first = rows.nth(0);
  await expect(first.getByText("Clients", { exact: true })).toBeVisible();
  await expect(first.getByText("Receipts", { exact: true })).toBeVisible();
  await expect(first.getByText("+1", { exact: true })).toBeVisible();
  await expect(first.getByText("Travel", { exact: true })).toHaveCount(0);
  // Its text is black or white by contrast, not the hard-to-read white
  // kept with this green in Gmail (owner).
  await expect(first.getByText("Clients", { exact: true })).toHaveCSS("color", "rgb(0, 0, 0)");
  // The chip comes after the subject on the same line.
  const [subject, chip] = await Promise.all([
    first.locator("span.truncate").nth(1).boundingBox(),
    first.getByText("Clients", { exact: true }).boundingBox(),
  ]);
  expect(chip!.x).toBeGreaterThan(subject!.x);
  // A label set not to show on conversations isn't on the row.
  const second = rows.nth(1);
  await expect(second.getByText("Travel", { exact: true })).toBeVisible();
  await expect(second.getByText("Quiet", { exact: true })).toHaveCount(0);
});

test("submenus open on hover and with →, and ← or another item closes them", async ({ page }) => {
  const nav = await open(page);
  await nav.getByRole("button", { name: "Travel", exact: true }).click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Travel menu" });
  const where = page.getByRole("menu", { name: "Where Travel shows" });
  const colors = page.getByRole("menu", { name: "Color for Travel" });
  const item = (name: string) => menu.getByRole("menuitem", { name, exact: true });
  // Hover opens it after a moment, the label's menu stays, and the choices
  // say which is checked.
  await item("Show in sidebar").hover();
  await expect(where).toBeVisible();
  await expect(where.getByRole("menuitemradio", { name: "Always" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(where.getByRole("menuitemradio", { name: "Hidden" })).toHaveAttribute(
    "aria-checked",
    "false",
  );
  // Escape, with focus still on the item, closes only the submenu.
  await page.keyboard.press("Escape");
  await expect(where).toHaveCount(0);
  await expect(menu).toBeVisible();
  // Opened by hover, → goes into it.
  await item("Rename…").hover();
  await item("Show in sidebar").hover();
  await expect(where).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(where.getByRole("menuitemradio", { name: "Always" })).toBeFocused();
  // From inside it, highlighting another item of the label's menu closes it.
  await item("Rename…").hover();
  await expect(where).toHaveCount(0);
  // Only one submenu at a time.
  await item("Color").click();
  await expect(colors).toBeVisible();
  await item("Show in sidebar").hover();
  await expect(where).toBeVisible();
  await expect(colors).toHaveCount(0);
  // Straight from one submenu's choices into the other's by clicking it:
  // the first still closes.
  await item("Color").click();
  await expect(colors).toBeVisible();
  await item("Show in sidebar").click();
  await page.waitForTimeout(400);
  await expect(where).toBeVisible();
  await expect(colors).toHaveCount(0);
  await page.keyboard.press("ArrowLeft");
  // ← closes just it, back on its item; Esc then closes the label's menu.
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowLeft");
  await expect(where).toHaveCount(0);
  await expect(item("Show in sidebar")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
});

test("the pointer can cross other items on its way into a submenu", async ({ page }) => {
  const nav = await open(page);
  await nav.getByRole("button", { name: "Travel", exact: true }).click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Travel menu" });
  const colors = page.getByRole("menu", { name: "Color for Travel" });
  await menu.getByRole("menuitem", { name: "Color", exact: true }).hover();
  await expect(colors).toBeVisible();
  // Down and across, over the items below Color, to the grid's last swatch.
  const swatch = colors.getByRole("menuitem", { name: /^Color #/ }).last();
  const target = (await swatch.boundingBox())!;
  const from = (await menu.getByRole("menuitem", { name: "Color", exact: true }).boundingBox())!;
  const below = (await menu
    .getByRole("menuitemcheckbox", { name: "Show on conversations" })
    .boundingBox())!;
  await page.mouse.move(from.x + from.width - 20, below.y + below.height / 2, { steps: 4 });
  await page.mouse.move(target.x + 5, target.y + 5, { steps: 4 });
  await page.waitForTimeout(400);
  await expect(colors).toBeVisible();
  await expect(swatch).toBeFocused();
});
