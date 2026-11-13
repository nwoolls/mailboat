import { expect, type Page, test } from "@playwright/test";
import { POP_MS, sheetFor } from "../../src/features/emptyToys/model/bubbles";

/**
 * Settings → Toybox → Something to play with (Milestone 8, empty states):
 * each toy draws over the empty view only, never covering the title row
 * or taking its clicks, and responds as described.
 */
const inked = (page: Page) =>
  page.locator("canvas").evaluate((c: HTMLCanvasElement) => {
    const data = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < data.length; i += 4) n += data[i]! > 0 ? 1 : 0;
    return n;
  });

const layer = (page: Page) => page.locator('[aria-hidden="true"].pointer-events-none').first();

async function stayClearOfTitle(page: Page) {
  const box = await layer(page).boundingBox();
  const title = await page.getByRole("button", { name: "Inbox" }).boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(title!.y + title!.height - 0.5);
  // The title row still gets its clicks.
  await page.getByRole("button", { name: "Inbox" }).click({ trial: true });
}

test("the pond ripples where it's clicked, then settles", async ({ page }) => {
  await page.goto("/tests/browser/harness.html?mode=empty&toy=ripples");
  await expect(page.getByText("All caught up")).toBeVisible();
  await stayClearOfTitle(page);
  expect(await inked(page)).toBe(0);
  await page.mouse.click(120, 400);
  await page.waitForTimeout(400);
  expect(await inked(page)).toBeGreaterThan(100);
  await page.waitForTimeout(3500);
  expect(await inked(page)).toBe(0);
});

test("bubble wrap pops the bubble clicked, and only it", async ({ page }) => {
  await page.goto("/tests/browser/harness.html?mode=empty&toy=bubbles");
  await expect(page.getByText("All caught up")).toBeVisible();
  await stayClearOfTitle(page);
  const before = await inked(page);
  expect(before).toBeGreaterThan(1000);
  // The first bubble, where the sheet's own layout puts it.
  const box = (await layer(page).boundingBox())!;
  const first = sheetFor(box.width, box.height).centres[0]!;
  await page.mouse.click(box.x + first.x, box.y + first.y);
  // Past the pop's burst.
  await page.waitForTimeout(POP_MS + 100);
  const once = await inked(page);
  expect(once).toBeLessThan(before);
  // Clicking it again finds nothing left to pop.
  await page.mouse.click(box.x + first.x, box.y + first.y);
  await page.waitForTimeout(POP_MS + 100);
  expect(await inked(page)).toBe(once);
});

test("the sky sits behind the view with the sun or moon in it", async ({ page }) => {
  await page.goto("/tests/browser/harness.html?mode=empty&toy=sky");
  await expect(page.getByText("All caught up")).toBeVisible();
  await stayClearOfTitle(page);
  const background = await layer(page)
    .locator("div")
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(background).toContain("linear-gradient");
  await expect(layer(page).locator(".rounded-full")).toHaveCount(1);
});

test("the pond in ASCII art ripples in characters, then settles", async ({ page }) => {
  await page.goto("/tests/browser/harness.html?mode=empty&toy=ripples&style=ascii");
  await expect(page.getByText("All caught up")).toBeVisible();
  await stayClearOfTitle(page);
  expect(await inked(page)).toBe(0);
  await page.mouse.click(120, 400);
  await page.waitForTimeout(400);
  expect(await inked(page)).toBeGreaterThan(100);
  // Drawn sharp, as characters, not on the pixel pond's 2px cells.
  const sharp = await page
    .locator("canvas")
    .evaluate((c: HTMLCanvasElement) => c.width >= c.clientWidth);
  expect(sharp).toBe(true);
  await page.waitForTimeout(3500);
  expect(await inked(page)).toBe(0);
});
