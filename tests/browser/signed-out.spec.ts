import { expect, test } from "@playwright/test";

/**
 * When Google signs an account out (Milestone 15): the sidebar has no red
 * text, the avatar's menu says why and offers Sign in again, and a notice
 * at the top right does the same, until dismissed.
 */
test("a signed-out account gets a notice and a menu, not red text in the sidebar", async ({
  page,
}) => {
  await page.goto("/tests/browser/harness.html?mode=signedout");
  const notice = page.getByRole("status", { name: "Signed out" });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("Google signed you out");
  await expect(notice.getByRole("button", { name: "Sign in again" })).toBeVisible();

  // The sidebar's line is gone; the avatar's own title still says it.
  await expect(page.locator("nav").getByText("Google signed you out")).toHaveCount(0);
  const avatarButton = page.getByRole("button", { name: /menu$/ });
  await expect(avatarButton.locator("[title*='signed you out']")).toHaveCount(1);
  // The red dot on the avatar stays.
  await expect(avatarButton.locator(".bg-danger")).toHaveCount(1);

  // No reason is given: Google's error doesn't say why.
  await expect(notice).not.toContainText("seven days");

  // The avatar's menu: the state, and Sign in again.
  await avatarButton.click();
  const menu = page.getByRole("menu");
  await expect(menu).toContainText("Google signed you out");
  await expect(menu).not.toContainText("seven days");
  await expect(menu.getByRole("menuitem", { name: "Sign in again" })).toBeVisible();
  await page.keyboard.press("Escape");

  // Dismissing hides the notice; the menu still offers the way back in.
  await notice.getByRole("button", { name: /^Dismiss/ }).click();
  await expect(notice).toBeHidden();
  // The sidebar ignores a click that reopens a menu closed a moment ago
  // (300 ms, `lastClose` in Sidebar.tsx): wait just over it.
  const reopenGuardMs = 300;
  await page.waitForTimeout(reopenGuardMs + 100);
  await avatarButton.click();
  await expect(page.getByRole("menuitem", { name: "Sign in again" })).toBeVisible();
});
