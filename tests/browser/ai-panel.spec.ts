import { expect, type Page, test } from "@playwright/test";

/**
 * The writing assistant opening and closing (owner feedback, 2026-10-21):
 * the floating card bounces as a whole on either side without its form
 * moving for good, and an inline reply stays put however often the panel
 * opens and closes (it used to creep under the pinned Send bar).
 */

/** Samples, every frame for `ms`, the card's nudge and the form's left edge. */
async function sampleCard(page: Page, ms: number) {
  return page.evaluate(
    (duration) =>
      new Promise<{ translate: number[]; formX: number[] }>((resolve) => {
        const card = document.querySelector<HTMLElement>("section.compose-card")!;
        // The message's form (the panel has a form of its own, the chat box).
        const form = card.querySelector<HTMLElement>('form[aria-label="New message"]')!;
        const out = { translate: [] as number[], formX: [] as number[] };
        const end = performance.now() + duration;
        const tick = () => {
          const t = getComputedStyle(card).translate;
          out.translate.push(t === "none" ? 0 : parseFloat(t));
          out.formX.push(form.getBoundingClientRect().left);
          if (performance.now() < end) requestAnimationFrame(tick);
          else resolve(out);
        };
        requestAnimationFrame(tick);
      }),
    ms,
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
    await page.waitForTimeout(500);
    const before = (await form.boundingBox())!;

    const opening = sampleCard(page, 700);
    await toggleAssistant(page);
    const open = await opening;
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

    const closing = sampleCard(page, 700);
    await toggleAssistant(page);
    const closed = await closing;
    const pulled =
      opensOn === "left" ? Math.max(...closed.translate) : Math.min(...closed.translate);
    expect(Math.abs(pulled)).toBeGreaterThan(6);
    expect(Math.sign(pulled)).toBe(opensOn === "left" ? 1 : -1);
    for (const x of closed.formX) expect(Math.abs(x - before.x)).toBeLessThanOrEqual(16);
    expect(Math.abs(closed.formX.at(-1)! - before.x)).toBeLessThan(0.5);
    await expect(page.getByRole("complementary", { name: "Write with AI" })).toHaveCount(0);
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
          }, 450);
        }),
    );
    expect(tops.length, `toggle ${i + 1} animated`).toBeGreaterThan(2);
    for (const t of tops) expect(Math.abs(t - start), `toggle ${i + 1}`).toBeLessThanOrEqual(2);
    // oxlint-disable-next-line no-await-in-loop -- measured after each toggle
    expect(Math.abs((await top()) - start), `after toggle ${i + 1}`).toBeLessThan(1);
  }
});
