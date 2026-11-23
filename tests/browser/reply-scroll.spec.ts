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
 * reply stopped growing did that, and the follow was made to finish such a
 * scroll (docs/ROADMAP.md → 0.3.0 → Bugs); turned back on at the owner's
 * word. Since 2026-11-23 there's no follow: the reply sticks to the bottom.
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
    // By hand: a wheel, as the person scrolling sends.
    window.dispatchEvent(new WheelEvent("wheel"));
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
      window.dispatchEvent(new WheelEvent("wheel"));
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
    window.dispatchEvent(new WheelEvent("wheel"));
    reader.scrollTop = 0;
    await new Promise((done) => setTimeout(done, 100));
    window.dispatchEvent(new WheelEvent("wheel"));
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
    reader
      .querySelector("section[data-message-id] > button")!
      .dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    return reader.scrollTop;
  });
  await growReply(page);
  expect(await page.evaluate(() => document.querySelector(".reader-scroll")!.scrollTop)).toBe(
    before,
  );
});

/** A key pressed on an email above (Enter on its header) lets go as a click does. */
test("Reply with AI: a key on an email above the reply lets it go", async ({ page }) => {
  await openReplyWithAi(page);
  const before = await page.evaluate(() => {
    const reader = document.querySelector<HTMLElement>(".reader-scroll")!;
    reader
      .querySelector("section[data-message-id] > button")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    return reader.scrollTop;
  });
  await growReply(page);
  expect(await page.evaluate(() => document.querySelector(".reader-scroll")!.scrollTop)).toBe(
    before,
  );
});

/**
 * A press on the reader itself (its scroll bar) that doesn't scroll keeps
 * the reply stuck: only moving up lets go.
 */
test("Reply with AI: a press on the scroll bar alone keeps the reply stuck", async ({ page }) => {
  await openReplyWithAi(page);
  await page.evaluate(() => {
    document
      .querySelector(".reader-scroll")!
      .dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });
  await growReply(page);
  expect(await fromEnd(page)).toBeLessThanOrEqual(2);
});

/** The window made shorter: the stuck reply stays at the bottom. */
test("Reply with AI: a shorter reader keeps the reply at the bottom", async ({ page }) => {
  await openReplyWithAi(page);
  await page.evaluate(async () => {
    document.querySelector<HTMLElement>("#root > div")!.style.height = "300px";
    await new Promise((done) => setTimeout(done, 300));
  });
  expect(await fromEnd(page)).toBeLessThanOrEqual(2);
});

/**
 * Opening a reply below the fold slides to it rather than jumping, even
 * as the assistant grows while it opens. (A ResizeObserver reports every
 * box once when it starts watching, and acting on that report, or on the
 * growth, jumped straight to the end.) Reply with AI: plain Reply puts the
 * cursor in the text, which scrolls most of the way at once by itself.
 */
test("Reply with AI: opening slides to the reply rather than jumping", async ({ page }) => {
  await page.goto("/tests/browser/harness.html?mode=inline");
  await expect(page.getByTitle("Message content")).toBeVisible();
  await page.evaluate(() => {
    document.querySelector<HTMLElement>("#root > div")!.style.height = "360px";
  });
  await contentSettled(page);
  const seen = await page.evaluate(async () => {
    const reader = document.querySelector<HTMLElement>(".reader-scroll")!;
    const frame = () => new Promise((done) => requestAnimationFrame(done));
    const start = reader.scrollTop;
    const clicked = performance.now();
    [...document.querySelectorAll("button")]
      .find((b) => b.textContent?.trim() === "Reply with AI")!
      .click();
    // Every frame until the 0.7 s fallback, which would go the rest at once.
    const tops: number[] = [];
    while (performance.now() - clicked < 600) {
      await frame();
      tops.push(reader.scrollTop);
    }
    return { start, tops, end: reader.scrollHeight - reader.clientHeight };
  });
  // Before the fallback could have moved it, the reader passed through the
  // first half of the way: a slide. A jump lands near the end at once (and
  // chases the assistant's growth from there); standing still never moves.
  const halfway = seen.start + (seen.end - seen.start) / 2;
  expect(seen.tops.some((top) => top > seen.start + 2 && top < halfway)).toBe(true);
  await expect.poll(() => fromEnd(page), { timeout: 15_000 }).toBeLessThanOrEqual(2);
});

/**
 * The smooth scroll that opens a reply can be cut short or left undone (in
 * CI the reply was left hundreds of pixels below the reader: docs/ROADMAP.md
 * → Flaky tests). Here every smooth scroll of the reader is dropped, so the
 * opening one never happens, and nothing growing gets to put the reader at
 * its end (the page's ResizeObservers are turned off): only the 0.7 s
 * fallback is left, and the reply still ends up at the bottom.
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
  await page.evaluate(() => {
    const quiet = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = quiet;
  });
  await page.getByRole("button", { name: "Reply with AI", exact: true }).click();
  await expect(page.locator('section[aria-label="Reply"]')).toBeVisible();
  await page.waitForTimeout(300);
  expect(await fromEnd(page)).toBeGreaterThan(2);
  await expect.poll(() => fromEnd(page), { timeout: 15_000 }).toBeLessThanOrEqual(2);
});

/**
 * A key while the reply is still sliding into view (on the reader, which
 * has the keyboard once it's been clicked or entered) lets go there: the
 * slide stops, and nothing finishes it.
 */
test("Reply with AI: a key during the opening slide stops it there", async ({ page }) => {
  await page.goto("/tests/browser/harness.html?mode=inline");
  await expect(page.getByTitle("Message content")).toBeVisible();
  await page.evaluate(() => {
    document.querySelector<HTMLElement>("#root > div")!.style.height = "360px";
  });
  await contentSettled(page);
  const stopped = await page.evaluate(async () => {
    const reader = document.querySelector<HTMLElement>(".reader-scroll")!;
    const frame = () => new Promise((done) => requestAnimationFrame(done));
    [...document.querySelectorAll("button")]
      .find((b) => b.textContent?.trim() === "Reply with AI")!
      .click();
    await frame();
    await frame();
    reader.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    const at = reader.scrollTop;
    await new Promise((done) => setTimeout(done, 1200));
    return {
      moved: reader.scrollTop - at,
      left: reader.scrollHeight - reader.clientHeight - reader.scrollTop,
    };
  });
  expect(stopped.moved).toBe(0);
  expect(stopped.left).toBeGreaterThan(2);
});

/**
 * Let go, then content shrinking back so the reader is clamped to its end
 * (an email closed, the assistant closed), then growing: still let go
 * (found in review).
 */
test("Reply with AI: a released reply clamped to the end stays released", async ({ page }) => {
  await openReplyWithAi(page);
  const before = await page.evaluate(async () => {
    const reader = document.querySelector<HTMLElement>(".reader-scroll")!;
    const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
    reader
      .querySelector("section[data-message-id] > button")!
      .dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    // Something above grows, then goes away again.
    const extra = document.createElement("div");
    extra.style.height = "120px";
    reader.querySelector("section[data-message-id]")!.append(extra);
    await wait(300);
    extra.remove();
    await wait(300);
    return reader.scrollTop;
  });
  await growReply(page);
  expect(await page.evaluate(() => document.querySelector(".reader-scroll")!.scrollTop)).toBe(
    before,
  );
});

/**
 * Let go during the opening slide (a key on an email above), then back to
 * the end: opening is over, so growth from then on is instant, not another
 * slide (found in review: opening stayed on, and growth slid without the
 * fallback behind it).
 */
test("Reply with AI: after letting go of the slide, growth at the end is instant", async ({
  page,
}) => {
  await page.goto("/tests/browser/harness.html?mode=inline");
  await expect(page.getByTitle("Message content")).toBeVisible();
  await page.evaluate(() => {
    document.querySelector<HTMLElement>("#root > div")!.style.height = "360px";
  });
  await contentSettled(page);
  const behaviors = await page.evaluate(async () => {
    const reader = document.querySelector<HTMLElement>(".reader-scroll")!;
    const frame = () => new Promise((done) => requestAnimationFrame(done));
    const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
    [...document.querySelectorAll("button")]
      .find((b) => b.textContent?.trim() === "Reply with AI")!
      .click();
    await frame();
    await frame();
    reader.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    await wait(1000);
    // Back down to the end, by hand.
    window.dispatchEvent(new WheelEvent("wheel"));
    reader.scrollTop = reader.scrollHeight;
    await wait(200);
    const asked: string[] = [];
    const scrollTo = reader.scrollTo.bind(reader);
    reader.scrollTo = ((options: ScrollToOptions) => {
      asked.push(options.behavior ?? "auto");
      scrollTo(options);
    }) as typeof reader.scrollTo;
    const extra = document.createElement("div");
    extra.style.height = "120px";
    document.querySelector('section[aria-label="Reply"] form')!.append(extra);
    await wait(500);
    return asked;
  });
  expect(behaviors.length).toBeGreaterThan(0);
  expect(behaviors.every((b) => b === "instant")).toBe(true);
  expect(await fromEnd(page)).toBeLessThanOrEqual(2);
});

/**
 * Clicking one of the assistant's ideas (owner report, 2026-11-23): the
 * panel shrank for a moment as the ideas went, the browser pulled the
 * reader up to the shorter end, and that read as the person scrolling up,
 * so the reply let go and its answer grew out of sight. Only a scroll by
 * hand lets go now.
 */
test("Reply with AI: clicking one of its ideas keeps the reply stuck", async ({ page }) => {
  await page.goto("/tests/browser/harness.html?mode=inline");
  await expect(page.getByTitle("Message content")).toBeVisible();
  await page.evaluate(() => {
    document.querySelector<HTMLElement>("#root > div")!.style.height = "600px";
  });
  await contentSettled(page);
  await page.getByRole("button", { name: "Reply with AI", exact: true }).click();
  await expect(page.getByRole("button", { name: "Say yes" })).toBeVisible();
  await contentSettled(page, 'section[aria-label="Reply"]');
  await expect.poll(() => fromEnd(page), { timeout: 15_000 }).toBeLessThanOrEqual(2);
  await page.getByRole("button", { name: "Say yes" }).click();
  // The made-up answer arrives after a moment, under its Insert button.
  await expect(page.getByRole("button", { name: "Insert" })).toBeVisible();
  await contentSettled(page, 'section[aria-label="Reply"]');
  expect(await fromEnd(page)).toBeLessThanOrEqual(2);
});
