import { expect, type Page, test } from "@playwright/test";

/**
 * Removing the last account (Polish Spike): the window stays in Settings →
 * Accounts, with an empty list and "Add account", instead of starting
 * onboarding again. Closing Settings shows an empty mail pane that points
 * back to it. Both for someone who finished onboarding and for someone who
 * had accounts before onboarding existed (no saved progress).
 */
const open = (page: Page, query = "") =>
  page.goto(`/tests/browser/harness.html?mode=shell${query}`);

/** What onboarding saved when its flow was finished. */
const finishedOnboarding = JSON.stringify({ stage: "yours", finished: true });

async function removeTheAccountInSettings(page: Page) {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await open(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Accounts" }).click();
  await page.getByRole("button", { name: /^Remove/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove", exact: true }).click();
  return problems;
}

for (const [who, saved] of [
  ["someone who finished onboarding", finishedOnboarding],
  ["someone who had accounts before onboarding existed", null],
] as const) {
  test(`removing the last account stays in Settings → Accounts for ${who}`, async ({ page }) => {
    await page.addInitScript((progress) => {
      if (progress) localStorage.setItem("onboarding", progress);
    }, saved);
    const problems = await removeTheAccountInSettings(page);

    // Still in Settings → Accounts, with nothing listed and "Add account".
    await expect(page.getByRole("button", { name: "Add account" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Remove/ })).toHaveCount(0);
    // Not onboarding.
    await expect(page.getByText("All your Gmail accounts, in one calm inbox.")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Make it yours" })).toHaveCount(0);
    expect(problems).toEqual([]);
  });
}

test("someone seen with accounts and no saved progress is recorded as past onboarding", async ({
  page,
}) => {
  await open(page);
  await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();
  // Saved as soon as they are seen, not when the last account goes: a
  // window opened later with none left (however they went) stays in the app.
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem("onboarding") ?? "{}").finished),
    )
    .toBe(true);
  await page.goto("/tests/browser/harness.html?mode=shell&accounts=0");
  await expect(page.getByText("No accounts yet")).toBeVisible();
  await expect(page.getByText("All your Gmail accounts, in one calm inbox.")).toHaveCount(0);
});

test("with no account, writing and syncing are off", async ({ page }) => {
  await page.addInitScript(
    (progress) => localStorage.setItem("onboarding", progress),
    finishedOnboarding,
  );
  await open(page, "&accounts=0");
  await expect(page.getByRole("button", { name: "New message" })).toBeDisabled();
});

test("with no accounts left, the mail pane says where to add one", async ({ page }) => {
  await page.addInitScript(
    (progress) => localStorage.setItem("onboarding", progress),
    finishedOnboarding,
  );
  await open(page, "&accounts=0");
  await expect(page.getByText("No accounts yet")).toBeVisible();
  await expect(page.getByText("Add one in Settings → Accounts.")).toBeVisible();
  await expect(page.getByText("All your Gmail accounts, in one calm inbox.")).toHaveCount(0);
});

test("a first launch, with no accounts and nothing saved, still starts onboarding", async ({
  page,
}) => {
  await open(page, "&accounts=0");
  await expect(page.getByText("All your Gmail accounts, in one calm inbox.")).toBeVisible();
});
