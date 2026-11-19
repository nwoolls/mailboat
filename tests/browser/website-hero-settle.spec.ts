import { expect, type Page, test } from "@playwright/test";

/**
 * The website's hero screenshot starts tipped back and settles flat as the
 * page scrolls (website/site.css, measured by website/site.js). It must be
 * flat by the time it reaches the middle of the window, in a short window and
 * a tall one. It used to settle over a fixed 70% of the window's height, so in
 * a tall window it left the top of the screen still tipped (owner report,
 * 2026-11-19).
 */

/** How far the screenshot is still tipped back, in degrees (0 when flat). */
async function tilt(page: Page) {
  return page.evaluate(() => {
    const picture = document.querySelector(".hero-shot picture")!;
    const m = new DOMMatrix(getComputedStyle(picture).transform);
    // A rotation about X puts sin(angle) into m23.
    return Math.round((Math.asin(Math.min(1, Math.abs(m.m23))) * 180) / Math.PI);
  });
}

/** Scrolls so the screenshot's box is centered in the window (plus `offset`; the
 * browser clamps it to the top), and waits two frames. */
async function centerShot(page: Page, offset = 0) {
  await page.evaluate((by) => {
    const box = document.querySelector(".hero-shot")!.getBoundingClientRect();
    const y = box.top + window.scrollY + box.height / 2 - window.innerHeight / 2;
    // The page scrolls smoothly (site.css); jump instead, so the reading
    // isn't taken mid-scroll.
    document.documentElement.style.scrollBehavior = "auto";
    window.scrollTo(0, y + by);
  }, offset);
  await page.evaluate(
    () =>
      new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(null)))),
  );
}

for (const height of [700, 1000, 1400]) {
  test(`hero screenshot is flat once centered in a ${height}px window`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.setViewportSize({ width: 1440, height });
    await page.goto("/website/index.html");
    const supported = await page.evaluate(() => CSS.supports("animation-timeline: scroll()"));
    test.skip(!supported, "this browser has no scroll-driven animations");

    // Give the scroll timeline a frame to attach before the first reading.
    await centerShot(page, -10_000);
    expect(await tilt(page)).toBeGreaterThan(20);
    // 200px short of center, still tipped.
    await centerShot(page, -200);
    expect(await tilt(page)).toBeGreaterThan(0);
    // Just past center: in a tall window, headless WebKit lets the page drift
    // back up to 20px after a jump, with or without this page's script.
    await centerShot(page, 40);
    await expect.poll(() => tilt(page), { timeout: 1000 }).toBe(0);
  });
}
