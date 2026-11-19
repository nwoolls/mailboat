import { expect, type Page, test } from "@playwright/test";

/**
 * While files are dragged over the window, the frames mail is shown in (an
 * email in the reader; a composer's signature and quoted message) let the
 * pointer through, so the drop reaches what's under them: the composer,
 * which attaches the file, or the page, which ignores it. A frame runs no
 * scripts, so a drop there reached nothing, and the web view opened the file
 * in place of the app (owner, 2026-11-19: a PDF dropped on a reply's
 * signature). The web view's own drag can't be made here, so these send
 * the drag events the page gets to where the web view would send them: the
 * element the pointer is over.
 */

/** Fires a file drag event at the element at `point`; whether it was taken. */
async function dragAt(page: Page, type: string, point: { x: number; y: number }) {
  return page.evaluate(
    ({ kind, x, y }) => {
      const w = window as unknown as { __drag?: DataTransfer };
      if (!w.__drag) {
        w.__drag = new DataTransfer();
        w.__drag.items.add(new File(["%PDF-1.4"], "Quote 1042.pdf", { type: "application/pdf" }));
      }
      const target = document.elementFromPoint(x, y);
      if (!target || target instanceof HTMLIFrameElement) return { target: "frame", taken: false };
      // A drag event made in a page carries no files in WebKit, so the
      // dragged data is set on it as the web view's own would carry it.
      const e = new Event(kind, { bubbles: true, cancelable: true });
      Object.defineProperty(e, "dataTransfer", { value: w.__drag });
      Object.defineProperty(e, "clientX", { value: x });
      Object.defineProperty(e, "clientY", { value: y });
      target.dispatchEvent(e);
      return { target: target.tagName, taken: e.defaultPrevented };
    },
    { kind: type, ...point },
  );
}

/** The shell with the demo's Inbox, a conversation open. */
async function openConversation(page: Page, extra = "") {
  await page.goto(`/tests/browser/harness.html?mode=shell&rows=1&synced=1${extra}`);
  await page.getByRole("option").first().click();
  await expect(page.locator('iframe[title="Message content"]').first()).toBeVisible();
}

async function pointOn(page: Page, selector: string) {
  const box = (await page.locator(selector).first().boundingBox())!;
  // Near the top: a long email runs past the bottom of the window.
  return { x: box.x + box.width / 2, y: box.y + Math.min(box.height / 2, 30) };
}

const pointerEvents = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((el) => getComputedStyle(el).pointerEvents);

test("a file dragged onto a reply's signature attaches to the reply", async ({ page }) => {
  await openConversation(page, "&signature=1");
  await page.getByRole("button", { name: "Reply", exact: true }).first().click();
  const reply = page.locator('section[aria-label="Reply"]');
  const frame = 'section[aria-label="Reply"] iframe[title="Signature"]';
  await expect(page.locator(frame)).toBeVisible();
  const at = await pointOn(page, frame);
  // The drag enters the window elsewhere first, then crosses the signature.
  await dragAt(page, "dragenter", { x: 5, y: 5 });
  expect(await pointerEvents(page, frame)).toBe("none");
  expect(await dragAt(page, "dragover", at)).toMatchObject({ taken: true });
  await expect(reply.getByText("Drop to attach")).toBeVisible();
  expect(await dragAt(page, "drop", at)).toMatchObject({ taken: true });
  await expect(reply.getByText("Quote 1042.pdf").first()).toBeVisible();
  // After the drag, the frame takes the pointer again (links, selecting).
  await expect.poll(() => pointerEvents(page, frame)).toBe("auto");
});

test("a file dragged onto an email in the reader does nothing", async ({ page }) => {
  await openConversation(page);
  const frame = 'iframe[title="Message content"]';
  const at = await pointOn(page, frame);
  await dragAt(page, "dragenter", { x: 5, y: 5 });
  const over = await dragAt(page, "dragover", at);
  expect(over.target).not.toBe("frame");
  expect(over.taken).toBe(true);
  expect(await dragAt(page, "drop", at)).toMatchObject({ taken: true });
  await expect(page.getByText("Quote 1042.pdf")).toHaveCount(0);
});

test("a drag that leaves the window gives the frames the pointer back", async ({ page }) => {
  await openConversation(page);
  const frame = 'iframe[title="Message content"]';
  await dragAt(page, "dragover", { x: 5, y: 5 });
  expect(await pointerEvents(page, frame)).toBe("none");
  // No drop: the drag went elsewhere.
  await expect.poll(() => pointerEvents(page, frame), { timeout: 2000 }).toBe("auto");
});
