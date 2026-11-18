import { expect, type Page, test } from "@playwright/test";

/**
 * Recipients outside a Workspace account's organization are marked while
 * writing, with a banner, as Gmail marks them (docs/ROADMAP.md → 0.3.0 →
 * "Warn about outside recipients"). The harness's account is at
 * rivera.example, with sam@okafor.example in its contacts.
 */
async function add(page: Page, address: string, line = "To") {
  const field = page.getByRole("combobox", { name: line });
  await field.click();
  await field.pressSequentially(`${address},`);
}

const chip = (page: Page, email: string, line = "to") =>
  page.locator(`[data-address-line=${line}] span[title]`, { hasText: email });

test("an outside address is marked, with a banner, until it's removed", async ({ page }) => {
  await page.goto("/tests/browser/harness.html?mode=card&outside=work");
  // First an outside address, so the rule has arrived before anything is
  // checked for not being marked (review).
  await add(page, "jordan@x.example");
  await expect(chip(page, "jordan@x.example")).toHaveAttribute("data-outside", "true");
  await expect(chip(page, "jordan@x.example")).toHaveAttribute(
    "title",
    "jordan@x.example, outside your organization",
  );
  await expect(
    page.getByRole("button", { name: "jordan@x.example, outside your organization" }),
  ).toBeVisible();
  const banner = page.getByRole("status").filter({ hasText: "outside your organization" });
  await expect(banner).toContainText("jordan@x.example is outside your organization");
  await expect(banner).toContainText("isn’t at rivera.example");

  // Inside: the account's domain, and a contact.
  await add(page, "ana@rivera.example");
  await add(page, "sam@okafor.example");
  await expect(chip(page, "ana@rivera.example")).not.toHaveAttribute("data-outside");
  await expect(chip(page, "sam@okafor.example")).not.toHaveAttribute("data-outside");
  await expect(banner).toContainText("jordan@x.example is outside your organization");

  // Cc counts too.
  await page.getByRole("button", { name: "Cc", exact: true }).click();
  await add(page, "lee@y.example", "Cc");
  await expect(chip(page, "lee@y.example", "cc")).toHaveAttribute("data-outside", "true");
  await expect(banner).toContainText("2 people are outside your organization");

  await page.getByRole("button", { name: "Remove jordan@x.example" }).click();
  await page.getByRole("button", { name: "Remove lee@y.example" }).click();
  await expect(banner).toHaveCount(0);
});

test("a personal account marks nobody", async ({ page }) => {
  await page.goto("/tests/browser/harness.html?mode=card");
  await add(page, "jordan@x.example");
  // The rule has been asked for and answered (review): nothing is marked
  // because it's a personal account, not because it hasn't arrived.
  await expect
    .poll(() =>
      page.evaluate(() => (window as { __outsideRuleAsked?: boolean }).__outsideRuleAsked),
    )
    .toBe(true);
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => done(null))));
  await expect(chip(page, "jordan@x.example")).toBeVisible();
  await expect(chip(page, "jordan@x.example")).not.toHaveAttribute("data-outside");
  await expect(page.getByText("outside your organization")).toHaveCount(0);
});

test("Settings → Accounts turns the warning off and on for the account", async ({ page }) => {
  await page.goto("/tests/browser/harness.html?mode=card&outside=work&settings=accounts");
  await add(page, "jordan@x.example");
  await expect(chip(page, "jordan@x.example")).toHaveAttribute("data-outside", "true");
  const toggle = page.getByRole("switch", { name: "Warn about outside recipients" });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(chip(page, "jordan@x.example")).not.toHaveAttribute("data-outside");
  await expect(page.getByText("is outside your organization")).toHaveCount(0);
  await toggle.click();
  await expect(chip(page, "jordan@x.example")).toHaveAttribute("data-outside", "true");
});
