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
// TEMPORARY (diagnosis): repeated, so one CI run gives several samples.
for (let run = 1; run <= 10; run++)
  test(`Reply with AI, 360px reader, slow machine: the reply still scrolls into view (run ${run})`, async ({
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
    await recordFollow(page);
    await page.getByRole("button", { name: "Reply with AI", exact: true }).click();
    await expect(page.locator('section[aria-label="Reply"]')).toBeVisible();
    // Past the slowed animations and the old second-and-a-half window.
    await page.waitForTimeout(4000);
    const deadline = Date.now() + 5_000;
    let bottom = (await replyInView(page)).bottom;
    while (bottom < -1 && Date.now() < deadline) {
      await page.waitForTimeout(100);
      bottom = (await replyInView(page)).bottom;
    }
    if (bottom < -1)
      throw new Error(
        `the reply's end is ${-bottom}px below the reader. What happened, in ms since the click:\n` +
          (await page.evaluate(() => {
            const trace: { t: number; scroll: number; end: number; size?: string }[] = (
              window as any
            ).followTrace;
            const scrolls = trace.filter((e) => !e.size && !("asked" in e));
            const ups = scrolls.filter((e, i) => i > 0 && e.scroll < (scrolls[i - 1]?.scroll ?? 0));
            return JSON.stringify(
              {
                lastScroll: scrolls.at(-1),
                lastSize: trace.filter((e) => e.size).at(-1),
                asks: trace.filter((e) => "asked" in e).slice(-15),
                head: trace.slice(0, 15),
                upward: ups.slice(0, 20),
                tail: trace.slice(-40),
              },
              null,
              1,
            );
          })),
      );
  });

/**
 * TEMPORARY (diagnosis): records, from the click on, every scroll of the
 * reader (where it is and how far it can go) and every size change of the
 * reply and the reader's content, so a failure in CI shows why the reply
 * wasn't followed.
 */
async function recordFollow(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    w.followTrace = [];
    let t0 = 0;
    const scroller = document.querySelector<HTMLElement>(".reader-scroll")!;
    const t = () => Math.round(performance.now() - t0);
    // Only what changed: a size observer reports every frame of an animation.
    const last = new Map<string, string>();
    const push = (key: string, entry: Record<string, unknown>) => {
      const { t: _, ...rest } = entry;
      const seen = JSON.stringify(rest);
      if (last.get(key) === seen) return;
      last.set(key, seen);
      w.followTrace.push(entry);
    };
    document.addEventListener("pointerdown", () => (t0 = performance.now()), {
      capture: true,
      once: true,
    });
    scroller.addEventListener("scroll", () =>
      push("scroll", {
        t: t(),
        scroll: Math.round(scroller.scrollTop),
        end: scroller.scrollHeight - scroller.clientHeight,
      }),
    );
    const sizes = new ResizeObserver((entries) => {
      for (const e of entries)
        push(e.target === scroller.firstElementChild ? "content" : "reply", {
          t: t(),
          size: e.target === scroller.firstElementChild ? "content" : "reply",
          h: Math.round(e.contentRect.height),
          scroll: Math.round(scroller.scrollTop),
          end: scroller.scrollHeight - scroller.clientHeight,
        });
    });
    sizes.observe(scroller.firstElementChild!);
    // Every scroll the app asks of the reader, with where it was asked to go.
    const scrollTo = scroller.scrollTo.bind(scroller);
    scroller.scrollTo = ((options: ScrollToOptions) => {
      w.followTrace.push({
        t: t(),
        asked: Math.round(options.top ?? -1),
        how: options.behavior,
        scroll: Math.round(scroller.scrollTop),
        end: scroller.scrollHeight - scroller.clientHeight,
      });
      scrollTo(options);
    }) as typeof scroller.scrollTo;
    new MutationObserver(() => {
      const reply = document.querySelector('section[aria-label="Reply"]');
      if (reply && !(reply as any).watched) {
        (reply as any).watched = true;
        sizes.observe(reply);
      }
    }).observe(scroller, { childList: true, subtree: true });
  });
}

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
