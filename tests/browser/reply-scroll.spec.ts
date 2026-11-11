import { expect, type Page, test } from "@playwright/test";

/**
 * Reply with AI (owner reports, 2026-10-22 and 10-24): the reader stopped
 * partway down the last email, or showed only the AI chat with the reply
 * below it. The reply, down to its Send button, should end up in view,
 * and all of it when it fits.
 */
async function replyInView(page: Page) {
  return page.evaluate(() => {
    const reader = document.querySelector(".reader-scroll")!.getBoundingClientRect();
    const reply = document.querySelector('section[aria-label="Reply"]')!.getBoundingClientRect();
    return {
      top: reply.top - reader.top,
      bottom: reader.bottom - reply.bottom,
      fits: reply.height <= reader.height,
    };
  });
}

for (const height of [640, 360])
  for (const button of ["Reply", "Reply with AI"]) {
    test(`${button}, ${height}px reader: the reply scrolls into view`, async ({ page }) => {
      await page.goto("/tests/browser/harness.html?mode=inline");
      await expect(page.getByTitle("Message content")).toBeVisible();
      await page.evaluate((h) => {
        document.querySelector<HTMLElement>("#root > div")!.style.height = `${h}px`;
      }, height);
      await page.getByRole("button", { name: button, exact: true }).click();
      await expect(page.locator('section[aria-label="Reply"]')).toBeVisible();
      // The smooth scroll and the panel's reveal take a moment, longer on a
      // slow machine (CI): not a fixed wait then one look (it once found the
      // reply 397 px above the reader mid-scroll), but polled until the reply
      // is in view: its end (the Send button) always, all of it when it fits.
      const inView = async () => {
        const { top, bottom, fits } = await replyInView(page);
        return bottom >= -1 && (!fits || top >= -1);
      };
      await expect
        .poll(inView, { message: "the reply scrolls into view", timeout: 15_000 })
        .toBe(true);
      // And it stays there: a scroll that overshot or came back would show now.
      await page.waitForTimeout(600);
      const { top, bottom, fits } = await replyInView(page);
      expect(bottom).toBeGreaterThanOrEqual(-1);
      if (fits) expect(top).toBeGreaterThanOrEqual(-1);
    });
  }

/**
 * A slow machine (CI) finished laying out the email and the assistant after
 * the reply had stopped being followed, and left it part way below the
 * reader. Slowed animations stand in for the slow machine here.
 */
test("Reply with AI, 360px reader, slow machine: the reply still scrolls into view", async ({
  page,
}) => {
  await page.goto("/tests/browser/harness.html?mode=inline");
  await expect(page.getByTitle("Message content")).toBeVisible();
  await page.addStyleTag({
    content: "*{animation-duration:2500ms!important;transition-duration:2500ms!important}",
  });
  await page.evaluate(() => {
    document.querySelector<HTMLElement>("#root > div")!.style.height = "360px";
  });
  await page.getByRole("button", { name: "Reply with AI", exact: true }).click();
  await expect(page.locator('section[aria-label="Reply"]')).toBeVisible();
  // Past the slowed animations and the old second-and-a-half window.
  await page.waitForTimeout(4000);
  await expect
    .poll(async () => (await replyInView(page)).bottom, {
      message: "the reply's end (its Send button) is in view",
      timeout: 5_000,
    })
    .toBeGreaterThanOrEqual(-1);
});

/**
 * Scrolling up over the email itself (a sandboxed frame, whose input never
 * reaches the app's window: the reader just scrolls) stops the follow, so
 * the reader doesn't snap back to the reply while the person reads.
 */
test("Reply with AI: scrolling up to read stops the reply being followed", async ({ page }) => {
  await page.goto("/tests/browser/harness.html?mode=inline");
  await expect(page.getByTitle("Message content")).toBeVisible();
  await page.evaluate(() => {
    document.querySelector<HTMLElement>("#root > div")!.style.height = "360px";
  });
  await page.getByRole("button", { name: "Reply with AI", exact: true }).click();
  await expect
    .poll(async () => (await replyInView(page)).bottom, { timeout: 15_000 })
    .toBeGreaterThanOrEqual(-1);
  // The reader moved up, as a wheel over the email moves it, then the reply
  // grows (as a signature arriving would): the reader stays where it is.
  const scrollTop = await page.evaluate(async () => {
    const reader = document.querySelector<HTMLElement>(".reader-scroll")!;
    reader.scrollTop = 0;
    await new Promise((done) => setTimeout(done, 100));
    const extra = document.createElement("div");
    extra.style.height = "60px";
    document.querySelector('section[aria-label="Reply"] form')!.append(extra);
    await new Promise((done) => setTimeout(done, 800));
    return reader.scrollTop;
  });
  expect(scrollTop).toBe(0);
});

/** Scrolling up slowly, a few pixels at a time, adds up and stops it too. */
test("Reply with AI: scrolling up slowly stops the reply being followed", async ({ page }) => {
  await page.goto("/tests/browser/harness.html?mode=inline");
  await expect(page.getByTitle("Message content")).toBeVisible();
  await page.evaluate(() => {
    document.querySelector<HTMLElement>("#root > div")!.style.height = "360px";
  });
  await page.getByRole("button", { name: "Reply with AI", exact: true }).click();
  await expect
    .poll(async () => (await replyInView(page)).bottom, { timeout: 15_000 })
    .toBeGreaterThanOrEqual(-1);
  const moved = await page.evaluate(async () => {
    const reader = document.querySelector<HTMLElement>(".reader-scroll")!;
    const frame = () => new Promise((done) => requestAnimationFrame(done));
    // Twenty steps of 3 px, each its own scroll event.
    for (let i = 0; i < 20; i++) {
      reader.scrollTop -= 3;
      await frame();
      await frame();
    }
    const read = reader.scrollTop;
    const extra = document.createElement("div");
    extra.style.height = "60px";
    document.querySelector('section[aria-label="Reply"] form')!.append(extra);
    await new Promise((done) => setTimeout(done, 800));
    return reader.scrollTop - read;
  });
  expect(moved).toBe(0);
});
