import { expect, test } from "@playwright/test";

/**
 * Settings → List (Milestone 8): every density and number of preview
 * lines gives rows whose text fits inside them, with the preview showing
 * the lines chosen (none, one, or two wrapped lines).
 */
for (const density of ["compact", "default", "roomy"]) {
  for (const lines of [0, 1, 2]) {
    test(`${density} rows with ${lines} preview lines fit their text`, async ({ page }) => {
      await page.goto(`/tests/browser/harness.html?mode=list&density=${density}&lines=${lines}`);
      const rows = page.getByRole("option");
      await expect(rows.first()).toBeVisible();
      const measured = await rows.evaluateAll((els) =>
        els.map((row) => {
          const text = row.firstElementChild as HTMLElement;
          const box = row.getBoundingClientRect();
          const inner = text.getBoundingClientRect();
          const preview = text.children[2] as HTMLElement | undefined;
          return {
            top: inner.top - box.top,
            bottom: box.bottom - inner.bottom,
            previewHeight: preview?.getBoundingClientRect().height ?? 0,
          };
        }),
      );
      for (const m of measured) {
        // Clear of the row's edges, top and bottom: 4px (as the rows
        // always were), 2px when compact.
        const room = density === "compact" ? 2 : 4;
        expect(m.top).toBeGreaterThanOrEqual(room);
        expect(m.bottom).toBeGreaterThanOrEqual(room);
        // A preview line of small text is 16px.
        expect(Math.round(m.previewHeight / 16)).toBe(lines);
      }
    });
  }
}
