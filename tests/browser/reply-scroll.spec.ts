import { expect, type Page, test } from "@playwright/test";

/**
 * Reply with AI (owner reports, 2026-10-22 and 10-24): the reader stopped
 * partway down the last email, or showed only the AI chat with the reply
 * below it. The reply, down to its Send button, should end up in view,
 * and all of it when it fits. Since 2026-11-23 the reply sticks to the
 * bottom of the reader until the person scrolls up (owner).
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

/**
 * Waits until the conversation has finished laying out (its height the same
 * for half a second), as it has long before a person clicks Reply. On a slow
 * machine (CI) the email above was still being measured after the click,
 * and the reply was sometimes left out of view. Clicking while it is still
 * loading is a separate case, for tests of its own later (docs/ROADMAP.md,
 * Bug backlog).
 */
async function contentSettled(page: Page, selector = ".reader-scroll > *") {
  await page.evaluate(async (which) => {
    const content = document.querySelector(which)!;
    const frame = () => new Promise((done) => requestAnimationFrame(done));
    let height = content.getBoundingClientRect().height;
    let since = performance.now();
    const start = since;
    while (performance.now() - since < 500 && performance.now() - start < 15_000) {
      await frame();
      const now = content.getBoundingClientRect().height;
      if (now !== height) {
        height = now;
        since = performance.now();
      }
    }
  }, selector);
}

for (const height of [640, 360])
  for (const button of ["Reply", "Reply with AI"]) {
    test(`${button}, ${height}px reader: the reply scrolls into view`, async ({ page }) => {
      await page.goto("/tests/browser/harness.html?mode=inline");
      await expect(page.getByTitle("Message content")).toBeVisible();
      await page.evaluate((h) => {
        document.querySelector<HTMLElement>("#root > div")!.style.height = `${h}px`;
      }, height);
      await contentSettled(page);
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
 *
 * Off from 2026-11-11 to 2026-11-16: in CI it sometimes found the reply
 * hundreds of pixels below the reader. A follow scroll cut short after the
 * reply stopped growing did that, and the follow now finishes such a scroll
 * (docs/ROADMAP.md → 0.3.0 → Bugs); turned back on at the owner's word.
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
  await contentSettled(page);
  await page.getByRole("button", { name: "Reply with AI", exact: true }).click();
  await expect(page.locator('section[aria-label="Reply"]')).toBeVisible();
  // Past the slowed animations and the old second-and-a-half window.
  await page.waitForTimeout(4000);
  await expect
    .poll(async () => (await replyInView(page)).bottom, {
      message: "the reply's end (its Send button) is in view",
    })
    .toBeGreaterThanOrEqual(-1);
});

/** Grows the reply as a signature arriving would, then waits a moment. */
async function growReply(page: Page) {
  await page.evaluate(async () => {
    const extra = document.createElement("div");
    extra.style.height = "60px";
    document.querySelector('section[aria-label="Reply"] form')!.append(extra);
    await new Promise((done) => setTimeout(done, 800));
  });
}

/** How far the reader is from its end, in pixels. */
async function fromEnd(page: Page) {
  return page.evaluate(() => {
    const reader = document.querySelector<HTMLElement>(".reader-scroll")!;
    return reader.scrollHeight - reader.clientHeight - reader.scrollTop;
  });
}

/** Opens Reply with AI in a 360px reader and waits for it to lay out. */
async function openReplyWithAi(page: Page) {
  await page.goto("/tests/browser/harness.html?mode=inline");
  await expect(page.getByTitle("Message content")).toBeVisible();
  await page.evaluate(() => {
    document.querySelector<HTMLElement>("#root > div")!.style.height = "360px";
  });
  await contentSettled(page);
  await page.getByRole("button", { name: "Reply with AI", exact: true }).click();
  await expect(page.getByRole("button", { name: "Say yes" })).toBeVisible();
  await contentSettled(page, 'section[aria-label="Reply"]');
  await expect.poll(() => fromEnd(page), { timeout: 15_000 }).toBeLessThanOrEqual(2);
}

/**
 * Scrolling up over the email itself (a sandboxed frame, whose input never
 * reaches the app's window: the reader just scrolls) lets the reply go, so
 * the reader doesn't snap back to it while the person reads.
 */
test("Reply with AI: scrolling up to read lets the reply go", async ({ page }) => {
  await openReplyWithAi(page);
  await page.evaluate(() => {
    document.querySelector<HTMLElement>(".reader-scroll")!.scrollTop = 0;
  });
  await growReply(page);
  expect(await page.evaluate(() => document.querySelector(".reader-scroll")!.scrollTop)).toBe(0);
});

/** Scrolling up slowly, a few pixels at a time, lets it go too. */
test("Reply with AI: scrolling up slowly lets the reply go", async ({ page }) => {
  await openReplyWithAi(page);
  const before = await page.evaluate(async () => {
    const reader = document.querySelector<HTMLElement>(".reader-scroll")!;
    const frame = () => new Promise((done) => requestAnimationFrame(done));
    for (let i = 0; i < 3; i++) {
      reader.scrollTop -= 3;
      await frame();
      await frame();
    }
    return reader.scrollTop;
  });
  await growReply(page);
  expect(await page.evaluate(() => document.querySelector(".reader-scroll")!.scrollTop)).toBe(
    before,
  );
});

/**
 * Scrolled back down to the end, where the Send bar joins the reply again,
 * it sticks again (owner, 2026-11-23).
 */
test("Reply with AI: scrolling back to the end sticks the reply again", async ({ page }) => {
  await openReplyWithAi(page);
  await page.evaluate(async () => {
    const reader = document.querySelector<HTMLElement>(".reader-scroll")!;
    reader.scrollTop = 0;
    await new Promise((done) => setTimeout(done, 100));
    reader.scrollTop = reader.scrollHeight;
    await new Promise((done) => setTimeout(done, 100));
  });
  await growReply(page);
  expect(await fromEnd(page)).toBeLessThanOrEqual(2);
});

/**
 * Typing doesn't let go (the old follow stopped on any key): the reply
 * still sticks to the bottom as it grows afterwards.
 */
test("Reply: typing keeps the reply stuck to the bottom", async ({ page }) => {
  await page.goto("/tests/browser/harness.html?mode=inline");
  await expect(page.getByTitle("Message content")).toBeVisible();
  await page.evaluate(() => {
    document.querySelector<HTMLElement>("#root > div")!.style.height = "360px";
  });
  await contentSettled(page);
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  await contentSettled(page, 'section[aria-label="Reply"]');
  await expect.poll(() => fromEnd(page), { timeout: 15_000 }).toBeLessThanOrEqual(2);
  for (let i = 0; i < 4; i++) await page.keyboard.press("Enter");
  await page.keyboard.type("Thanks, see you then.");
  await growReply(page);
  expect(await fromEnd(page)).toBeLessThanOrEqual(2);
});

/**
 * A click in the conversation above (opening an email) lets go, so the
 * email opens downward where it was clicked instead of growing up out of
 * sight.
 */
test("Reply with AI: a click above the reply lets it go", async ({ page }) => {
  await openReplyWithAi(page);
  const before = await page.evaluate(() => {
    const reader = document.querySelector<HTMLElement>(".reader-scroll")!;
    reader.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    return reader.scrollTop;
  });
  await growReply(page);
  expect(await page.evaluate(() => document.querySelector(".reader-scroll")!.scrollTop)).toBe(
    before,
  );
});

/**
 * The smooth scroll that opens a reply can be cut short or left undone (in
 * CI the reply was left hundreds of pixels below the reader: docs/ROADMAP.md
 * → Flaky tests). Here every smooth scroll of the reader is dropped, so the
 * opening one never happens; the reply still ends up at the bottom.
 */
test("Reply with AI: a smooth scroll left undone still ends at the reply", async ({ page }) => {
  await page.goto("/tests/browser/harness.html?mode=inline");
  await expect(page.getByTitle("Message content")).toBeVisible();
  await page.evaluate(() => {
    document.querySelector<HTMLElement>("#root > div")!.style.height = "360px";
    const scrollTo = Element.prototype.scrollTo;
    Element.prototype.scrollTo = function (this: Element, ...args: unknown[]) {
      const options = args[0] as ScrollToOptions | undefined;
      if (this.classList.contains("reader-scroll") && options?.behavior === "smooth") return;
      return (scrollTo as (...a: unknown[]) => void).apply(this, args);
    };
  });
  await contentSettled(page);
  await page.getByRole("button", { name: "Reply with AI", exact: true }).click();
  await expect(page.locator('section[aria-label="Reply"]')).toBeVisible();
  await expect
    .poll(async () => (await replyInView(page)).bottom, { timeout: 15_000 })
    .toBeGreaterThanOrEqual(-1);
});
