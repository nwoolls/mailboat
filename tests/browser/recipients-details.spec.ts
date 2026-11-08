import { expect, test } from "@playwright/test";

/**
 * An email's full recipient list (owner report, 2026-11-01): the reader's
 * addressing line is one line, cut off with an ellipsis, and the only way to
 * read everyone was to widen the window. Details shows From, To and Cc in
 * full, as text that can be selected.
 */
test("Details shows everyone an email went to, in full", async ({ page }) => {
  await page.goto("/tests/browser/harness.html?recipients=many");
  const card = page.locator("section[data-message-id]").first();
  const line = card.locator(".truncate").filter({ hasText: "→" });
  await expect(line).toBeVisible();
  // The line itself can't hold the nine and the four.
  expect(await line.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  const last = "Person 9 <to9@x.example>";
  // Closed: folded away (clipped to nothing), so not on screen.
  const list = card.locator("dl");
  await expect(list).not.toBeInViewport();

  const details = card.getByRole("button", { name: "Details" });
  await expect(details).toHaveAttribute("aria-expanded", "false");
  await details.click();
  await expect(details).toHaveAttribute("aria-expanded", "true");
  await expect(list).toBeInViewport();
  await expect(card.getByText("To Person 1 <to1@x.example>", { exact: false })).toBeVisible();
  await expect(card.getByText(last, { exact: false })).toBeVisible();
  await expect(card.getByText("Cc Person 4 <cc4@x.example>", { exact: false })).toBeVisible();
  await expect(card.getByText("From")).toBeVisible();

  // Closing it again.
  await details.click();
  await expect(details).toHaveAttribute("aria-expanded", "false");
  await expect(list).not.toBeInViewport();
});

/**
 * Moving the addressing line out of the card's header button must leave the
 * spacing as it was: the line right under the name, and the same gap before
 * the email's body as the header's own bottom padding gave (12px).
 */
test("the addressing line sits under the name and the body keeps its gap", async ({ page }) => {
  await page.goto("/tests/browser/harness.html?recipients=many");
  const card = page.locator("section[data-message-id]").first();
  const name = card.locator("button[aria-expanded] .h-7").first();
  const line = card.locator(".truncate").filter({ hasText: "→" });
  const body = card.locator("iframe").first();
  await expect(body).toBeVisible();
  const [n, l, b] = await Promise.all([name.boundingBox(), line.boundingBox(), body.boundingBox()]);
  expect(Math.abs(l!.y - (n!.y + n!.height))).toBeLessThanOrEqual(1);
  const gap = b!.y - (l!.y + l!.height);
  expect(gap).toBeGreaterThanOrEqual(10);
  expect(gap).toBeLessThanOrEqual(14);
});
