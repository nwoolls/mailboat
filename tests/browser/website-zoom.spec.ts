import { chromium, expect, type Page, test } from "@playwright/test";

/**
 * The website's screenshot zoom (website/site.js), the first time each
 * screenshot is opened: the full-size picture must not be painted at its
 * final size before the grow-from-the-card animation starts (owner report,
 * 2026-11-07; docs/ROADMAP.md, Bug backlog). An empty cache and a slow
 * network stand in for a first visit. In WebKit and in Chromium (launched
 * here: Chromium's project only runs `windows-*` specs).
 */

/** Holds back the pictures whose address matches `pattern` for 1.5 s; counts them. */
async function slowly(page: Page, pattern: string) {
  const held = { count: 0 };
  await page.route(pattern, async (route) => {
    held.count += 1;
    await new Promise((done) => setTimeout(done, 1500));
    await route.continue();
  });
  return held;
}

type Frame = { shown: boolean; moving: boolean };

async function neverFlashes(page: Page) {
  const held = await slowly(page, "**/images/full/**");
  await page.goto("/website/index.html");
  const button = page.locator("button.zoom").first();
  await button.scrollIntoViewIfNeeded();
  // Every frame from the click until the picture starts growing: is it
  // showing, and has its animation started.
  await page.evaluate(() => {
    const w = window as unknown as { __frames: Frame[] };
    w.__frames = [];
    const sample = () => {
      const dialog = document.querySelector<HTMLDialogElement>("dialog.lightbox");
      const big = dialog?.querySelector("img");
      if (dialog?.open && big) {
        const style = getComputedStyle(big);
        w.__frames.push({
          shown: style.visibility === "visible" && Number(style.opacity) > 0,
          moving: big.getAnimations().length > 0,
        });
        if (w.__frames.at(-1)!.moving) return;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await button.click();
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          (window as unknown as { __frames: Frame[] }).__frames.some((f) => f.moving),
        ),
      { timeout: 10_000 },
    )
    .toBe(true);
  const frames = await page.evaluate(() => (window as unknown as { __frames: Frame[] }).__frames);
  const before = frames.slice(
    0,
    frames.findIndex((f) => f.moving),
  );
  // The picture was held back, and frames were painted while it waited (the
  // test proves something).
  expect(held.count).toBeGreaterThan(0);
  expect(before.length).toBeGreaterThan(0);
  // Nothing of the zoomed picture shows until it can grow from the card:
  // before, it sat there (empty, then at full size) while it loaded.
  const flashes = before.filter((f) => f.shown);
  expect(flashes.length, "frames with the zoomed picture shown before it animated").toBe(0);
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

/** Opens the first screenshot and waits until it is shown and still. */
async function openFirst(page: Page) {
  await page.goto("/website/index.html");
  const button = page.locator("button.zoom").first();
  await button.scrollIntoViewIfNeeded();
  await button.click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const big = document.querySelector<HTMLImageElement>("dialog.lightbox img")!;
        return big.complete && big.naturalWidth > 0 && big.getAnimations().length === 0;
      }),
    )
    .toBe(true);
}

/** The full-size picture's path (without "-light.webp") of screenshot `i`. */
function zoomOf(page: Page, i: number) {
  return page.evaluate(
    (n) => document.querySelectorAll<HTMLImageElement>("img[data-zoom]")[n]!.dataset.zoom!,
    i,
  );
}

/**
 * Stepping to the next screenshot (› or the arrow key): the one shown stays
 * until the next has loaded, then they crossfade, so the dimmed backdrop
 * never shows on its own (owner, 2026-11-12: a cut to the backdrop and a
 * fade in from nothing read as a flash, the longer the slower it loaded).
 * With the next picture a second and a half late, as on a first visit.
 */
async function stepsWithoutPopping(page: Page) {
  await openFirst(page);
  const next = await zoomOf(page, 1);
  const held = await slowly(page, `**/${next}-*`);
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
  // The next picture was held back, and frames were painted while it was
  // (the test proves something).
  expect(held.count).toBeGreaterThan(0);
  expect(steps.length).toBeGreaterThan(1);
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

/**
 * Closing while a step still loads: back to the screenshot that was shown,
 * not the one that never appeared (code review: focus went to the next
 * screenshot's button).
 */
test("website zoom: closing while a step loads returns to the screenshot shown", async ({
  page,
}) => {
  await openFirst(page);
  await slowly(page, `**/${await zoomOf(page, 1)}-*`);
  await page.getByRole("button", { name: "Next screenshot" }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog.lightbox")).not.toHaveAttribute("open");
  await expect(page.locator("button.zoom").first()).toBeFocused();
});

/**
 * A step during a crossfade: the picture still sliding in goes on from
 * where it is as it leaves, never back to fully shown (code review: it
 * snapped back before fading out).
 */
test("website zoom: a step during a crossfade doesn't snap the leaving picture back", async ({
  page,
}) => {
  await openFirst(page);
  // Load the next two so the steps don't wait on the network.
  for (const i of [1, 2]) {
    const base = await zoomOf(page, i);
    await page.evaluate(
      (b) =>
        new Promise((done) => {
          const img = new Image();
          img.onload = img.onerror = done;
          img.src = `${b}-light.webp`;
        }),
      base,
    );
  }
  const leaving = await page.evaluate(async () => {
    const next = document.querySelector<HTMLButtonElement>(".lightbox-next")!;
    const frame = () => new Promise((done) => requestAnimationFrame(done));
    next.click();
    // Part way into the first crossfade.
    for (let i = 0; i < 4; i++) await frame();
    const figures = () => [...document.querySelectorAll<HTMLElement>("dialog.lightbox figure")];
    const sliding = figures().find((f) => !f.hasAttribute("aria-hidden"))!;
    next.click();
    // Its opacity on every frame from when it starts leaving (marked
    // aria-hidden) until it's gone.
    const seen: number[] = [];
    for (let i = 0; i < 40 && sliding.isConnected; i++) {
      await frame();
      if (sliding.hasAttribute("aria-hidden")) seen.push(Number(getComputedStyle(sliding).opacity));
    }
    return seen;
  });
  // It was part way in when it started leaving, then only faded.
  expect(leaving.length).toBeGreaterThan(1);
  expect(leaving[0]).toBeLessThan(1);
  const rises = leaving.slice(1).filter((o, i) => o > leaving[i]! + 0.01);
  expect(rises.length, "frames where the leaving picture got more visible").toBe(0);
});
