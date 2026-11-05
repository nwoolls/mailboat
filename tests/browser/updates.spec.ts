import { expect, test } from "@playwright/test";

/**
 * Updating the app (Milestone 15): Settings → About says where it stands, a
 * check finds a version, and a notice at the top right offers it. "Later" puts
 * the notice off but not the About row; installing shows its progress; a
 * failure says why and keeps the update on offer.
 */
const open = (query: string) => `/tests/browser/harness.html?mode=updates&${query}`;

test("a check finds an update, the notice offers it, and Later puts the notice off", async ({
  page,
}) => {
  await page.goto(open("update=found"));
  const row = page.getByText("Not checked yet in this session.");
  await expect(row).toBeVisible();
  await expect(page.getByText("Version 0.1.0")).toBeVisible();
  await expect(page.getByRole("status", { name: "Update available" })).toHaveCount(0);

  await page.getByRole("button", { name: "Check for updates" }).click();

  // About says so, and its button becomes the install button.
  await expect(page.getByText("Version 0.2.0 is available.")).toBeVisible();
  const notice = page.getByRole("status", { name: "Update available" });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("0.2.0");

  // Later hides the notice, not the About row.
  await notice.getByRole("button", { name: "Later" }).click();
  await expect(notice).toBeHidden();
  await expect(page.getByText("Version 0.2.0 is available.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Install and restart" })).toBeVisible();
});

test("installing shows its progress in the notice", async ({ page }) => {
  await page.goto(open("update=found"));
  await page.getByRole("button", { name: "Check for updates" }).click();
  await expect(page.getByRole("status", { name: "Update available" })).toBeVisible();
  await page.getByRole("button", { name: "Install and restart" }).first().click();

  // Even after Later, an install in progress stays on screen.
  const notice = page.getByRole("status", { name: "Update available" });
  await expect(notice.getByRole("progressbar")).toBeVisible();
  await expect(notice).toContainText("The app restarts when it’s done.");
  await expect(notice.getByRole("button", { name: "Install and restart" })).toHaveCount(0);
  // Nothing else can start meanwhile.
  await expect(page.getByRole("button", { name: "Check for updates" })).toBeDisabled();
});

test("a failed install says why and keeps the update on offer", async ({ page }) => {
  await page.goto(open("update=found&install=fail"));
  await page.getByRole("button", { name: "Check for updates" }).click();
  await page.getByRole("button", { name: "Install and restart" }).first().click();

  const notice = page.getByRole("status", { name: "Update available" });
  await expect(notice).toContainText("The update failed.");
  await expect(notice.getByRole("button", { name: "Install and restart" })).toBeVisible();
  await expect(
    page.getByText("Version 0.2.0 is available, but it couldn’t be installed: The update failed."),
  ).toBeVisible();
});

test("no update, and a check that fails, say so in About without a notice", async ({ page }) => {
  await page.goto(open("update=none"));
  await page.getByRole("button", { name: "Check for updates" }).click();
  await expect(page.getByText("You have the latest version.")).toBeVisible();
  await expect(page.getByRole("status", { name: "Update available" })).toHaveCount(0);

  await page.goto(open("update=error"));
  await page.getByRole("button", { name: "Check for updates" }).click();
  await expect(page.getByText(/Couldn’t reach the update server/)).toBeVisible();
  await expect(page.getByRole("status", { name: "Update available" })).toHaveCount(0);
});

type Order = { __order?: string[] };
const order = (page: import("@playwright/test").Page) =>
  page.evaluate(() => (window as unknown as Order).__order ?? []);

test("installing first saves the message being written", async ({ page }) => {
  await page.goto(open("update=found&draft=1"));
  await page.getByRole("button", { name: "Check for updates" }).click();
  await page.getByRole("button", { name: "Install and restart" }).first().click();

  // The draft was saved (without waiting for its 2.5 seconds) before the install began.
  await expect.poll(async () => (await order(page)).includes("update_install")).toBe(true);
  const calls = await order(page);
  expect(calls.indexOf("draft_save")).toBeGreaterThanOrEqual(0);
  expect(calls.indexOf("draft_save")).toBeLessThan(calls.indexOf("update_install"));
});

test("a message that can't be saved stops the install and says why", async ({ page }) => {
  await page.goto(open("update=found&draft=1&draftsave=fail"));
  await page.getByRole("button", { name: "Check for updates" }).click();
  await page.getByRole("button", { name: "Install and restart" }).first().click();

  const notice = page.getByRole("status", { name: "Update available" });
  await expect(notice).toContainText("Couldn’t save a message you’re writing");
  await expect(notice.getByRole("button", { name: "Install and restart" })).toBeVisible();
  // Nothing was installed.
  expect(await order(page)).not.toContain("update_install");
});
