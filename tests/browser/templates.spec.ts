import { expect, type Page, test } from "@playwright/test";

/**
 * Templates (docs/ROADMAP.md → 0.4.0 → Templates), with demo mode's
 * made-up ones: picked from the composer with the keyboard, filled in,
 * and put in at the cursor as one undo step.
 */
const card = (page: Page) => page.locator("section.compose-card");
const message = (page: Page) => card(page).getByRole("textbox", { name: "Message" });

async function newMessageWith(page: Page, text: string) {
  await page.goto("/tests/browser/harness.html?mode=card");
  await message(page).click();
  await page.keyboard.type(text);
}

test("a template goes in at the cursor, as one undo step", async ({ page }) => {
  await newMessageWith(page, "Before after");
  // The cursor between the two words.
  for (let i = 0; i < "after".length; i++) await page.keyboard.press("ArrowLeft");

  await page.keyboard.press("ControlOrMeta+Shift+T");
  const picker = page
    .getByRole("combobox", { name: "Find a template…" })
    .or(page.getByPlaceholder("Find a template…"));
  await expect(picker).toBeFocused();
  await page.keyboard.type("thanks");
  await page.keyboard.press("Enter");

  // Fill in: the recipient's name is left for the message (no one in To
  // yet), the date starts on next Friday.
  const fill = page.getByRole("dialog", { name: "Thanks, will review" });
  await expect(fill).toBeVisible();
  await expect(fill.getByLabel("By")).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(fill).toHaveCount(0);

  // The template's first paragraph joins the text before the cursor, its
  // last joins the text after; the date is written long.
  const editor = message(page);
  await expect(editor).toBeFocused();
  await expect(editor.locator("p").first()).toHaveText(/^Before Hi Recipient's first name,$/);
  await expect(editor.locator("p").last()).toHaveText(
    /^Thanks for sending this over\. .* by Friday, [A-Z][a-z]+ \d{1,2}, \d{4}\.after$/,
  );
  // The unfilled name stays a field, highlighted.
  await expect(editor.locator("span[data-field]")).toHaveText("Recipient's first name");
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __order?: string[] }).__order ?? []))
    .toContain("template_used 3");

  // One undo takes the whole template out again.
  await page.keyboard.press("ControlOrMeta+Z");
  await expect(editor).toHaveText("Before after");
});

test("the picker works from the keyboard, and Esc goes back to the text", async ({ page }) => {
  await newMessageWith(page, "Hello");
  await page.keyboard.press("ControlOrMeta+Shift+T");
  const list = page.getByRole("listbox");
  await expect(list).toBeVisible();
  const selected = list.locator("[aria-selected=true]");
  const first = await selected.innerText();
  await page.keyboard.press("ArrowDown");
  await expect(selected).not.toHaveText(first);
  // ↑ from the first wraps to the last, the picker's "More" actions.
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(selected).toHaveText(/Save as template…|Manage templates…/);

  await page.keyboard.press("Escape");
  await expect(list).toHaveCount(0);
  // Esc closed only the picker: the message is still open, and typing goes on.
  await expect(message(page)).toBeFocused();
  await page.keyboard.type(" there");
  await expect(message(page)).toHaveText("Hello there");

  // The button opens it too, and a click elsewhere closes it.
  await card(page).getByRole("button", { name: "Templates" }).click();
  await expect(list).toBeVisible();
  await card(page).getByRole("textbox", { name: "Subject" }).click();
  await expect(list).toHaveCount(0);
  await expect(card(page).getByRole("textbox", { name: "Subject" })).toBeFocused();
});

test("a long text becomes bullets, and the template fills the new message's people and subject", async ({
  page,
}) => {
  await page.goto("/tests/browser/harness.html?mode=card");
  await message(page).click();
  await card(page).getByRole("button", { name: "Templates" }).click();
  await page.keyboard.type("change control");
  await page.keyboard.press("Enter");

  const fill = page.getByRole("dialog", { name: "Change control" });
  await fill.getByLabel("Window", { exact: true }).fill("2027-01-11");
  await fill.getByLabel("Window: time").fill("21:00");
  await fill.getByLabel("Window: end time").fill("23:00");
  await fill.getByLabel("Changes").fill("Upgrade the build servers\nMove the staging database");
  await expect(fill).toContainText("Change control: January 2027");
  await fill.getByRole("button", { name: "Insert" }).click();

  const editor = message(page);
  await expect(editor.locator("li")).toHaveText([
    "Upgrade the build servers",
    "Move the staging database",
  ]);
  await expect(editor.locator("strong").nth(1)).toHaveText(
    "Monday, January 11, 2027 from 9:00 PM to 11:00 PM",
  );
  await expect(card(page).getByRole("textbox", { name: "Subject" })).toHaveValue(
    "Change control: January 2027",
  );
  await expect(card(page).locator("[data-address-line=to]")).toContainText("Change board");
  await expect(card(page).locator("[data-address-line=cc]")).toContainText("Priya Raman");

  // Rollback was left empty: Send asks first, and Go to it selects it.
  await card(page).getByRole("button", { name: "Send" }).click();
  const alert = card(page).getByRole("alert").filter({ hasText: "hasn’t been filled in" });
  await expect(alert).toContainText("“Rollback” hasn’t been filled in.");
  await alert.getByRole("button", { name: "Go to it" }).click();
  await expect(alert).toHaveCount(0);
  await expect(editor.locator("span[data-field].ProseMirror-selectednode")).toHaveText("Rollback");
  await page.keyboard.type("Restore the previous image");
  await expect(editor).toContainText("Rollback: Restore the previous image");
  await expect(editor.locator("span[data-field]")).toHaveCount(0);
});

test("⌘K starts a new message from a template", async ({ page }) => {
  await page.goto("/tests/browser/harness.html?mode=shell&rows=1");
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("ControlOrMeta+K");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  await page.keyboard.type("change control");
  await expect(palette.getByRole("option", { selected: true })).toContainText("Change control");
  await page.keyboard.press("Enter");

  // A new message with the template's people, and Fill in for its fields.
  const fill = page.getByRole("dialog", { name: "Change control" });
  await expect(fill).toBeVisible();
  await expect(fill).toContainText("To Change board, Priya Raman");
  await fill.getByLabel("Rollback").fill("Restore the previous image");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(fill).toHaveCount(0);
  await expect(card(page).locator("[data-address-line=to]")).toContainText("Change board");
  await expect(card(page).getByRole("textbox", { name: "Subject" })).toHaveValue(
    /^Change control: [A-Z][a-z]+ \d{4}$/,
  );
  await expect(message(page)).toContainText("Rollback: Restore the previous image");
  await expect(message(page)).toBeFocused();
});
