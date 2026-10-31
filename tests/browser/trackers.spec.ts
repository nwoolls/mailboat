import { expect, type Page, test } from "@playwright/test";

/**
 * Trackers hidden in CSS (R1-04, code review 2026-10-30): images in
 * `style` attributes, `<style>` sheets and `background` attributes skipped
 * the tracker check, so opening an email requested them. The email here
 * is the Rust sanitizer's real output (`fixtures/trackers.json`, written
 * by `crates/core/tests/browser_fixtures.rs`), shown in the real reader,
 * with every request the page and its frames make recorded. Nothing
 * leaves the machine: requests to other hosts are answered here.
 */
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

async function openEmail(page: Page, images: "0" | "1") {
  const remote: string[] = [];
  await page.context().route(
    (url) => url.hostname !== "127.0.0.1",
    (route) => {
      remote.push(route.request().url());
      return route.fulfill({ contentType: "image/png", body: PIXEL });
    },
  );
  await page.goto(`/tests/browser/harness.html?mode=trackers&images=${images}`);
  const frame = page.frameLocator('iframe[title="Message content"]');
  await expect(frame.getByText("background attribute tracker")).toBeVisible();
  // Give images and CSS backgrounds time to be asked for.
  await page.waitForLoadState("networkidle");
  return remote;
}

test("an email's trackers make no request, while its images load", async ({ page }) => {
  const remote = await openEmail(page, "1");
  // The control: the frame's requests are seen, so none below means none made.
  expect(remote.sort()).toEqual([
    "https://cdn.vendor.example/hero.png",
    "https://cdn.vendor.example/inline.png",
    "https://cdn.vendor.example/logo.png",
  ]);
});

test("with images held back, opening an email makes no request at all", async ({ page }) => {
  expect(await openEmail(page, "0")).toEqual([]);
});
