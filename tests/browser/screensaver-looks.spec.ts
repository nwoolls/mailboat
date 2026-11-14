import { expect, type Page, test } from "@playwright/test";

/**
 * Restyled screensavers (Settings → Toybox → Style, UX Spike 5) draw their
 * scene in chunky pixel art or in ASCII art; the rest still draw fine.
 */
async function start(page: Page, scene: string, style: string) {
  await page.goto(`/tests/browser/harness.html?mode=empty&screensaver&style=${style}`);
  await expect(page.getByText("All caught up")).toBeVisible();
  // Sent until the canvas is up (an event sent before the listener is lost).
  await expect(async () => {
    await page.evaluate(
      (id) => window.dispatchEvent(new CustomEvent("app:screensaver", { detail: id })),
      scene,
    );
    await expect(page.locator("canvas.screensaver")).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 10_000 });
  await page.waitForTimeout(1500);
}

const canvasInfo = (page: Page) =>
  page.locator("canvas.screensaver").evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let inked = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i]! > 0) inked++;
    return { inked, sharp: c.width >= c.clientWidth, width: c.width, cssWidth: c.clientWidth };
  });

test("the jellyfish in ASCII art draws characters at full resolution", async ({ page }) => {
  await start(page, "jellyfish", "ascii");
  const info = await canvasInfo(page);
  expect(info.sharp).toBe(true);
  expect(info.inked).toBeGreaterThan(2000);
});

test("the jellyfish in pixel art draws its own big jellies, at full resolution", async ({
  page,
}) => {
  await start(page, "jellyfish", "pixel");
  const info = await canvasInfo(page);
  // Its own drawing (blocks, glows, a deep-sea backdrop on a light page),
  // not the fine scene's one canvas pixel per cell.
  expect(info.sharp).toBe(true);
  expect(info.inked).toBeGreaterThan(2000);
});

test("on a light page the jellyfish brings a deep-sea backdrop and light text", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await start(page, "jellyfish", "ascii");
  const night = await page
    .locator(".empty-words")
    .evaluate((el) => el.hasAttribute("data-scene-night"));
  expect(night).toBe(true);
});

test("the starfield in either style draws its own stars, at full resolution", async ({ page }) => {
  for (const style of ["ascii", "pixel"]) {
    await start(page, "starfield", style);
    const info = await canvasInfo(page);
    expect(info.sharp).toBe(true);
    expect(info.inked).toBeGreaterThan(500);
  }
});

test("a screensaver not yet restyled draws as before, whatever the style", async ({ page }) => {
  await start(page, "koi", "ascii");
  const info = await canvasInfo(page);
  // One canvas pixel per cell: not the ASCII look's full resolution.
  expect(info.sharp).toBe(false);
});
