import { expect, test } from "@playwright/test";

/**
 * Windows, dark mode (owner report, 2026-10-29): in a new message's From
 * list the address headings were near-white on a white list, though the
 * choices under them read fine. WebView2 draws a select's list itself, so
 * the headings (`optgroup`) need the theme's solid colors like the choices
 * (`option`) already have. Runs in Chromium, WebView2's engine, with the
 * Windows styles on.
 */
test("a dropdown's group headings take the same colors as its choices", async ({ page }) => {
  await page.goto("/tests/browser/harness.html?mode=card");
  await page.evaluate(() => {
    document.documentElement.dataset.platform = "windows";
    document.body.insertAdjacentHTML(
      "beforeend",
      '<select id="probe"><optgroup label="a@example.com"><option>A</option></optgroup></select>',
    );
  });
  const colors = await page.evaluate(() => {
    const group = getComputedStyle(document.querySelector("#probe optgroup")!);
    const choice = getComputedStyle(document.querySelector("#probe option")!);
    return {
      groupBackground: group.backgroundColor,
      groupText: group.color,
      choiceBackground: choice.backgroundColor,
      choiceText: choice.color,
    };
  });
  expect(colors.groupBackground).not.toBe("rgba(0, 0, 0, 0)");
  expect(colors.groupBackground).toBe(colors.choiceBackground);
  expect(colors.groupText).toBe(colors.choiceText);
});
