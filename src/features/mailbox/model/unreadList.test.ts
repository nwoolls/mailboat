import { describe, expect, it } from "vitest";
import type { ThreadPage, ThreadSummary } from "../../../platform/tauri/bindings";
import { withAction } from "./threadActions";
import { keepReadRows, type ListData } from "./unreadList";

// Made-up rows: ids and times only matter here.
const row = (id: number, at: number, unread = true): ThreadSummary =>
  ({
    id,
    accountId: 1,
    subject: `Subject ${id}`,
    snippet: "",
    senders: [],
    lastMessageAt: at,
    messageCount: 1,
    unread,
    starred: false,
    hasAttachments: false,
    inInbox: true,
    inTrash: false,
    labelIds: [],
    onlyDraft: false,
    inSpam: false,
    signInCode: null,
  }) as unknown as ThreadSummary;

const list = (...pages: ThreadSummary[][]): ListData => ({
  pages: pages.map((threads): ThreadPage => ({ threads, nextCursor: null })),
  pageParams: pages.map(() => null),
});
const shown = (data: ListData) => data.pages.flatMap((p) => p.threads);
const ids = (data: ListData) => shown(data).map((t) => t.id);
const unreadView = { kind: "system", label: "unread" } as const;

describe("the Unread list keeps what was read during the visit", () => {
  it("keeps a conversation a refresh leaves out, shown as read, in its place", () => {
    // Opened: the list marks it read at once (the app's own update)…
    const opened = keepReadRows(
      list([row(1, 300), row(2, 200), row(3, 100)]),
      withAction(
        list([row(1, 300), row(2, 200), row(3, 100)]),
        new Set([2 as never]),
        { kind: "read", read: true },
        unreadView,
      )!,
    );
    // …then the refresh brings only what is unread.
    const refreshed = keepReadRows(opened, list([row(1, 300), row(3, 100)]));
    expect(ids(refreshed)).toEqual([1, 2, 3]);
    expect(shown(refreshed)[1]!.unread).toBe(false);
  });

  it("puts kept rows back in order across pages, and at the end", () => {
    const before = list([row(1, 500), row(2, 400)], [row(3, 300), row(4, 100, false)]);
    const after = keepReadRows(before, list([row(1, 500)], [row(3, 300)]));
    expect(after.pages.map((p) => p.threads.map((t) => t.id))).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("takes the app's own updates as they are: Trash removes, Mark unread shows at once", () => {
    const start = list([row(1, 300), row(2, 200, false)]);
    const trashed = keepReadRows(
      start,
      withAction(start, new Set([2 as never]), { kind: "trash", trashed: true }, unreadView)!,
    );
    expect(ids(trashed)).toEqual([1]);
    // No marker left in the cached data.
    expect("local" in trashed).toBe(false);
    const unread = keepReadRows(
      start,
      withAction(start, new Set([2 as never]), { kind: "read", read: false }, unreadView)!,
    );
    expect(shown(unread)[1]!.unread).toBe(true);
  });

  it("restores a failed action's snapshot without losing rows", () => {
    const before = list([row(1, 300), row(2, 200, false)]);
    const optimistic = keepReadRows(
      before,
      withAction(before, new Set([2 as never]), { kind: "star", starred: true }, unreadView)!,
    );
    expect(shown(optimistic)[1]!.starred).toBe(true);
    // The rollback writes the snapshot back (not a local update).
    const rolledBack = keepReadRows(optimistic, before);
    expect(ids(rolledBack)).toEqual([1, 2]);
    expect(shown(rolledBack)[1]!.starred).toBe(false);
  });

  it("starts fresh with no earlier list (the view was left and forgotten)", () => {
    const first = list([row(1, 300)]);
    expect(keepReadRows(undefined, first)).toBe(first);
  });

  it("keeps unchanged rows the same objects (no needless re-render)", () => {
    const a = row(1, 300);
    const prev = list([a]);
    const next = keepReadRows(prev, list([{ ...a }]));
    expect(shown(next)[0]).toBe(a);
  });
});
