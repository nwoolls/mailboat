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

/**
 * The pond's water runs up under the title row to the card's top edge
 * (owner, 2026-11-13: no hard edge below the title), yet the title row
 * still gets its clicks.
 */
async function reachUnderTitle(page: Page) {
  const box = await layer(page).boundingBox();
  const title = await page.getByRole("button", { name: "Inbox" }).boundingBox();
  expect(box!.y).toBeLessThanOrEqual(title!.y + 0.5);
  await page.getByRole("button", { name: "Inbox" }).click({ trial: true });
}

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
  await reachUnderTitle(page);
  expect(await inked(page)).toBe(0);
  await page.mouse.click(120, 400);
  await page.waitForTimeout(400);
  expect(await inked(page)).toBeGreaterThan(100);
  // Chunky blocks, drawn sharp: neighboring screen pixels inside a block match.
  const blocky = await page.locator("canvas").evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let inked = 0;
    let same = 0;
    for (let i = 0; i < d.length - 4; i += 4) {
      if (d[i + 3]! === 0) continue;
      inked++;
      if (d[i + 3] === d[i + 7] && d[i] === d[i + 4]) same++;
    }
    return { sharp: c.width >= c.clientWidth, share: same / Math.max(1, inked) };
  });
  expect(blocky.sharp).toBe(true);
  expect(blocky.share).toBeGreaterThan(0.6);
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

test("the pixel sky is drawn in chunky pixels, under the title but behind it", async ({ page }) => {
  await page.goto("/tests/browser/harness.html?mode=empty&toy=sky");
  await expect(page.getByText("All caught up")).toBeVisible();
  await reachUnderTitle(page);
  await page.waitForTimeout(300);
  expect(await inked(page)).toBeGreaterThan(5000);
  // Chunky: neighboring screen pixels within a block are the same color.
  const blocky = await page.locator("canvas").evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let same = 0;
    let pairs = 0;
    for (let i = 0; i < d.length - 8; i += 4 * 7) {
      pairs++;
      if (d[i] === d[i + 4] && d[i + 1] === d[i + 5] && d[i + 2] === d[i + 6]) same++;
    }
    return same / pairs;
  });
  expect(blocky).toBeGreaterThan(0.6);
  // Behind the card's content, so the title row stays on top of it.
  expect(await layer(page).evaluate((el) => getComputedStyle(el).zIndex)).toBe("-1");
});

test("the pond in ASCII art ripples in characters, then settles", async ({ page }) => {
  await page.goto("/tests/browser/harness.html?mode=empty&toy=ripples&style=ascii");
  await expect(page.getByText("All caught up")).toBeVisible();
  await reachUnderTitle(page);
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

test("the sky in ASCII art draws on a canvas reaching under the title", async ({ page }) => {
  await page.goto("/tests/browser/harness.html?mode=empty&toy=sky&style=ascii");
  await expect(page.getByText("All caught up")).toBeVisible();
  await reachUnderTitle(page);
  await page.waitForTimeout(300);
  // Whatever the hour, the sky's wash and the sun or moon are drawn.
  expect(await inked(page)).toBeGreaterThan(5000);
  // Not the pixel sky's gradient and puffs.
  await expect(layer(page).locator(".rounded-full")).toHaveCount(0);
});
