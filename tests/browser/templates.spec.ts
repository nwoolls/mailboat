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
  await fill.getByRole("button", { name: "Insert" }).click();

  const editor = message(page);
  await expect(editor.locator("li")).toHaveText([
    "Upgrade the build servers",
    "Move the staging database",
  ]);
  await expect(editor.locator("strong").nth(1)).toHaveText(
    "Monday, January 11, 2027 from 9:00 PM to 11:00 PM",
  );
  await expect(card(page).getByRole("textbox", { name: "Subject" })).toHaveText(
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
  await expect(fill).toContainText("To Change board · Cc Priya Raman");
  await fill.getByLabel("Rollback").fill("Restore the previous image");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(fill).toHaveCount(0);
  await expect(card(page).locator("[data-address-line=to]")).toContainText("Change board");
  await expect(card(page).getByRole("textbox", { name: "Subject" })).toHaveText(
    /^Change control: [A-Z][a-z]+ \d{4}$/,
  );
  await expect(message(page)).toContainText("Rollback: Restore the previous image");
  await expect(message(page)).toBeFocused();
});

const sent = (page: Page) =>
  page.evaluate(() =>
    ((window as unknown as { __order?: string[] }).__order ?? []).includes("message_send"),
  );

/** A new message that could be sent: someone in To, and some text. */
async function sendable(page: Page, extra = "") {
  await page.goto(`/tests/browser/harness.html?mode=card${extra}`);
  await card(page).getByRole("combobox", { name: "To" }).click();
  await page.keyboard.type("maya@x.example,");
  await expect(card(page).locator("[data-address-line=to]")).toContainText("maya@x.example");
  await message(page).click();
  await page.keyboard.type("Hello");
}

/** No send, and no warning about fields that could have stopped one. */
async function nothingSent(page: Page) {
  await page.waitForTimeout(300);
  expect(await sent(page)).toBe(false);
  await expect(card(page).getByRole("alert")).toHaveCount(0);
  await expect(message(page)).toBeVisible();
}

test("Insert in Fill in never sends the message", async ({ page }) => {
  await sendable(page);
  await card(page).getByRole("button", { name: "Templates" }).click();
  await page.keyboard.type("thanks");
  await page.keyboard.press("Enter");
  const fill = page.getByRole("dialog", { name: "Thanks, will review" });
  // Every field filled, so a field left waiting can't be what stops a send.
  await fill.getByLabel("Recipient's first name").fill("Maya");
  await fill.getByRole("button", { name: "Insert" }).click();
  await expect(message(page)).toContainText("Hi Maya,");
  await expect(message(page).locator("span[data-field]")).toHaveCount(0);
  await nothingSent(page);
});

test("Save in Save as template never sends the message", async ({ page }) => {
  await sendable(page);
  await card(page).getByRole("button", { name: "Templates" }).click();
  await page.getByRole("option", { name: "Save as template…" }).click();
  const save = page.getByRole("dialog", { name: "Save as template" });
  await save.getByLabel("Name").fill("Hello");
  await save.getByRole("button", { name: "Save", exact: true }).click();
  await expect(save).toHaveCount(0);
  await nothingSent(page);
  // The saved template is in the list now.
  await card(page).getByRole("button", { name: "Templates" }).click();
  await expect(page.getByRole("option", { name: /^Hello/ })).toBeVisible();
});

test("Send anyway is for the message it was shown for", async ({ page }) => {
  await sendable(page);
  const insertThanks = async () => {
    await card(page).getByRole("button", { name: "Templates" }).click();
    await page.keyboard.type("thanks");
    await page.keyboard.press("Enter");
    await page
      .getByRole("dialog", { name: "Thanks, will review" })
      .getByRole("button", { name: "Insert" })
      .click();
  };
  // The address has no name, so "Recipient's first name" is left waiting.
  await insertThanks();
  await card(page).getByRole("button", { name: "Send" }).click();
  const alert = card(page).getByRole("alert").filter({ hasText: "hasn’t been filled in" });
  await expect(alert).toBeVisible();
  // Another template with a field of the same name, then Send anyway: it
  // asks again, for the message as it is now.
  await insertThanks();
  await expect(message(page).locator("span[data-field]")).toHaveCount(2);
  await alert.getByRole("button", { name: "Send anyway" }).click();
  await expect(alert).toBeVisible();
  expect(await sent(page)).toBe(false);
  // Pressed again with nothing changed, it sends.
  await alert.getByRole("button", { name: "Send anyway" }).click();
  await expect.poll(() => sent(page)).toBe(true);
});

test("a file dropped on Fill in doesn't attach to the message", async ({ page }) => {
  await sendable(page);
  await card(page).getByRole("button", { name: "Templates" }).click();
  await page.keyboard.type("thanks");
  await page.keyboard.press("Enter");
  const fill = page.getByRole("dialog", { name: "Thanks, will review" });
  await fill.evaluate((el) => {
    const data = new DataTransfer();
    data.items.add(new File(["made up"], "notes.txt", { type: "text/plain" }));
    for (const type of ["dragenter", "dragover", "drop"])
      el.dispatchEvent(
        new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data }),
      );
  });
  await fill.getByRole("button", { name: "Cancel" }).click();
  await page.waitForTimeout(300);
  await expect(card(page).getByText("notes.txt")).toHaveCount(0);
});

test("from the composer's button, a template's From replaces a blank message's", async ({
  page,
}) => {
  await page.goto("/tests/browser/harness.html?mode=card&alias=1");
  const from = card(page).getByRole("combobox", { name: "From" });
  await expect(from).toHaveValue("1:alex@rivera.example");
  await message(page).click();
  await card(page).getByRole("button", { name: "Templates" }).click();
  await page.keyboard.type("change control");
  await page.keyboard.press("Enter");
  await page
    .getByRole("dialog", { name: "Change control" })
    .getByRole("button", { name: "Insert" })
    .click();
  await expect(message(page)).toContainText("In this window we will:");
  await expect(from).toHaveValue("1:alex@northwind.example");
});

/**
 * Makes the page hear about caret moves (`selectionchange`) late while
 * `window.__caretLate` is set, as a busy machine does: the editor learns
 * where a key moved the caret only after the next key has arrived (CI,
 * 2026-11-28). Call before `goto`.
 */
async function lateCaretMoves(page: Page) {
  await page.addInitScript(() => {
    const add = Document.prototype.addEventListener;
    Document.prototype.addEventListener = function (
      this: Document,
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (type !== "selectionchange" || typeof listener !== "function")
        return add.call(this, type, listener as EventListenerOrEventListenerObject, options);
      const late = (e: Event) => {
        const ms = (window as unknown as { __caretLate?: number }).__caretLate ?? 0;
        if (ms > 0) setTimeout(() => listener.call(this, e), ms);
        else listener.call(this, e);
      };
      return add.call(this, type, late, options);
    } as typeof Document.prototype.addEventListener;
  });
}

/**
 * Presses a key that moves the caret, then waits until the page has heard
 * about the move: the editor acts on the next arrow from where it last
 * heard the caret was, so keys pressed faster than it hears them act from
 * the wrong place (an arrow meant to select a field moved past it). Caps
 * the wait, for a key that doesn't move the caret.
 */
async function pressHeard(page: Page, key: string) {
  await page.evaluate(() => {
    const w = window as unknown as { __caretHeard?: Promise<void> };
    w.__caretHeard = new Promise<void>((done) => {
      const cap = setTimeout(done, 2000);
      document.addEventListener(
        "selectionchange",
        () => {
          clearTimeout(cap);
          setTimeout(done, 0);
        },
        { once: true },
      );
    });
  });
  await page.keyboard.press(key);
  await page.evaluate(() => (window as unknown as { __caretHeard?: Promise<void> }).__caretHeard);
}

test("Settings: a new template with a field, changed again from the keyboard", async ({ page }) => {
  await lateCaretMoves(page);
  await page.goto("/tests/browser/harness.html?mode=settings&section=templates");
  await page.getByRole("button", { name: "New template" }).click();
  const editor = page.getByRole("dialog", { name: "New template" });
  await editor.getByLabel("Name").fill("Weekly report");
  const body = editor.getByRole("textbox", { name: "Message" });
  await body.click();
  await page.keyboard.type("Report for ");

  await editor.getByRole("button", { name: "Add field" }).click();
  const field = page.getByRole("dialog", { name: "Add field" });
  await field.getByRole("textbox", { name: "Name" }).fill("Week");
  await field.getByLabel("Kind").selectOption("date");
  await field.getByLabel("Written here as").selectOption("short");
  await field.getByRole("button", { name: "Add" }).click();
  await expect(body.locator(".template-field")).toHaveText("Week");
  await page.keyboard.type(".");
  await editor.getByRole("button", { name: "Save" }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole("listitem").filter({ hasText: "Weekly report" })).toContainText(
    "1 field",
  );

  // Back in: the arrow keys select the field, and Return opens its settings.
  // Caret moves are heard late here, as on a busy runner, so each key
  // waits for its move to be heard.
  await page.getByRole("button", { name: "Edit Weekly report" }).click();
  const again = page.getByRole("dialog", { name: "Edit template" });
  await page.evaluate(() => ((window as unknown as { __caretLate: number }).__caretLate = 80));
  await again.getByRole("textbox", { name: "Message" }).click();
  await pressHeard(page, "End");
  await pressHeard(page, "ArrowLeft");
  await pressHeard(page, "ArrowLeft");
  await expect(again.locator(".template-field.ProseMirror-selectednode")).toHaveText("Week");
  await page.keyboard.press("Enter");
  const settings = page.getByRole("dialog", { name: "Field" });
  await expect(settings.getByRole("textbox", { name: "Name" })).toHaveValue("Week");
  await expect(settings.getByLabel("Written here as")).toHaveValue("short");
});

const subjectLine = (page: Page) => card(page).getByRole("textbox", { name: "Subject" });

test("the subject line types, pastes and sends as a text box did", async ({ page }) => {
  await page.goto("/tests/browser/harness.html?mode=card");
  const subject = subjectLine(page);
  await subject.click();
  await page.keyboard.type("Lunch on Friday?");
  await expect(subject).toHaveText("Lunch on Friday?");
  // The card's title follows it.
  await expect(card(page).getByRole("heading")).toHaveText("Lunch on Friday?");
  // Pasted lines stay on one line, words apart.
  await page.keyboard.press("ControlOrMeta+A");
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text/plain", "Two\nlines");
    document.activeElement?.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
  });
  await expect(subject).toHaveText("Two lines");
  await expect(subject.locator("p")).toHaveCount(1);
  // Return sends, as before: here it asks for a recipient first.
  await page.keyboard.press("Enter");
  await expect(card(page).getByRole("alert")).toHaveText("Add at least one recipient.");
  await expect(subject).toHaveText("Two lines");
  // Tab goes on to the message.
  await page.keyboard.press("Tab");
  await expect(message(page)).toBeFocused();
});

test("a field left empty in the subject is a field there too", async ({ page }) => {
  await sendable(page);
  await card(page).getByRole("button", { name: "Templates" }).click();
  await page.keyboard.type("change control");
  await page.keyboard.press("Enter");
  const fill = page.getByRole("dialog", { name: "Change control" });
  await fill.getByLabel("Changes").fill("Upgrade the build servers");
  await fill.getByLabel("Rollback").fill("Restore the previous image");
  await fill.getByRole("button", { name: "Insert" }).click();
  // The subject was empty, so it came from the template, its field filled.
  await expect(subjectLine(page)).toHaveText(/^Change control: [A-Z][a-z]+ \d{4}$/);
  await expect(subjectLine(page).locator(".template-field")).toHaveCount(0);

  // A template whose subject field is left empty: "Out next week" in a new
  // message, its last day cleared.
  await page.goto("/tests/browser/harness.html?mode=card");
  await card(page).getByRole("combobox", { name: "To" }).click();
  await page.keyboard.type("maya@x.example,");
  await message(page).click();
  await card(page).getByRole("button", { name: "Templates" }).click();
  await page.keyboard.type("out next week");
  await page.keyboard.press("Enter");
  const out = page.getByRole("dialog", { name: "Out next week" });
  await out.getByLabel("Last day").fill("");
  await out.getByRole("button", { name: "Insert" }).click();
  const field = subjectLine(page).locator(".template-field");
  await expect(field).toHaveText("Last day");

  // Send asks about both (in the text and the subject), and Go to it
  // goes to the text's first; once that's typed over, to the subject's.
  await card(page).getByRole("button", { name: "Send" }).click();
  const alert = card(page).getByRole("alert").filter({ hasText: "filled in" });
  await expect(alert).toContainText("“Last day”");
  await alert.getByRole("button", { name: "Go to it" }).click();
  await page.keyboard.type("Friday");
  await card(page).getByRole("button", { name: "Send" }).click();
  await expect(alert).toHaveText(/“Last day” hasn’t been filled in\./);
  await alert.getByRole("button", { name: "Go to it" }).click();
  await expect(subjectLine(page)).toBeFocused();
  await page.keyboard.type("Jan 15");
  await expect(field).toHaveCount(0);
  await expect(subjectLine(page)).toHaveText(/ to Jan 15$/);
  // Nothing waits now: Send sends.
  await card(page).getByRole("button", { name: "Send" }).click();
  await expect.poll(() => sent(page)).toBe(true);
});
