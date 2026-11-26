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
      // Each section with its controls in place before measuring: the
      // harness answers with data for them (review, round 1).
      const ready = {
        ai: page.getByRole("button", { name: "Get Claude app" }),
        accounts: page
          .getByRole("radiogroup", { name: "Account color" })
          .getByRole("radio")
          .first(),
        rules: page.getByText("news@x.example").first(),
        toybox: page.getByRole("radio").first(),
      }[id];
      await expect(ready ?? page.locator("[data-settings-row]").first()).toBeVisible();
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
        // (A <select> is left out: its options' text isn't laid out in it,
        // and its own box is measured with its row above.)
        // Text inside every control stays inside it: a label too long for
        // its button, or a segment's text running into the next (text is
        // measured as rendered, since a label is often a bare text node).
        const panelBox = scroller?.getBoundingClientRect();
        for (const el of document.querySelectorAll<HTMLElement>(
          "section[aria-label^='Settings'] :is(button, [role=radio], [role=switch], a)",
        )) {
          const own = el.getBoundingClientRect();
          if (own.width === 0) continue;
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            if (!n.textContent?.trim()) continue;
            const range = document.createRange();
            range.selectNodeContents(n);
            const t = range.getBoundingClientRect();
            if (t.left < own.left - 1 || t.right > own.right + 1) {
              out.push(`"${el.textContent?.trim().slice(0, 30)}": its text spills out of it`);
              break;
            }
            if (panelBox && t.right > panelBox.right + 1) {
              out.push(`"${el.textContent?.trim().slice(0, 30)}": its text runs past the panel`);
              break;
            }
          }
        }
        return out;
      });
      expect(problems).toEqual([]);
      // With room for both, a row keeps its control beside its text: the
      // wrap is for narrow widths only (review, round 1).
      if (id === "ai" && width === 720) {
        const row = page.locator("[data-settings-row]", { hasText: "In the list" });
        const text = await row.locator("[data-settings-row-text]").boundingBox();
        const control = await row.locator("[data-settings-row-control]").boundingBox();
        expect(control!.x).toBeGreaterThanOrEqual(text!.x + text!.width - 1);
        expect(control!.y).toBeLessThan(text!.y + text!.height);
      }
    });
  }
}
