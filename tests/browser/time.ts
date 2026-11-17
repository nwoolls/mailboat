import type { Page } from "@playwright/test";

/**
 * Time the test drives, for tests that measure motion. A test that waits
 * real time (`waitForTimeout`) and then measures an animation depends on
 * how fast the machine is: on a busy CI runner frames come late, and the
 * measurement lands earlier or later in the motion than the test meant.
 * Those tests failed now and then on CI and passed when run again
 * (docs/ROADMAP.md → Flaky tests).
 *
 * `driveTime` fakes the page's clocks (Playwright's `page.clock`: timers,
 * `requestAnimationFrame`, `performance.now`, `Date`) and also runs CSS
 * and Web Animations on that clock, which `page.clock` leaves on real time:
 * on each frame every animation is paused and set to where the fake clock
 * says it is. Then `advance(page, ms)` moves time on by exactly `ms`, a
 * frame (16 ms) at a time, however long that takes for real, and nothing
 * moves between calls.
 *
 * Call `driveTime` before `page.goto`, and `holdTime` once the page has
 * loaded, before the part of the test that measures.
 */
export async function driveTime(page: Page): Promise<void> {
  await page.clock.install();
  await page.addInitScript(() => {
    // Where each running animation was, and the fake clock then, when
    // first seen. One the page itself paused is left alone.
    const seen = new WeakMap<Animation, { from: number; at: number } | null>();
    const step = (now: number) => {
      for (const a of document.getAnimations()) {
        if (!seen.has(a))
          seen.set(
            a,
            a.playState === "running" ? { from: Number(a.currentTime ?? 0), at: now } : null,
          );
        const s = seen.get(a);
        if (!s || a.playState === "finished") continue;
        const t = s.from + (now - s.at) * a.playbackRate;
        // Finished for real, so its end events and `finished` still come.
        if (t >= Number(a.effect?.getComputedTiming().endTime ?? Infinity)) a.finish();
        else {
          a.pause();
          a.currentTime = t;
        }
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

/**
 * Stops the page's time; from here only `advance` moves it on. It stops a
 * second ahead (anything due meanwhile runs): Playwright refuses to stop at
 * a moment that has passed, and the page's clock runs on until it stops.
 */
export async function holdTime(page: Page): Promise<void> {
  await page.clock.pauseAt(Date.now() + 1000);
}

/** Moves the page's time on by `ms`, firing every frame on the way. */
export async function advance(page: Page, ms: number): Promise<void> {
  await page.clock.runFor(ms);
}
