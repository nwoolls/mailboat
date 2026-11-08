import { expect, type Page, test } from "@playwright/test";

/**
 * The starfield and fireworks want a night sky: on a light page the canvas
 * paints one in the palette's darkest colour, and the empty state's icon
 * and words switch to light text so they still read (UX Spike 4).
 */
async function start(page: Page, scene: string) {
  await page.goto("/tests/browser/harness.html?mode=empty&screensaver");
  await expect(page.getByText("All caught up")).toBeVisible();
  // The screensaver listens for this from an effect, which can run after the
  // words are already on screen: an event sent too early is lost, so send it
  // again until the canvas is up (it once failed here in about one run in
  // two hundred).
  await expect(async () => {
    await page.evaluate(
      (id) => window.dispatchEvent(new CustomEvent("app:screensaver", { detail: id })),
      scene,
    );
    await expect(page.locator("canvas.screensaver")).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 10_000 });
  // Past the start's fade-in.
  await page.waitForTimeout(1200);
}

/** The words' text colour, as its lightness from 0 to 255. */
const wordsLightness = (page: Page) =>
  page
    .locator(".empty-words p")
    .first()
    .evaluate((p) => {
      const [r, g, b] = getComputedStyle(p)
        .color.match(/[\d.]+/g)!
        .map(Number);
      return (r! + g! + b!) / 3;
    });

/**
 * How dark the canvas's sky is in its top-left corner, 0 (black) to 255: the
 * median over a small patch, not one pixel. A star (or a spark) can sit on
 * any single pixel for a frame, which read as a bright sky in about one run
 * in forty; it covers a few pixels of a patch, and the median ignores them.
 */
const skyLightness = (page: Page) =>
  page.locator("canvas.screensaver").evaluate((c: HTMLCanvasElement) => {
    const size = 11;
    const { data } = c.getContext("2d")!.getImageData(2, 2, size, size);
    const median = (values: number[]) => values.sort((a, b) => a - b)[values.length >> 1]!;
    const light: number[] = [];
    const alpha: number[] = [];
    for (let i = 0; i < data.length; i += 4) {
      light.push((data[i]! + data[i + 1]! + data[i + 2]!) / 3);
      alpha.push(data[i + 3]!);
    }
    return { light: median(light), alpha: median(alpha) };
  });

/** How opaque the canvas is drawn, once its fade-in is done. */
const canvasOpacity = (page: Page) =>
  page.locator("canvas.screensaver").evaluate((c) => Number(getComputedStyle(c).opacity));

test.describe("on a light page", () => {
  test.use({ colorScheme: "light" });

  for (const scene of ["starfield", "fireworks"])
    test(`${scene} paints a night sky and lightens the words`, async ({ page }) => {
      await start(page, scene);
      const sky = await skyLightness(page);
      expect(sky.alpha).toBeGreaterThan(200);
      expect(sky.light).toBeLessThan(110);
      // And it shows as painted: the canvas otherwise follows the glass's
      // see-through-ness, which washed the sky out to a pale grey.
      await expect.poll(() => canvasOpacity(page)).toBeGreaterThan(0.95);
      await expect(page.locator(".empty-words")).toHaveAttribute("data-scene-night", "");
      await expect.poll(() => wordsLightness(page)).toBeGreaterThan(180);
    });

  test("a scene without one leaves the page as it is", async ({ page }) => {
    await start(page, "koi");
    await expect(page.locator(".empty-words")).not.toHaveAttribute("data-scene-night");
    expect(await wordsLightness(page)).toBeLessThan(120);
  });
});

test.describe("on a dark page", () => {
  test.use({ colorScheme: "dark" });

  test("the starfield needs no sky of its own", async ({ page }) => {
    await start(page, "starfield");
    expect((await skyLightness(page)).alpha).toBeLessThan(200);
    await expect(page.locator(".empty-words")).not.toHaveAttribute("data-scene-night");
  });
});
