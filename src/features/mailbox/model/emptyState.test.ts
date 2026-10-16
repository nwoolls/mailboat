import { describe, expect, it } from "vitest";
import { emptyStateFor, emptyStateKey } from "./emptyState";

describe("emptyStateFor", () => {
  it("keeps an empty inbox to an icon and a title", () => {
    const state = emptyStateFor({ kind: "system", label: "inbox" });
    expect(state.icon).toBe("caughtUp");
    expect(state.title).toBe("All caught up");
    expect(state.detail).toBeUndefined();
  });

  it("names the search text when nothing matches", () => {
    const state = emptyStateFor({ kind: "search", text: "invoice" });
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
      expect(emptyStateFor({ kind: "system", label }).title).not.toBe("");
    }
  });
});

describe("emptyStateKey", () => {
  it("is the same for two empty labels, so the entrance doesn't replay", () => {
    const a = emptyStateKey({ kind: "userLabel", labelId: 1 });
    const b = emptyStateKey({ kind: "userLabel", labelId: 2 });
    expect(a).toBe(b);
  });

  it("changes when the empty state shows something different", () => {
    const label = emptyStateKey({ kind: "userLabel", labelId: 1 });
    const archive = emptyStateKey({ kind: "archive" });
    expect(label).not.toBe(archive);
  });

  it("stays put while a search is typed", () => {
    expect(emptyStateKey({ kind: "search", text: "a" })).toBe(
      emptyStateKey({ kind: "search", text: "ab" }),
    );
  });
});
