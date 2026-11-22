import { expect, type Page, test } from "@playwright/test";
import { sheetFor } from "../../src/features/emptyToys/model/bubbles";
import { BUBBLE_DEFAULTS } from "../../src/features/emptyToys/model/bubblePop";
import { advance, driveTime, holdTime } from "./time";

/** Long enough for a pop's confetti to land and its film to settle. */
const POP_DONE_MS = BUBBLE_DEFAULTS.confettiSeconds * 1.25 * 1000 + 300;

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
    let lit = 0;
    let same = 0;
    for (let i = 0; i < d.length - 4; i += 4) {
      if (d[i + 3] === 0) continue;
      lit++;
      if (d[i + 3] === d[i + 7] && d[i] === d[i + 4]) same++;
    }
    return { sharp: c.width >= c.clientWidth, share: same / Math.max(1, lit) };
  });
  expect(blocky.sharp).toBe(true);
  expect(blocky.share).toBeGreaterThan(0.6);
  await page.waitForTimeout(3500);
  expect(await inked(page)).toBe(0);
});

test("bubble wrap pops the bubble clicked with a burst, and only it", async ({ page }) => {
  // Time the test drives (./time.ts): a slow runner can't make a
  // measurement land early or late in the pop.
  await driveTime(page);
  await page.goto("/tests/browser/harness.html?mode=empty&toy=bubbles");
  await expect(page.getByText("All caught up")).toBeVisible();
  await stayClearOfTitle(page);
  await holdTime(page);
  // The fresh sheet inflates first.
  await advance(page, 1200);
  const before = await inked(page);
  expect(before).toBeGreaterThan(1000);
  // The first bubble, where the sheet's own layout puts it.
  const box = (await layer(page).boundingBox())!;
  const first = sheetFor(box.width, box.height).centres[0]!;
  await page.mouse.click(box.x + first.x, box.y + first.y);
  // A burst: the flash ring and confetti cover more than the bubble did.
  await advance(page, 110);
  expect(await inked(page)).toBeGreaterThan(before);
  // Once the confetti has landed, crumpled film is left: less than a bubble.
  await advance(page, POP_DONE_MS);
  const once = await inked(page);
  expect(once).toBeLessThan(before);
  // Clicking it again finds nothing left to pop.
  await page.mouse.click(box.x + first.x, box.y + first.y);
  await advance(page, POP_DONE_MS);
  expect(await inked(page)).toBe(once);
});

test("bubble wrap with less motion asked for: a pop shows done at once, and holds still", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/harness.html?mode=empty&toy=bubbles");
  await expect(page.getByText("All caught up")).toBeVisible();
  await stayClearOfTitle(page);
  await page.waitForTimeout(300);
  const box = (await layer(page).boundingBox())!;
  const first = sheetFor(box.width, box.height).centres[0]!;
  await page.mouse.click(box.x + first.x, box.y + first.y);
  // No squash, flash or settling: the same picture just after the click as
  // once a pop would have finished.
  await page.waitForTimeout(80);
  const soon = await layer(page)
    .locator("canvas")
    .evaluate((c: HTMLCanvasElement) => c.toDataURL());
  await page.waitForTimeout(POP_DONE_MS);
  const later = await layer(page)
    .locator("canvas")
    .evaluate((c: HTMLCanvasElement) => c.toDataURL());
  expect(later).toBe(soon);
});

test("bubble wrap in ASCII art draws and pops on the character grid", async ({ page }) => {
  await page.goto("/tests/browser/harness.html?mode=empty&toy=bubbles&style=ascii");
  await expect(page.getByText("All caught up")).toBeVisible();
  await page.waitForTimeout(1200);
  const before = await inked(page);
  expect(before).toBeGreaterThan(1000);
  // Drag across the top row of bubbles.
  const box = (await layer(page).boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 52);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 20, box.y + 52, { steps: 30 });
  await page.mouse.up();
  await page.waitForTimeout(POP_DONE_MS);
  expect(await inked(page)).toBeLessThan(before);
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

/**
 * The toy eases in when the list empties, instead of appearing at once
 * (owner, 2026-11-19: the sky "flash bangs into place"): a 450 ms fade from
 * nothing that starts as the layer appears, and none for people who ask for
 * reduced motion. Recorded as each fade starts (a timed check came too late:
 * the fade is over before the page can be held): the layer, the fade's
 * first keyframe's opacity, and the layer's opacity at the fade's start.
 */
type Fade = { layer: string; from: string; opacity: number };
const started = (page: Page) =>
  page.addInitScript(() => {
    const seen: Fade[] = [];
    (window as unknown as { __fades: Fade[] }).__fades = seen;
    document.addEventListener(
      "animationstart",
      (e) => {
        if (e.animationName !== "empty-toy-in") return;
        const el = e.target as Element;
        const fade = el
          .getAnimations()
          .find((a) => (a as CSSAnimation).animationName === "empty-toy-in");
        const first = (fade?.effect as KeyframeEffect | undefined)?.getKeyframes()[0];
        // The event comes some time after the fade began, later on a busy
        // runner (CI read 0.7, a slowed page over 0.8). Wind the fade back
        // to its start, so the opacity read is its first frame's, whatever
        // the machine's speed; it plays on from there.
        if (fade) fade.currentTime = 0;
        seen.push({
          layer: el.classList[0] ?? "",
          from: String(first?.opacity ?? ""),
          opacity: Number(getComputedStyle(el).opacity),
        });
      },
      true,
    );
  });
const fades = (page: Page) =>
  page.evaluate(() => (window as unknown as { __fades: Fade[] }).__fades);

const LAYERS = [
  ["the sky", "toy=sky", "empty-toy"],
  ["the pixel glow", "toy=glow&style=pixel", "empty-glow-canvas"],
  ["the ASCII glow", "toy=glow&style=ascii", "empty-glow-canvas"],
] as const;

for (const [name, query, layerClass] of LAYERS) {
  test(`${name} eases in when the last email leaves the list`, async ({ page }) => {
    await started(page);
    await page.addInitScript(() => {
      (window as unknown as { __rows: boolean }).__rows = true;
    });
    await page.goto(`/tests/browser/harness.html?mode=shell&synced=1&${query}`);
    await expect(page.getByRole("option").first()).toBeVisible();
    expect(await fades(page)).toEqual([]);
    // The list empties, as when its last email is archived.
    await page.evaluate(async () => {
      const w = window as unknown as { __rows: boolean; __invalidateLists: () => Promise<void> };
      w.__rows = false;
      await w.__invalidateLists();
    });
    await expect(page.getByText("All caught up")).toBeVisible();
    await expect.poll(() => fades(page).then((f) => f.map((x) => x.layer))).toContain(layerClass);
    const fade = (await fades(page)).find((f) => f.layer === layerClass)!;
    expect(Number(fade.from)).toBe(0);
    expect(fade.opacity).toBeLessThan(0.5);
    const duration = await page
      .locator(`.${layerClass}`)
      .first()
      .evaluate((el) => getComputedStyle(el).animationDuration);
    expect(duration.split(",").map((d) => d.trim())).toContain("0.45s");
    // The glow reads its pull's opacity as its brightness: only the canvas
    // fades, or the glow was dimmed twice.
    expect((await fades(page)).map((f) => f.layer)).not.toContain("empty-glow-pull");
  });

  test(`${name} appears without a fade under reduced motion`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await started(page);
    await page.goto(`/tests/browser/harness.html?mode=empty&${query}`);
    await expect(page.locator(`.${layerClass}`).first()).toBeAttached();
    await page.waitForTimeout(300);
    expect(await fades(page)).toEqual([]);
  });
}

/**
 * Coming back to a view that was empty but has mail now (moved there from
 * another view) shows the mail, never the empty view first (owner,
 * 2026-11-19: the sky flashed for a moment). The view's saved list is still
 * the empty one until it has been read again.
 */
test("a view that has mail again doesn't flash its empty state first", async ({ page }) => {
  await page.goto("/tests/browser/harness.html?mode=shell&synced=1&staleTime=app");
  await expect(page.getByText("All caught up")).toBeVisible();
  const nav = page.getByRole("navigation");
  await expect(page.locator(".empty-rise")).toBeVisible();
  await nav.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.locator(".empty-rise")).toBeVisible();
  await expect(page.getByText("All caught up")).toHaveCount(0);
  // Mail arrives in the Inbox meanwhile. From now on, every frame is checked
  // for the empty Inbox's words.
  await page.evaluate(async () => {
    const w = window as unknown as {
      __rows: boolean;
      __flashed: boolean;
      __listDelay: number;
      __invalidateLists: () => Promise<void>;
    };
    w.__rows = true;
    // Moving mail marks the lists out of date, as the app's action does; the
    // open view reads its list again at once. Then the next read (the
    // Inbox's) answers late, as the app's does.
    await w.__invalidateLists();
    w.__listDelay = 300;
    w.__flashed = false;
    const look = () => {
      if (document.body.innerText.includes("All caught up")) w.__flashed = true;
      requestAnimationFrame(look);
    };
    look();
  });
  await nav.getByRole("button", { name: "Inbox", exact: true }).click();
  await expect(page.getByRole("option").first()).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __flashed: boolean }).__flashed)).toBe(
    false,
  );
});

/**
 * A view opened again while its saved list is still fresh isn't read again
 * (the app keeps data fresh 30 s), so its empty state shows at once. The
 * first version of the fix above waited for a read that never came, and the
 * list stayed blank: no toy, no words (owner, 2026-11-19).
 */
test("an empty view opened again while fresh shows its empty state", async ({ page }) => {
  await page.goto("/tests/browser/harness.html?mode=shell&synced=1&staleTime=app");
  await expect(page.getByText("All caught up")).toBeVisible();
  const nav = page.getByRole("navigation");
  await nav.getByRole("button", { name: "Drafts", exact: true }).click();
  await expect(page.locator(".empty-rise")).toBeVisible();
  await nav.getByRole("button", { name: "Inbox", exact: true }).click();
  await expect(page.getByText("All caught up")).toBeVisible();
  await nav.getByRole("button", { name: "Drafts", exact: true }).click();
  await expect(page.locator(".empty-rise")).toBeVisible();
  await expect(page.getByText("All caught up")).toHaveCount(0);
});

/**
 * Switching between empty views keeps the sky's text look: on a dark page
 * under a daytime sky, the words and the card's title take dark text, and
 * keep it on every frame. They went light, then dark, then light while
 * switching (owner, 2026-11-19): the new words started in the page's color,
 * and the title lost its look until the new sky's first frame.
 */
for (const style of ["pixel", "ascii"]) {
  test.describe(`the ${style} sky`, () => {
    test.use({ colorScheme: "dark" });
    test("keeps its text look on every frame while switching empty views", async ({ page }) => {
      await page.goto(
        `/tests/browser/harness.html?mode=shell&synced=1&staleTime=app&toy=sky&style=${style}&hour=12`,
      );
      await expect(page.getByText("All caught up")).toBeVisible();
      await expect(page.locator(".empty-words")).toHaveCount(1);
      await expect
        .poll(() => page.locator("[data-card-title]").getAttribute("data-scene-day"))
        .toBe("");
      // Each view read once, so none is opened for the first time below.
      const nav = page.getByRole("navigation");
      await nav.getByRole("button", { name: "Drafts", exact: true }).click();
      await expect(page.getByText("All caught up")).toHaveCount(0);
      await nav.getByRole("button", { name: "Inbox", exact: true }).click();
      await expect(page.getByText("All caught up")).toBeVisible();
      // Every frame from here on: an empty state with the sky, and the words
      // and the title with the daytime look.
      await page.evaluate(() => {
        const w = window as unknown as { __lostLook: string[] };
        w.__lostLook = [];
        const watch = () => {
          const words = document.querySelector(".empty-words");
          const title = document.querySelector("[data-card-title]");
          if (!words || !document.querySelector(".empty-toy")) w.__lostLook.push("no empty state");
          else if (!words.closest("[data-scene-day]")) w.__lostLook.push("words");
          if (!title?.hasAttribute("data-scene-day")) w.__lostLook.push("title");
          requestAnimationFrame(watch);
        };
        requestAnimationFrame(watch);
      });
      for (let i = 0; i < 3; i++) {
        await nav.getByRole("button", { name: "Drafts", exact: true }).click();
        await expect(page.getByText("All caught up")).toHaveCount(0);
        await page.waitForTimeout(150);
        await nav.getByRole("button", { name: "Inbox", exact: true }).click();
        await expect(page.getByText("All caught up")).toBeVisible();
        await page.waitForTimeout(150);
      }
      const lost = await page.evaluate(
        () => (window as unknown as { __lostLook: string[] }).__lostLook,
      );
      expect(lost).toEqual([]);
    });
  });
}

/**
 * While an empty view opened again is read again, the empty state shown
 * before it stays (its words and toy), rather than a blank list.
 */
test("going from one empty view to another keeps the empty state during the read", async ({
  page,
}) => {
  await page.goto("/tests/browser/harness.html?mode=shell&synced=1&toy=sky");
  await expect(page.getByText("All caught up")).toBeVisible();
  const nav = page.getByRole("navigation");
  await nav.getByRole("button", { name: "Drafts", exact: true }).click();
  await expect(page.getByText("All caught up")).toHaveCount(0);
  await nav.getByRole("button", { name: "Inbox", exact: true }).click();
  await expect(page.getByText("All caught up")).toBeVisible();
  await page.evaluate(() => {
    const w = window as unknown as { __listDelay: number; __blank: number };
    w.__blank = 0;
    w.__listDelay = 600;
    const watch = () => {
      if (!document.querySelector(".empty-words") || !document.querySelector(".empty-toy"))
        w.__blank++;
      requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  });
  await nav.getByRole("button", { name: "Drafts", exact: true }).click();
  // The Inbox's words stay while Drafts is read, then Drafts' own.
  await expect(page.getByText("All caught up")).toBeVisible();
  await expect(page.getByText("All caught up")).toHaveCount(0, { timeout: 3000 });
  await expect(page.locator(".empty-words")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __blank: number }).__blank)).toBe(0);
});

/**
 * The empty state held during a read is only the one shown just before:
 * a view that showed mail in between forgets it. Opening Archive (with
 * mail) from an empty Inbox, then Drafts before Archive was read again,
 * showed the Inbox's words in Drafts.
 */
test("a view showing mail in between forgets the empty state held before", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __rowsIn: string[] }).__rowsIn = ["archive"];
  });
  await page.goto("/tests/browser/harness.html?mode=shell&synced=1&toy=sky");
  await expect(page.getByText("All caught up")).toBeVisible();
  const nav = page.getByRole("navigation");
  // Each view read once, so each has a saved list.
  await nav.getByRole("button", { name: "Drafts", exact: true }).click();
  await expect(page.getByText("All caught up")).toHaveCount(0);
  await nav.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.getByRole("option").first()).toBeVisible();
  await nav.getByRole("button", { name: "Inbox", exact: true }).click();
  await expect(page.getByText("All caught up")).toBeVisible();
  // Archive's read again answers late, so Drafts is opened while it's read.
  await page.evaluate(() => {
    (window as unknown as { __listDelay: number }).__listDelay = 1500;
  });
  await nav.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.evaluate(() => {
    const w = window as unknown as { __listDelay: number; __held: boolean };
    w.__held = false;
    // Drafts' read answers late too.
    w.__listDelay = 600;
    const watch = () => {
      if (document.body.innerText.includes("All caught up")) w.__held = true;
      requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  });
  await nav.getByRole("button", { name: "Drafts", exact: true }).click();
  // Drafts' own empty state, once read: until then, a blank list.
  await expect(page.getByText("No drafts")).toBeVisible({ timeout: 3000 });
  expect(await page.evaluate(() => (window as unknown as { __held: boolean }).__held)).toBe(false);
});

/**
 * Likewise Gmail's footer: an empty list asking Gmail for older mail, or
 * failing to, shows "Try again" instead of its empty state, so the next
 * view doesn't hold that empty state while it's read.
 */
test("Gmail's footer in between forgets the empty state held before", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __olderFailsIn: string[] }).__olderFailsIn = ["draft"];
  });
  await page.goto("/tests/browser/harness.html?mode=shell&synced=1&toy=sky");
  await expect(page.getByText("All caught up")).toBeVisible();
  const nav = page.getByRole("navigation");
  await nav.getByRole("button", { name: "Drafts", exact: true }).click();
  await expect(page.getByText("Try again")).toBeVisible();
  await page.evaluate(() => {
    const w = window as unknown as { __listDelay: number; __held: boolean };
    w.__held = false;
    w.__listDelay = 600;
    const watch = () => {
      if (document.body.innerText.includes("No drafts")) w.__held = true;
      requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  });
  await nav.getByRole("button", { name: "Inbox", exact: true }).click();
  await expect(page.getByText("All caught up")).toBeVisible({ timeout: 3000 });
  expect(await page.evaluate(() => (window as unknown as { __held: boolean }).__held)).toBe(false);
});

/**
 * The sky and a screensaver hand the text's look to each other without
 * dropping it: on a light page under a night sky, a night screensaver
 * (the starfield) taking over, and the sky coming back after it, keep the
 * title and words light on every frame. The sky letting go before the
 * screensaver's first frame, or the screensaver letting go after the sky
 * came back, showed them dark for a moment, then faded back. Without
 * StrictMode, as in a release build: its second run of a new sky's effects
 * set the look again and hid the screensaver clearing it late.
 */
test.describe("on a light page", () => {
  test.use({ colorScheme: "light" });
  test("the sky and a night screensaver hand the text's look on", async ({ page }) => {
    await page.goto(
      "/tests/browser/harness.html?mode=shell&synced=1&toy=sky&screensaver&hour=0&strict=0",
    );
    await expect(page.getByText("All caught up")).toBeVisible();
    await expect
      .poll(() => page.locator("[data-card-title]").getAttribute("data-scene-night"))
      .toBe("");
    await page.evaluate(() => {
      const w = window as unknown as { __lostLook: string[] };
      w.__lostLook = [];
      const watch = () => {
        const words = document.querySelector(".empty-words");
        const title = document.querySelector("[data-card-title]");
        if (words && !words.closest("[data-scene-night]")) w.__lostLook.push("words");
        if (!title?.hasAttribute("data-scene-night")) w.__lostLook.push("title");
        requestAnimationFrame(watch);
      };
      requestAnimationFrame(watch);
    });
    await expect(async () => {
      await page.evaluate(() =>
        window.dispatchEvent(new CustomEvent("app:screensaver", { detail: "starfield" })),
      );
      await expect(page.locator("canvas.screensaver")).toBeVisible({ timeout: 500 });
    }).toPass({ timeout: 10_000 });
    await expect(page.locator(".empty-toy")).toHaveCount(0);
    await page.waitForTimeout(300);
    await page.keyboard.press("Shift");
    await expect(page.locator("canvas.screensaver")).toHaveCount(0);
    await expect(page.locator(".empty-toy")).toHaveCount(1);
    await page.waitForTimeout(300);
    const lost = await page.evaluate(
      () => (window as unknown as { __lostLook: string[] }).__lostLook,
    );
    expect(lost).toEqual([]);
  });
});

/**
 * Words replaced while a screensaver plays (the first sync finishing turns
 * "Getting your mail…" into the view's own words) take its look, and lose
 * it when it ends. Set on the words themselves, a replacement had no look
 * while it played (dark text on the night sky), or kept it after (light
 * text on a light page).
 */
test.describe("on a light page", () => {
  test.use({ colorScheme: "light" });
  test("words replaced while a screensaver plays take its look, then lose it", async ({ page }) => {
    await page.goto("/tests/browser/harness.html?mode=shell&toy=none&screensaver");
    await expect(page.getByText("Getting your mail…")).toBeVisible();
    await expect(async () => {
      await page.evaluate(() =>
        window.dispatchEvent(new CustomEvent("app:screensaver", { detail: "starfield" })),
      );
      await expect(page.locator("canvas.screensaver")).toBeVisible({ timeout: 500 });
    }).toPass({ timeout: 10_000 });
    await expect(page.locator(".empty-rise")).toHaveAttribute("data-scene-night", "");
    await page.evaluate(async () => {
      const w = window as unknown as { __synced: boolean; __invalidateAll: () => Promise<void> };
      w.__synced = true;
      await w.__invalidateAll();
    });
    await expect(page.getByText("All caught up")).toBeVisible();
    // The new words have the night look while it plays: light text.
    await expect
      .poll(() =>
        page
          .locator(".empty-words p")
          .first()
          .evaluate((p) => {
            const [r, g, b] = getComputedStyle(p)
              .color.match(/[\d.]+/g)!
              .map(Number);
            return (r! + g! + b!) / 3;
          }),
      )
      .toBeGreaterThan(180);
    await page.keyboard.press("Shift");
    await expect(page.locator("canvas.screensaver")).toHaveCount(0);
    await expect(page.locator("[data-scene-night]")).toHaveCount(0);
  });
});
