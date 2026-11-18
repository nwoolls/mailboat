import { expect, type Page, test } from "@playwright/test";

/**
 * Send again (docs/ROADMAP.md → 0.3.0 → "Clone a sent email"): a
 * conversation holding an email you sent offers "Send again…" in its
 * right-click menu, which opens that email as a new message with the
 * same people, subject, body and file, and a note about the file.
 */
const open = (page: Page, extra = "") =>
  page.goto(`/tests/browser/harness.html?mode=shell&rows=1&conversation=all${extra}`);

async function sendAgainFrom(page: Page, subject: string) {
  await page.getByRole("option").filter({ hasText: subject }).click({ button: "right" });
  return page.getByRole("menu", { name: "Conversation" });
}

test("an email you sent opens again as a new message, with its file", async ({ page }) => {
  await open(page);
  const menu = await sendAgainFrom(page, "Lisbon in May?");
  await menu.getByRole("menuitem", { name: "Send again…" }).click();

  const card = page.getByRole("dialog").or(page.locator("form")).last();
  await expect(page.getByRole("combobox", { name: "To" })).toBeVisible();
  // The same people (the email you sent went to Maya), Bcc from Gmail.
  await expect(page.locator("[data-address-line=to]")).toContainText("Maya Chen");
  await expect(page.locator("[data-address-line=bcc]")).toContainText("books@rivera.example");
  await expect(page.getByRole("textbox", { name: "Subject" })).toHaveValue(/Lisbon in May\?/);
  await expect(card).toContainText("Sent once already.");

  // The file came along, and a note says so; Remove it takes it off.
  const note = page.getByRole("note", { name: "Sending again" });
  await expect(note).toHaveText(/Includes the file from the original\./);
  await expect(page.getByText("Lisbon itinerary.pdf")).toBeVisible();
  await note.getByRole("button", { name: "Remove it" }).click();
  await expect(page.getByText("Lisbon itinerary.pdf")).toHaveCount(0);
  await expect(note).toHaveCount(0);
});

test("the note says when Bcc couldn't be read, and can be dismissed", async ({ page }) => {
  await open(page, "&bcc=unknown");
  const menu = await sendAgainFrom(page, "Lisbon in May?");
  await menu.getByRole("menuitem", { name: "Send again…" }).click();
  const note = page.getByRole("note", { name: "Sending again" });
  await expect(note).toContainText("The original’s Bcc couldn’t be read from Gmail.");
  await note.getByRole("button", { name: "Dismiss" }).click();
  await expect(note).toHaveCount(0);
  // Its button gone, the message has focus (review).
  await expect(page.locator(".ProseMirror")).toBeFocused();
  // The file stays: dismissing only hides the note.
  await expect(page.getByText("Lisbon itinerary.pdf")).toBeVisible();
});

test("a conversation with only received mail doesn't offer it", async ({ page }) => {
  await open(page);
  const rows = page.getByRole("option");
  await expect(rows.first()).toBeVisible();
  // One you never wrote in: no Send again.
  const received = rows.filter({ hasNotText: /Lisbon in May\?|Climbing Thursday\?/ }).first();
  await received.click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Conversation" });
  await expect(menu.getByRole("menuitem", { name: "Forward" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Send again…" })).toHaveCount(0);
});
