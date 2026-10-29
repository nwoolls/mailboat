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
  await expect(page.getByText("Drop the downloaded file here")).toBeVisible();
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
  await expect(page.getByText("Create a Desktop client and download it")).toBeVisible();
});

test("the first sign-in is prepared for Google's real screens", async ({ page }) => {
  await open(page, "stage=accounts&configured=1");
  await expect(page.getByText("Two things Google will show you")).toBeVisible();
  await expect(page.getByText("currently being tested")).toBeVisible();
  await expect(page.getByText(/Advanced/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeFocused();
});
