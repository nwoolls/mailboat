import { chromium, expect, type Page, test } from "@playwright/test";

/**
 * The website's screenshot zoom (website/site.js), the first time each
 * screenshot is opened: the full-size picture must not be painted at its
 * final size before the grow-from-the-card animation starts (owner report,
 * 2026-11-07; docs/ROADMAP.md, Bug backlog). An empty cache and a slow
 * network stand in for a first visit. In WebKit and in Chromium (launched
 * here: Chromium's project only runs `windows-*` specs).
 */
async function neverFlashes(page: Page) {
  // Full-size pictures arrive a second and a half late.
  await page.route("**/images/full/**", async (route) => {
    await new Promise((done) => setTimeout(done, 1500));
    await route.continue();
  });
  await page.goto("/website/index.html");
  const button = page.locator("button.zoom").first();
  await button.scrollIntoViewIfNeeded();
  const thumbWidth = (await button.boundingBox())!.width;
  // Every frame from the click on: is the big picture showing, how wide,
  // and has its animation started.
  await page.evaluate(() => {
    const w = window as unknown as {
      __frames: { shown: boolean; width: number; moving: boolean }[];
    };
    w.__frames = [];
    const sample = () => {
      const dialog = document.querySelector<HTMLDialogElement>("dialog.lightbox");
      const big = dialog?.querySelector("img");
      if (dialog?.open && big) {
        const style = getComputedStyle(big);
        w.__frames.push({
          shown: style.visibility === "visible" && Number(style.opacity) > 0,
          width: big.getBoundingClientRect().width,
          moving: big.getAnimations().length > 0,
        });
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await button.click();
  // Until it has loaded and grown.
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          (window as unknown as { __frames: { moving: boolean }[] }).__frames.some((f) => f.moving),
        ),
      {
        timeout: 10_000,
      },
    )
    .toBe(true);
  const frames = await page.evaluate(
    () =>
      (window as unknown as { __frames: { shown: boolean; width: number; moving: boolean }[] })
        .__frames,
  );
  const before = frames.slice(
    0,
    frames.findIndex((f) => f.moving),
  );
  // The page painted frames while it waited (the test proves something).
  expect(before.length).toBeGreaterThan(10);
  // Nothing of the zoomed picture shows until it can grow from the card:
  // before, it sat there (empty, then at full size) while it loaded.
  const flashes = before.filter((f) => f.shown);
  expect(flashes.length, "frames with the zoomed picture shown before it animated").toBe(0);
  expect(thumbWidth).toBeGreaterThan(0);
}

test("website zoom (WebKit): no full-size flash before the animation", async ({ page }) => {
  await neverFlashes(page);
});

test("website zoom (Chromium): no full-size flash before the animation", async ({ baseURL }) => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ baseURL, viewport: { width: 1400, height: 900 } });
    await neverFlashes(page);
  } finally {
    await browser.close();
  }
});

/**
 * Stepping to the next screenshot (› or the arrow key): the one shown stays
 * until the next has loaded, then they crossfade, so the dimmed backdrop
 * never shows on its own (owner, 2026-11-12: a cut to the backdrop and a
 * fade in from nothing read as a flash, the longer the slower it loaded).
 * With the next picture a second and a half late, as on a first visit.
 */
async function stepsWithoutPopping(page: Page) {
  await page.goto("/website/index.html");
  const button = page.locator("button.zoom").first();
  await button.scrollIntoViewIfNeeded();
  await button.click();
  // The first one open and settled.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const big = document.querySelector<HTMLImageElement>("dialog.lightbox img")!;
        return big.complete && big.naturalWidth > 0 && big.getAnimations().length === 0;
      }),
    )
    .toBe(true);
  const next = await page.evaluate(
    () => document.querySelectorAll<HTMLImageElement>("img[data-zoom]")[1]!.dataset.zoom!,
  );
  await page.route(`**/${next}-*`, async (route) => {
    await new Promise((done) => setTimeout(done, 1500));
    await route.continue();
  });
  // Every frame from the click on: the most visible picture's opacity, and
  // whether the next one is in place with no animation left.
  await page.evaluate((base) => {
    const w = window as unknown as { __steps: { most: number; done: boolean }[] };
    w.__steps = [];
    const sample = () => {
      const figures = [...document.querySelectorAll<HTMLElement>("dialog.lightbox figure")];
      // A picture counts once its image has loaded: an empty box shows
      // only the backdrop.
      const loaded = (f: HTMLElement) => {
        const img = f.querySelector("img")!;
        return img.complete && img.naturalWidth > 0;
      };
      const seen = figures.map((f) =>
        getComputedStyle(f).visibility === "visible" && loaded(f)
          ? Number(getComputedStyle(f).opacity)
          : 0,
      );
      const arrived = figures.find((f) => f.querySelector("img")!.currentSrc.includes(base));
      w.__steps.push({
        most: Math.max(0, ...seen),
        done:
          figures.length === 1 &&
          !!arrived &&
          loaded(arrived) &&
          getComputedStyle(arrived).visibility === "visible" &&
          arrived.getAnimations().length === 0,
      });
      if (!w.__steps.at(-1)!.done) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }, next);
  await page.getByRole("button", { name: "Next screenshot" }).click();
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          (window as unknown as { __steps: { done: boolean }[] }).__steps.some((s) => s.done),
        ),
      { timeout: 10_000 },
    )
    .toBe(true);
  const steps = await page.evaluate(
    () => (window as unknown as { __steps: { most: number }[] }).__steps,
  );
  // It waited for the slow picture (the test proves something).
  expect(steps.length).toBeGreaterThan(30);
  const bare = steps.filter((s) => s.most < 0.5);
  expect(bare.length, "frames with no picture at least half visible").toBe(0);
}

test("website zoom (WebKit): stepping doesn't pop the next picture in", async ({ page }) => {
  await stepsWithoutPopping(page);
});

test("website zoom (Chromium): stepping doesn't pop the next picture in", async ({ baseURL }) => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ baseURL, viewport: { width: 1400, height: 900 } });
    await stepsWithoutPopping(page);
  } finally {
    await browser.close();
  }
});
