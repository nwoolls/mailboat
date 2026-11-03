import { expect, type Page, test } from "@playwright/test";

/**
 * The writing assistant opening and closing (owner feedback, 2026-10-21):
 * the floating card bounces as a whole on either side without its form
 * moving for good, and an inline reply stays put however often the panel
 * opens and closes (it used to creep under the pinned Send bar).
 */

type Samples = {
  translate: number[];
  formX: number[];
  done: boolean;
  read?: () => void;
  off?: () => void;
};

/**
 * Starts recording the card's nudge and the form's left edge: every frame,
 * until `stopSampling` (not for a fixed time: on a slow machine the
 * animation can start late). A slow machine also paints few frames, so
 * frames alone can miss the peak of the nudge; when the nudge starts, it is
 * stepped through from start to end, and read at every step, whatever the
 * frame rate.
 */
async function startSampling(page: Page) {
  await page.evaluate(() => {
    const card = document.querySelector<HTMLElement>("section.compose-card")!;
    // The message's form (the panel has a form of its own, the chat box).
    const form = card.querySelector<HTMLElement>('form[aria-label="New message"]')!;
    const out: Samples = { translate: [], formX: [], done: false };
    (window as unknown as { sampled: Samples }).sampled = out;
    const read = () => {
      const t = getComputedStyle(card).translate;
      out.translate.push(t === "none" ? 0 : parseFloat(t));
      out.formX.push(form.getBoundingClientRect().left);
    };
    out.read = read;
    const onStart = (e: AnimationEvent) => {
      if (!e.animationName.startsWith("nudge-")) return;
      const nudge = card
        .getAnimations()
        .find((a) => a instanceof CSSAnimation && a.animationName === e.animationName);
      if (!nudge) return;
      const was = nudge.currentTime;
      const total = Number(nudge.effect!.getComputedTiming().endTime);
      nudge.pause();
      for (let i = 0; i <= 40; i++) {
        nudge.currentTime = (total * i) / 40;
        read();
      }
      nudge.currentTime = was;
      nudge.play();
    };
    card.addEventListener("animationstart", onStart);
    // Removed when sampling stops: the next sampling (the close) must not
    // also step the animation.
    out.off = () => card.removeEventListener("animationstart", onStart);
    const tick = () => {
      read();
      if (!out.done) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/**
 * Waits until every animation that can finish has finished. Endless ones
 * (a spinner, the sync ring) never will, and are left out; a finished one
 * that still holds its end state (fill forwards) counts as done.
 */
async function animationsDone(page: Page) {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (a) =>
          a.effect?.getComputedTiming().iterations === Infinity ||
          a.playState === "finished" ||
          a.playState === "idle",
      ),
  );
}

/** Waits for every animation to finish (plus a couple of frames), then stops. */
async function stopSampling(page: Page) {
  await animationsDone(page);
  return page.evaluate(
    () =>
      new Promise<Samples>((resolve) => {
        const out = (window as unknown as { sampled: Samples }).sampled;
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            // The end state, read on purpose, not left to the last frame.
            out.read?.();
            out.off?.();
            out.done = true;
            resolve({ translate: out.translate, formX: out.formX, done: true });
          }),
        );
      }),
  );
}

async function toggleAssistant(page: Page) {
  await page.getByRole("button", { name: "Write with AI" }).click();
}

for (const [spot, opensOn] of [
  ["bottom-right", "left"],
  ["bottom-left", "right"],
] as const) {
  test(`floating card at ${spot}: the panel opens on the ${opensOn}, the whole card bounces, the form stays`, async ({
    page,
  }) => {
    await page.goto(`/tests/browser/harness.html?mode=card&spot=${spot}`);
    const form = page.locator('section.compose-card form[aria-label="New message"]');
    await expect(form).toBeVisible();
    // Let the card's own entrance settle.
    await animationsDone(page);
    const before = (await form.boundingBox())!;

    await startSampling(page);
    await toggleAssistant(page);
    await expect(page.getByRole("complementary", { name: "Write with AI" })).toBeVisible();
    const open = await stopSampling(page);
    const panel = (await page.getByRole("complementary", { name: "Write with AI" }).boundingBox())!;
    if (opensOn === "left") expect(panel.x).toBeLessThan(before.x);
    else expect(panel.x).toBeGreaterThan(before.x);
    // The whole card nudged the way it grew…
    const pushed = opensOn === "left" ? Math.min(...open.translate) : Math.max(...open.translate);
    expect(Math.abs(pushed)).toBeGreaterThan(6);
    expect(Math.sign(pushed)).toBe(opensOn === "left" ? -1 : 1);
    // …and the form only moved with that nudge, and ended where it was.
    for (const x of open.formX) expect(Math.abs(x - before.x)).toBeLessThanOrEqual(16);
    expect(Math.abs(open.formX.at(-1)! - before.x)).toBeLessThan(0.5);

    await startSampling(page);
    await toggleAssistant(page);
    await expect(page.getByRole("complementary", { name: "Write with AI" })).toHaveCount(0);
    const closed = await stopSampling(page);
    const pulled =
      opensOn === "left" ? Math.max(...closed.translate) : Math.min(...closed.translate);
    expect(Math.abs(pulled)).toBeGreaterThan(6);
    expect(Math.sign(pulled)).toBe(opensOn === "left" ? 1 : -1);
    for (const x of closed.formX) expect(Math.abs(x - before.x)).toBeLessThanOrEqual(16);
    expect(Math.abs(closed.formX.at(-1)! - before.x)).toBeLessThan(0.5);
  });
}

test("inline reply: opening and closing the panel many times never moves the reply", async ({
  page,
}) => {
  await page.goto("/tests/browser/harness.html?mode=inline");
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  const reply = page.locator('section[aria-label="Reply"] form[aria-label="Reply"]');
  await expect(reply).toBeVisible();
  // At the end of the conversation, as when answering.
  await page.locator(".reader-scroll").evaluate((el) => (el.scrollTop = el.scrollHeight));
  await page.waitForTimeout(1800);
  const top = async () => (await reply.boundingBox())!.y;
  const start = await top();

  for (let i = 0; i < 12; i++) {
    // Clicks, then watches the reply in what's painted: after each frame's
    // layout, in an observer created after the panel's own (so after its
    // correction; sampling at the start of a frame reads the panel's new
    // size before it's corrected for).
    // oxlint-disable-next-line no-await-in-loop -- one toggle after another, on purpose
    const tops = await page.evaluate(
      () =>
        new Promise<number[]>((resolve) => {
          const form = document.querySelector(
            'section[aria-label="Reply"] form[aria-label="Reply"]',
          )!;
          document.querySelector<HTMLButtonElement>('button[aria-label="Write with AI"]')!.click();
          const painted: number[] = [];
          let watch: ResizeObserver | null = null;
          // React applies the click a moment later: watch from the first
          // frame the panel is there.
          const attach = () => {
            const panel = document.querySelector(".inline-reveal");
            if (!panel) return void requestAnimationFrame(attach);
            watch = new ResizeObserver(() => painted.push(form.getBoundingClientRect().top));
            watch.observe(panel);
          };
          requestAnimationFrame(attach);
          setTimeout(() => {
            watch?.disconnect();
            resolve(painted);
          }, 900);
        }),
    );
    expect(tops.length, `toggle ${i + 1} animated`).toBeGreaterThan(2);
    for (const t of tops) expect(Math.abs(t - start), `toggle ${i + 1}`).toBeLessThanOrEqual(2);
    // The reply must come back to where it started. Polled, since a slow
    // machine (CI) can still be finishing the animation after the window.
    // oxlint-disable-next-line no-await-in-loop -- measured after each toggle
    await expect
      .poll(async () => Math.abs((await top()) - start), {
        message: `after toggle ${i + 1}`,
        timeout: 3000,
      })
      .toBeLessThan(1);
  }
});

test("inline reply: stays put when the page stalls mid-animation", async ({ page }) => {
  // A slow machine (CI): the page can't paint for a while, so the end of the
  // panel's animation is painted late. The reply used to end up displaced
  // by the part of the animation the correction had already given up on.
  await page.goto("/tests/browser/harness.html?mode=inline");
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  const reply = page.locator('section[aria-label="Reply"] form[aria-label="Reply"]');
  await expect(reply).toBeVisible();
  await page.locator(".reader-scroll").evaluate((el) => (el.scrollTop = el.scrollHeight));
  await page.waitForTimeout(1800);
  const top = async () => (await reply.boundingBox())!.y;
  const start = await top();

  for (let i = 0; i < 4; i++) {
    // oxlint-disable-next-line no-await-in-loop -- one toggle after another, on purpose
    await page.evaluate(() => {
      document.querySelector<HTMLButtonElement>('button[aria-label="Write with AI"]')!.click();
      setTimeout(() => {
        const end = performance.now() + 220;
        while (performance.now() < end);
      }, 90);
    });
    // Each toggle settles before the next (not measured at once: before the
    // click is applied, the reply is still where it started).
    // oxlint-disable-next-line no-await-in-loop -- measured after each toggle
    await page.waitForTimeout(1500);
    // oxlint-disable-next-line no-await-in-loop -- measured after each toggle
    expect(Math.abs((await top()) - start), `after toggle ${i + 1}`).toBeLessThan(1);
  }
});
