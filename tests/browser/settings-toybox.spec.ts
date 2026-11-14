import { expect, test } from "@playwright/test";

/** Settings → Toybox: each card's switch beside its choices, and pictures for the scenes. */
const open = "/tests/browser/harness.html?mode=toybox";

test("the toy's switch hides its choices, and brings back the toy it had", async ({ page }) => {
  await page.goto(open);
  await page.getByRole("radio", { name: "Sky" }).click();
  const toggle = page.getByRole("switch", { name: "Something to play with" });
  await toggle.click();
  await expect(page.getByRole("radio", { name: "Sky" })).toHaveCount(0);
  // Nothing to choose called "None": the switch is the off.
  await expect(page.getByRole("radio", { name: "None" })).toHaveCount(0);
  await toggle.click();
  await expect(page.getByRole("radio", { name: "Sky" })).toHaveAttribute("aria-checked", "true");
});

test("the screensaver's switch sits on its own card and hides its choices", async ({ page }) => {
  await page.goto(open);
  await expect(page.getByRole("radio", { name: "Flock" })).toBeVisible();
  await page.getByRole("switch", { name: "Screensaver" }).click();
  await expect(page.getByRole("radio", { name: "Flock" })).toHaveCount(0);
  await expect(page.getByRole("radiogroup", { name: "Colors" })).toHaveCount(0);
});

test("the style and every screensaver show a picture of themselves", async ({ page }) => {
  await page.goto(open);
  await expect(page.getByRole("radiogroup", { name: "Style" }).locator("canvas")).toHaveCount(2);
  // Eleven scenes, each its own canvas; Random is a drawing of its own.
  await expect(page.getByRole("radiogroup", { name: "Screensaver" }).locator("canvas")).toHaveCount(
    11,
  );
});

/** The pixels of the canvas in a screensaver's tile, to compare. */
const tilePixels = (page: import("@playwright/test").Page, name: string) =>
  page
    .getByRole("radio", { name })
    .locator("canvas")
    .evaluate((c: HTMLCanvasElement) => c.toDataURL());

test("a still picture is never seen moving: it shows only once it has its frame", async ({
  page,
}) => {
  await page.goto(open);
  const style = page.getByRole("radiogroup", { name: "Style" }).locator("canvas").first();
  await expect(style).toHaveCSS("visibility", "hidden");
  await expect(style).toHaveCSS("visibility", "visible", { timeout: 5000 });
});

test("choosing another screensaver stops the last one where it is, without starting over", async ({
  page,
}) => {
  await page.goto(open);
  await page.getByRole("radio", { name: "Koi pond" }).click();
  await page.waitForTimeout(2500);
  await page.getByRole("radio", { name: "Flock" }).click();
  await page.waitForTimeout(150);
  const koi = page.getByRole("radio", { name: "Koi pond" }).locator("canvas");
  // Shown at once (not hidden to play out again), and holding still.
  await expect(koi).toHaveCSS("visibility", "visible");
  const before = await tilePixels(page, "Koi pond");
  await page.waitForTimeout(700);
  expect(await tilePixels(page, "Koi pond")).toBe(before);
});

test("changing the colors recolors every picture, the still ones too", async ({ page }) => {
  await page.goto(open);
  await page.waitForTimeout(3000);
  // A still picture (not the chosen scene), once it has stopped.
  const before = await tilePixels(page, "Koi pond");
  await page.getByRole("radio", { name: "Forest" }).click();
  await page.waitForTimeout(200);
  expect(await tilePixels(page, "Koi pond")).not.toBe(before);
});
