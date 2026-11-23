import { expect, type Page, test } from "@playwright/test";
import { advance, driveTime, holdAtStart, holdTime } from "./time";

/**
 * The floating sidebar in Chromium, WebView2's engine. In WebKit, sliding
 * out from under a pointer that hasn't moved, it got a "pointer entered",
 * which counted as coming back onto it and kept it open after Esc
 * (`narrow-window.spec.ts`, which fails without the fix). Chromium sends no
 * such event, so these passed before the fix too (checked 2026-11-22): they
 * show the fix keeps Esc working and a real move back still keeping it.
 */
const listHidden = (page: Page) =>
  page
    .locator("section.panel")
    .first()
    .evaluate((el) => el.hasAttribute("inert") && el.getBoundingClientRect().width < 1);

/**
 * Takes the focus out of the reply's text without Esc (which would also
 * leave the conversation: reply-esc.spec.ts) and without moving the pointer.
 */
const leaveText = (page: Page) =>
  page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

async function open(page: Page) {
  await page.setViewportSize({ width: 480, height: 700 });
  await page.goto("/tests/browser/harness.html?mode=shell&rows=1");
  await page.evaluate(() => (document.documentElement.dataset.platform = "windows"));
  await expect(page.getByRole("option").first()).toBeVisible();
}

/** The sidebar's shortcut, as the page reads the platform: ⌃⌘S or Ctrl+Alt+S. */
async function sidebarShortcut(page: Page) {
  const mac = await page.evaluate(() => /Mac/.test(navigator.userAgent));
  return mac ? "Control+Meta+s" : "Control+Alt+s";
}

test("Esc puts a floating sidebar away under a pointer that hasn't moved", async ({ page }) => {
  await open(page);
  await page.getByRole("option").first().click();
  await expect.poll(() => listHidden(page)).toBe(true);
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  await leaveText(page);
  const peek = page.locator(".sidebar-peek");
  await page.keyboard.press(await sidebarShortcut(page));
  await expect(peek).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(peek).toHaveCount(0);
});

test("moving back onto a floating sidebar as it slides out keeps it", async ({ page }) => {
  // On the test's clock (./time.ts), with the slide out held where it
  // starts: on a busy runner the pointer's steps took longer than the
  // 120 ms slide out, and the sidebar had gone before the pointer got there.
  await driveTime(page);
  await holdAtStart(page, "peek-out");
  await open(page);
  await page.mouse.move(470, 60);
  const peek = page.locator(".sidebar-peek");
  await page.keyboard.press(await sidebarShortcut(page));
  await expect(peek).toBeVisible();
  await holdTime(page);
  await page.keyboard.press("Escape");
  await expect(peek).toHaveAttribute("data-leaving");
  // During its slide out: onto its left edge, the part covered longest.
  await page.mouse.move(20, 300, { steps: 2 });
  // Past the slide out (120 ms), short of the 280 ms a pointer that leaves
  // has. Kept, the sidebar slides in again from the edge, so the pointer is
  // out of it for a moment, and in real time the "entered" as it comes back
  // keeps it; the test's clock can pass 280 ms before that event arrives.
  await advance(page, 200);
  await expect(peek).toBeVisible();
  await expect(peek).not.toHaveAttribute("data-leaving");
});
