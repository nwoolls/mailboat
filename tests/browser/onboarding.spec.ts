import { expect, type Page, test } from "@playwright/test";

const open = (page: Page, query: string) =>
  page.goto(`/tests/browser/harness.html?mode=onboarding&${query}`);

/** Drops a file named `name` holding `text` on the window, as Finder would. */
async function dropFile(page: Page, name: string, text: string) {
  await page.evaluate(
    ({ name, text }) => {
      const data = new DataTransfer();
      data.items.add(new File([text], name, { type: "application/json" }));
      for (const type of ["dragenter", "dragover", "drop"])
        window.dispatchEvent(new DragEvent(type, { dataTransfer: data, bubbles: true }));
    },
    { name, text },
  );
}

test("the welcome leads to choosing how to connect to Google", async ({ page }) => {
  await open(page, "stage=welcome");
  await expect(page.getByText("All your Gmail accounts, in one calm inbox.")).toBeVisible();
  await expect(
    page.getByText("Straight from Google to your computer. Nothing in between."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Get started" }).click();
  await expect(
    page.getByRole("heading", { name: "Set up your Google Cloud project" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Guide me/ })).toBeFocused();
});

test("ticking a step opens the next one", async ({ page }) => {
  await open(page, "stage=google&path=guide");
  await expect(page.getByText("A project is a free space")).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByText("A project is a free space")).toBeHidden();
  await expect(page.getByText(/^These let .* read/)).toBeVisible();
});

test("a dropped Web client is explained, a Desktop one connects", async ({ page }) => {
  await open(page, "stage=google&path=have");
  await expect(page.getByText("Drop your credentials file here")).toBeVisible();
  await dropFile(page, "client_secret_web.json", '{"web":{}}');
  await expect(page.getByRole("alert")).toHaveText('This is a "Web application" client.');
  await dropFile(page, "client_secret_1.json", '{"installed":{}}');
  await expect(page.getByRole("heading", { name: "Google Cloud is set up" })).toBeVisible();
  await expect(page.getByText("your project “mail-k3x9qa”")).toBeVisible();
});

test("the guide ends with test users, never with publishing", async ({ page }) => {
  await open(page, "stage=google&path=guide&done=project,apis,branding");
  await expect(page.getByText("Add your Gmail addresses as test users")).toBeVisible();
  await expect(page.getByText(/Publish the app|Publish app/)).toHaveCount(0);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByText("Create and download OAuth credentials")).toBeVisible();
});

test("the first sign-in is prepared for Google's real screens", async ({ page }) => {
  await open(page, "stage=accounts&configured=1");
  await expect(page.getByText("Two things Google will show you")).toBeVisible();
  await expect(page.getByText("currently being tested")).toBeVisible();
  await expect(page.getByText(/Advanced/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeFocused();
});

test("the intro paragraph is as wide as the cards under it", async ({ page }) => {
  for (const query of ["stage=google", "stage=accounts&configured=1"]) {
    await open(page, query);
    const paragraph = await page.locator("header p").first().boundingBox();
    const column = await page.locator(".onb-stage").boundingBox();
    expect(paragraph!.width).toBeCloseTo(column!.width, 0);
  }
});

test("each Google Cloud step shows a picture of the page, framed like a browser", async ({
  page,
}) => {
  await open(page, "stage=google&path=guide");
  await expect(page.getByText("console.cloud.google.com/projectcreate")).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByText("console.cloud.google.com/apis/library")).toBeVisible();
});

test("while mail is still syncing, the accounts screen says you can continue", async ({ page }) => {
  await open(page, "stage=accounts&configured=1&accounts=1");
  await expect(
    page.getByText(
      "You can continue now. Syncing carries on in the background, and your mail appears as it arrives.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
});

test("the rail doesn't promise that everything is in Settings", async ({ page }) => {
  await open(page, "stage=google");
  await expect(page.getByText(/in Settings afterwards/)).toHaveCount(0);
});
