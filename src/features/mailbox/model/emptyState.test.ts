import { describe, expect, it } from "vitest";
import { emptyStateFor, emptyStateKey, isFirstSync } from "./emptyState";

describe("emptyStateFor", () => {
  it("keeps an empty inbox to an icon and a title", () => {
    const state = emptyStateFor({ kind: "system", label: "inbox" });
    expect(state.icon).toBe("caughtUp");
    expect(state.title).toBe("All caught up");
    expect(state.detail).toBeUndefined();
  });

  it("doesn't say all caught up while a first sync is still bringing mail in", () => {
    const state = emptyStateFor({ kind: "system", label: "inbox" }, true);
    expect(state.title).toBe("Getting your mail…");
    expect(emptyStateFor({ kind: "search", text: "x" }, true).icon).toBe("search");
  });

  it("points to Settings when every account was removed, whatever the view", () => {
    for (const view of [
      { kind: "system", label: "inbox" },
      { kind: "search", text: "x" },
      { kind: "allMail" },
    ] as const) {
      const state = emptyStateFor(view, false, true);
      expect(state.title).toBe("No accounts yet");
      expect(state.detail).toContain("Settings → Accounts");
      // A first sync can't be going: there is no account to sync.
      expect(emptyStateFor(view, true, true)).toEqual(state);
    }
    expect(emptyStateKey({ kind: "search", text: "x" }, false, true)).toBe(
      emptyStateKey({ kind: "system", label: "inbox" }, false, true),
    );
  });

  it("counts only a first sync, not the later once-a-minute ones", () => {
    const state = (status: string, lastSyncAt: number | null) =>
      ({ accountId: 1, status, errorKind: null, errorMessage: null, lastSyncAt }) as never;
    expect(isFirstSync(state("syncing", null))).toBe(true);
    expect(isFirstSync(state("backoff", null))).toBe(true);
    expect(isFirstSync(state("syncing", 5))).toBe(false);
    expect(isFirstSync(state("error", null))).toBe(false);
    expect(isFirstSync(state("authError", null))).toBe(false);
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
