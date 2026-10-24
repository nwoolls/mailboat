import { expect, test } from "@playwright/test";

/**
 * The floating composer flashed see-through just after the AI panel's
 * bounce (owner report, 2026-10-21; still there 2026-10-24 after a layer
 * fix). The bounce's animation took the place of the card's opening fade,
 * so when the bounce ended the fade played again, from fully see-through.
 * The card must stay opaque from before the toggle until well after.
 */
test("the card never fades when the AI panel opens or closes", async ({ page }) => {
  await page.goto("/tests/browser/harness.html?mode=card");
  const card = page.locator("section.compose-card");
  await expect(card).toBeVisible();
  // Past its own opening fade.
  await page.waitForTimeout(400);
  for (let i = 0; i < 2; i++) {
    // oxlint-disable-next-line no-await-in-loop -- one toggle after another, on purpose
    const lowest = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const el = document.querySelector<HTMLElement>("section.compose-card")!;
          document.querySelector<HTMLButtonElement>('button[aria-label="Write with AI"]')!.click();
          let min = 1;
          const end = performance.now() + 900;
          const tick = () => {
            min = Math.min(min, Number(getComputedStyle(el).opacity));
            if (performance.now() < end) requestAnimationFrame(tick);
            else resolve(min);
          };
          requestAnimationFrame(tick);
        }),
    );
    expect(lowest, `toggle ${i + 1}`).toBeGreaterThan(0.99);
  }
});
