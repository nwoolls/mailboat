import { expect, test } from "@playwright/test";

/**
 * Every Settings section at a narrow width (a small window, or larger
 * fonts): no row's control sits over its title or text, and nothing runs
 * past the panel's edge. Seen on Linux with a larger desktop font, where
 * the three-way "Above a conversation" choice covered its row's title.
 */
// 400 stands in for a larger desktop font in a mid-sized window.
const WIDTHS = [400, 480, 720];

/** The sections, as `model/sections.ts` lists them (it can't be imported
 * here: it reads the app's name from `brand.json`). */
const SECTIONS = [
  "general",
  "accounts",
  "notifications",
  "appearance",
  "list",
  "viewing",
  "composing",
  "ai",
  "signatures",
  "rules",
  "vacation",
  "keyboard",
  "toybox",
  "privacy",
  "advanced",
];

for (const id of SECTIONS) {
  for (const width of WIDTHS) {
    test(`Settings → ${id} at ${width}px: controls never cover their text`, async ({ page }) => {
      await page.goto(`/tests/browser/harness.html?mode=settings&section=${id}&width=${width}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      // Sections that load data show their rows once it's in (Toybox has
      // cards, not rows).
      if (id !== "toybox") await expect(page.locator("[data-settings-row]").first()).toBeVisible();
      const problems = await page.evaluate(() => {
        const out: string[] = [];
        const panel = document.querySelector("section[aria-label^='Settings']");
        const scroller = panel?.querySelector<HTMLElement>(".overflow-y-auto");
        if (scroller && scroller.scrollWidth > scroller.clientWidth + 1) {
          out.push(`runs ${scroller.scrollWidth - scroller.clientWidth}px past the panel`);
        }
        for (const row of document.querySelectorAll<HTMLElement>("[data-settings-row]")) {
          const text = row.querySelector("[data-settings-row-text]")?.getBoundingClientRect();
          const control = row.querySelector("[data-settings-row-control]");
          if (!text || !control) continue;
          // What the control's contents really cover: a control wider than
          // its box spills out of it (to the left, as the box is aligned
          // right), so the box alone isn't enough.
          let left = Infinity;
          let right = -Infinity;
          let top = Infinity;
          for (const el of [control, ...control.querySelectorAll<HTMLElement>("*")]) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) continue;
            left = Math.min(left, r.left);
            right = Math.max(right, r.right);
            top = Math.min(top, r.top);
          }
          const name = row.querySelector("[data-settings-row-text]")?.textContent?.slice(0, 40);
          const beside = left >= text.right - 1;
          const below = top >= text.bottom - 1;
          if (!beside && !below) out.push(`"${name}": its control covers its text`);
          const box = row.getBoundingClientRect();
          if (right > box.right + 1 || left < box.left - 1) {
            out.push(`"${name}": its control runs past the row`);
          }
        }
        return out;
      });
      expect(problems).toEqual([]);
    });
  }
}
