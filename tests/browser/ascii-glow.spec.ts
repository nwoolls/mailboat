import { expect, type Page, test } from "@playwright/test";

/**
 * Settings → Toybox → Style → ASCII art: the glow is drawn in characters on
 * a canvas across the card, follows the pointer as the gradient glow does,
 * and keeps the icon clear so it still reads.
 */

/** Painted pixels in a box of the canvas, in CSS pixels from the canvas's corner. */
const inkIn = (page: Page, x: number, y: number, w: number, h: number) =>
  page.locator("canvas.empty-ascii").evaluate(
    (c: HTMLCanvasElement, [bx, by, bw, bh]) => {
      const k = c.width / c.clientWidth;
      const data = c
        .getContext("2d")!
        .getImageData(
          Math.round(bx! * k),
          Math.round(by! * k),
          Math.round(bw! * k),
          Math.round(bh! * k),
        ).data;
      let n = 0;
      for (let i = 3; i < data.length; i += 4) n += data[i]! > 0 ? 1 : 0;
      return n;
    },
    [x, y, w, h],
  );

test("the ASCII glow draws in characters and follows the pointer", async ({ page }) => {
  await page.goto("/tests/browser/harness.html?mode=empty&glow=ascii");
  await expect(page.getByText("All caught up")).toBeVisible();
  const canvas = page.locator("canvas.empty-ascii");
  await expect(canvas).toBeVisible();
  // The gradient is still there to move, but doesn't paint.
  const gradient = await page
    .locator(".empty-glow")
    .evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(gradient).toBe("none");

  const box = (await canvas.boundingBox())!;
  // Far from the pointer's corner, before it comes: nothing there yet.
  const corner = () => inkIn(page, 10, box.height - 90, 80, 80);
  expect(await corner()).toBe(0);
  // Into the bottom-left corner: the glow follows, and lights it up.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.move(box.x + 50, box.y + box.height - 50, { steps: 10 });
  await page.waitForTimeout(1200);
  expect(await corner()).toBeGreaterThan(500);
});

test("the ASCII glow keeps the icon clear", async ({ page }) => {
  await page.goto("/tests/browser/harness.html?mode=empty&glow=ascii");
  await expect(page.getByText("All caught up")).toBeVisible();
  // The rise has settled and the glow rests behind the icon.
  await page.waitForTimeout(1500);
  const canvas = (await page.locator("canvas.empty-ascii").boundingBox())!;
  const icon = (await page.locator(".empty-rise > div").first().boundingBox())!;
  // The middle of the icon's box: no characters.
  const inner = await inkIn(
    page,
    icon.x - canvas.x + 12,
    icon.y - canvas.y + 12,
    icon.width - 24,
    icon.height - 24,
  );
  expect(inner).toBe(0);
  // Just beside it, the glow is drawn.
  expect(
    await inkIn(page, icon.x - canvas.x - 60, icon.y - canvas.y, 40, icon.height),
  ).toBeGreaterThan(200);
});

test("the pixel-art glow draws in chunky blocks that follow the pointer", async ({ page }) => {
  await page.goto("/tests/browser/harness.html?mode=empty&glow=pixel");
  await expect(page.getByText("All caught up")).toBeVisible();
  await expect(page.locator("canvas.empty-ascii")).toHaveCount(0);
  const canvas = page.locator("canvas.empty-pixel");
  await expect(canvas).toBeVisible();
  // The gradient is still there to move, but doesn't paint.
  const gradient = await page
    .locator(".empty-glow")
    .evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(gradient).toBe("none");
  const box = (await canvas.boundingBox())!;
  const corner = () =>
    canvas.evaluate((c: HTMLCanvasElement) => {
      const k = c.width / c.clientWidth;
      const d = c
        .getContext("2d")!
        .getImageData(10 * k, (c.clientHeight - 90) * k, 80 * k, 80 * k).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) n += d[i]! > 0 ? 1 : 0;
      return n;
    });
  const before = await corner();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.move(box.x + 50, box.y + box.height - 50, { steps: 10 });
  await page.waitForTimeout(1200);
  expect(await corner()).toBeGreaterThan(before + 1000);
});

test("the ASCII glow clears round the words' letters, not their whole column", async ({ page }) => {
  await page.goto("/tests/browser/harness.html?mode=empty&glow=ascii");
  await expect(page.getByText("All caught up")).toBeVisible();
  await page.waitForTimeout(1500);
  const canvas = (await page.locator("canvas.empty-ascii").boundingBox())!;
  // The letters themselves (the paragraph's own box is the whole column).
  const title = await page.getByText("All caught up").evaluate((p) => {
    const range = document.createRange();
    range.selectNodeContents(p.firstChild!);
    const r = range.getBoundingClientRect();
    return { x: r.x, y: r.y, height: r.height };
  });
  // The column is 320px wide; the title's letters much less. Beside the
  // letters, past the soft edge but inside the column, the glow is drawn.
  const besideX = title.x - canvas.x - 60;
  // Hold the glow there with the pointer, so its drift doesn't decide.
  await page.mouse.move(canvas.x + besideX + 12, title.y + title.height / 2, { steps: 5 });
  await page.waitForTimeout(1200);
  expect(await inkIn(page, besideX, title.y - canvas.y, 24, title.height)).toBeGreaterThan(100);
});

test("another toy shows no glow: the glow is a toy of its own", async ({ page }) => {
  await page.goto("/tests/browser/harness.html?mode=empty&glow=ascii&toy=ripples");
  await expect(page.getByText("All caught up")).toBeVisible();
  await expect(page.locator(".empty-glow-pull")).toHaveCount(0);
  await expect(page.locator("canvas.empty-ascii")).toHaveCount(0);
});

test("the ASCII glow keeps the card's title clear, as it does the words", async ({ page }) => {
  await page.goto("/tests/browser/harness.html?mode=empty&glow=ascii");
  await expect(page.getByText("All caught up")).toBeVisible();
  const canvas = (await page.locator("canvas.empty-ascii").boundingBox())!;
  // The title's letters (its button is wider than they are).
  const title = await page.locator("[data-card-title]").evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const r = range.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  // Draw the glow up onto the title.
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  await page.mouse.move(title.x + title.width / 2, title.y + title.height / 2, { steps: 10 });
  await page.waitForTimeout(1500);
  const on = await inkIn(page, title.x - canvas.x, title.y - canvas.y, title.width, title.height);
  expect(on).toBe(0);
  // Beside the letters, it's drawn.
  expect(
    await inkIn(page, title.x - canvas.x + title.width + 40, title.y - canvas.y, 30, title.height),
  ).toBeGreaterThan(100);
});

test("the glow glides over to the pointer, then holds on loosely", async ({ page }) => {
  await page.goto("/tests/browser/harness.html?mode=empty&glow=pixel");
  await expect(page.getByText("All caught up")).toBeVisible();
  const card = (await page.locator(".panel").boundingBox())!;
  const centre = async () => {
    const g = (await page.locator(".empty-glow").boundingBox())!;
    return { x: g.x + g.width / 2, y: g.y + g.height / 2 };
  };
  const gap = async (p: { x: number; y: number }) => {
    const c = await centre();
    return Math.hypot(c.x - p.x, c.y - p.y);
  };
  // Arriving: it glides rather than jumping there.
  const at = { x: card.x + 80, y: card.y + card.height - 80 };
  await page.mouse.move(at.x, at.y);
  await page.waitForTimeout(50);
  expect(await gap(at)).toBeGreaterThan(20);
  // On a still pointer it settles right on it.
  await page.waitForTimeout(1500);
  expect(await gap(at)).toBeLessThan(6);
  // A quick move: loose, not stuck to the pointer, a frame later...
  const next = { x: at.x + 160, y: at.y - 80 };
  await page.mouse.move(next.x, next.y);
  await page.waitForTimeout(20);
  expect(await gap(next)).toBeGreaterThan(30);
  // ...and with it again a moment after.
  await page.waitForTimeout(400);
  expect(await gap(next)).toBeLessThan(8);
});
