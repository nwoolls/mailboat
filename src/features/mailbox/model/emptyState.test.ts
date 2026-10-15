import { describe, expect, it } from "vitest";
import { CAUGHT_UP_LINES, dayNumber, emptyStateFor } from "./emptyState";

describe("emptyStateFor", () => {
  it("celebrates an empty inbox with the day's line", () => {
    const state = emptyStateFor({ kind: "system", label: "inbox" }, 0);
    expect(state.icon).toBe("caughtUp");
    expect(state.title).toBe("All caught up");
    expect(state.detail).toBe(CAUGHT_UP_LINES[0]);
  });

  it("cycles through the lines day by day", () => {
    const inbox = { kind: "system", label: "inbox" } as const;
    const n = CAUGHT_UP_LINES.length;
    expect(emptyStateFor(inbox, 1).detail).toBe(CAUGHT_UP_LINES[1]);
    expect(emptyStateFor(inbox, n).detail).toBe(CAUGHT_UP_LINES[0]);
  });

  it("names the search text when nothing matches", () => {
    const state = emptyStateFor({ kind: "search", text: "invoice" }, 0);
    expect(state.icon).toBe("search");
    expect(state.title).toContain("invoice");
  });

  it("has a message for every system view", () => {
    const labels = [
      "inbox",
      "unread",
      "starred",
      "important",
      "sent",
      "draft",
      "spam",
      "trash",
    ] as const;
    for (const label of labels) {
      expect(emptyStateFor({ kind: "system", label }, 0).title).not.toBe("");
    }
  });
});

describe("dayNumber", () => {
  it("changes at local midnight, not UTC midnight", () => {
    const evening = new Date(2026, 9, 15, 23, 30);
    const nextMorning = new Date(2026, 9, 16, 0, 30);
    expect(dayNumber(nextMorning) - dayNumber(evening)).toBe(1);
    expect(dayNumber(new Date(2026, 9, 15, 0, 1))).toBe(dayNumber(evening));
  });
});
