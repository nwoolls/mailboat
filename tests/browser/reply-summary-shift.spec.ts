import { expect, type Locator, type Page, test } from "@playwright/test";

/**
 * A long reply being written under the AI summary (owner report,
 * 2026-11-11; docs/ROADMAP.md, Bug backlog): each time mail changed the
 * summary was asked again, and the card dropped to its one-line
 * placeholder until the answer came, then grew back. Near the end of the
 * reader that moved the reply under the person's cursor, and a click
 * landed in another line. Draft saves, every few seconds while typing,
 * were such a change.
 */
const PASTED = Array.from(
  { length: 40 },
  (_, i) =>
    `Line ${i + 1}: lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.`,
).join("\n\n");

type HarnessWindow = {
  __summaries: number;
  __order?: string[];
  __mailChanged: () => Promise<void>;
};

async function longReplyScrolled(page: Page) {
  await page.goto("/tests/browser/harness.html?mode=inline&summary=live");
  await expect(page.getByRole("region", { name: "Summary" }).getByRole("listitem")).toHaveCount(4);
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  const editor = page
    .locator('section[aria-label="Reply"]')
    .getByRole("textbox", { name: "Message" });
  await expect(editor).toBeFocused();
  // Pasted, as from another app.
  await editor.evaluate((el, text) => {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    el.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, PASTED);
  // A few new lines.
  for (let i = 0; i < 3; i++) await page.keyboard.press("Enter");
  // Scrolled up a little by hand, to read back over the last lines.
  const reader = (await page.locator(".reader-scroll").boundingBox())!;
  await page.mouse.move(reader.x + reader.width / 2, reader.y + reader.height / 2);
  await page.mouse.wheel(0, -40);
  await page.waitForTimeout(300);
  return editor;
}

/** A pasted line that's on screen, below the middle of the reader. */
async function lineOnScreen(editor: Locator) {
  const n = await editor.evaluate((el) => {
    const reader = document.querySelector(".reader-scroll")!.getBoundingClientRect();
    const middle = reader.top + reader.height / 2;
    const p = [...el.querySelectorAll("p")].find((p) => p.getBoundingClientRect().top > middle);
    return Number(p?.textContent?.match(/^Line (\d+):/)?.[1]);
  });
  expect(n).toBeGreaterThan(0);
  return editor.locator("p", { hasText: new RegExp(`^Line ${n}:`) });
}

/** Mail changes (as a sync brings), and the summary is asked again and answered. */
async function summaryAskedAgain(page: Page) {
  await page.evaluate(async () => {
    const w = window as unknown as HarnessWindow;
    const card = document.querySelector('section[aria-label="Summary"]')!;
    const asked = w.__summaries;
    await w.__mailChanged();
    await new Promise<void>((done) => {
      new MutationObserver(() => {
        if (w.__summaries > asked && card.getAttribute("aria-busy") === "false") done();
      }).observe(card, { attributes: true });
    });
  });
}

test("a long reply scrolled by hand stays put while the summary is asked again", async ({
  page,
}) => {
  const editor = await longReplyScrolled(page);
  const line = await lineOnScreen(editor);
  // The line's place on screen, every frame, from before mail changes until
  // the summary has been asked again and answered.
  const moved = await line.evaluate(async (el) => {
    const w = window as unknown as HarnessWindow;
    const card = document.querySelector('section[aria-label="Summary"]')!;
    const frame = () => new Promise((done) => requestAnimationFrame(done));
    const start = el.getBoundingClientRect().top;
    const asked = w.__summaries;
    let most = 0;
    await w.__mailChanged();
    const end = performance.now() + 2000;
    while (performance.now() < end) {
      await frame();
      most = Math.max(most, Math.abs(el.getBoundingClientRect().top - start));
      if (w.__summaries > asked && card.getAttribute("aria-busy") === "false") break;
    }
    // A few frames more, for the layout after it.
    for (let i = 0; i < 5; i++) {
      await frame();
      most = Math.max(most, Math.abs(el.getBoundingClientRect().top - start));
    }
    return { most, asked: w.__summaries > asked };
  });
  // The summary was asked again (or the test proved nothing).
  expect(moved.asked).toBe(true);
  expect(moved.most, "how far the line moved on screen, in pixels").toBeLessThanOrEqual(1);
});

test("a click on a line of a long reply types there after the summary is asked again", async ({
  page,
}) => {
  const editor = await longReplyScrolled(page);
  const line = await lineOnScreen(editor);
  // The person aims where the line is, and clicks just after the summary
  // was asked again.
  const aim = (await line.boundingBox())!;
  await summaryAskedAgain(page);
  await page.mouse.click(aim.x + aim.width / 2, aim.y + aim.height / 2);
  await page.keyboard.type("TYPED");
  await expect(line).toContainText("TYPED");
});

test("saving the reply as it's typed doesn't ask for the summary again", async ({ page }) => {
  await longReplyScrolled(page);
  const asked = await page.evaluate(() => (window as unknown as HarnessWindow).__summaries);
  // The draft saves 2.5 s after the typing; its "mail changed" event follows.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as HarnessWindow).__order ?? []), {
      timeout: 6000,
    })
    .toContain("draft_save");
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as unknown as HarnessWindow).__summaries)).toBe(asked);
});

/**
 * The same, with nothing but typing (owner report, 2026-11-12): new lines
 * typed at the end of a reply, then a pause, and the draft saves. The
 * summary blinking moved the reader to its very end, where the pinned
 * formatting and Send bar dropped back into place under the reply.
 */
test("typing at the end of a reply, then pausing: the reader and the pinned bar stay put", async ({
  page,
}) => {
  await page.goto("/tests/browser/harness.html?mode=inline&summary=live");
  await expect(page.getByRole("region", { name: "Summary" }).getByRole("listitem")).toHaveCount(4);
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  const editor = page
    .locator('section[aria-label="Reply"]')
    .getByRole("textbox", { name: "Message" });
  await expect(editor).toBeFocused();
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press("Enter");
    await page.keyboard.type(`Line ${i + 1}`);
  }
  await page.waitForTimeout(300);
  const read = () =>
    page.evaluate(() => ({
      top: document.querySelector(".reader-scroll")!.scrollTop,
      pinned: document.querySelector(".reader-foot")!.hasAttribute("data-stuck"),
      saves: ((window as unknown as HarnessWindow).__order ?? []).filter((c) => c === "draft_save")
        .length,
    }));
  const before = await read();
  expect(before.pinned).toBe(true);
  // The draft saves 2.5 s after the typing stops. A save during the typing
  // (a slow machine pausing) may already have happened: wait for the next.
  await expect
    .poll(async () => (await read()).saves, { timeout: 6000 })
    .toBeGreaterThan(before.saves);
  await page.waitForTimeout(1000);
  const after = await read();
  expect(after.top).toBe(before.top);
  expect(after.pinned).toBe(true);
});
