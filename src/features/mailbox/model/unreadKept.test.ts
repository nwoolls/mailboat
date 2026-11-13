import { describe, expect, it } from "vitest";
import type { ThreadSummary } from "../../../platform/tauri/bindings";
import { keepRead, keptAfter, NOTHING_KEPT, withKept } from "./unreadKept";

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

const ids = (rows: ThreadSummary[]) => rows.map((t) => t.id);

describe("Unread keeps what was read during the visit", () => {
  it("keeps a conversation read here, shown as read, in its place", () => {
    // The list after opening 2: shown read at once…
    const opened = [row(1, 300), row(2, 200, false), row(3, 100)];
    const kept = keepRead(NOTHING_KEPT, opened);
    // …then refreshed without it.
    const refreshed = [row(1, 300), row(3, 100)];
    const shown = withKept(refreshed, keepRead(kept, refreshed));
    expect(ids(shown)).toEqual([1, 2, 3]);
    expect(shown[1]!.unread).toBe(false);
  });

  it("puts kept rows back newest first, at the ends too", () => {
    const kept = keepRead(NOTHING_KEPT, [row(9, 900, false), row(5, 50, false)]);
    expect(ids(withKept([row(1, 300), row(3, 100)], kept))).toEqual([9, 1, 3, 5]);
    // Same time: the higher id first, as the list orders them.
    const tie = keepRead(NOTHING_KEPT, [row(4, 300, false)]);
    expect(ids(withKept([row(1, 300), row(3, 100)], tie))).toEqual([4, 1, 3]);
  });

  it("doesn't repeat a row the list still has", () => {
    const kept = keepRead(NOTHING_KEPT, [row(2, 200, false)]);
    expect(ids(withKept([row(1, 300), row(2, 200, false), row(3, 100)], kept))).toEqual([1, 2, 3]);
  });

  it("lets a kept row go when it's archived or deleted, and shows it marked unread", () => {
    const kept = keepRead(NOTHING_KEPT, [row(2, 200, false)]);
    expect(keptAfter(kept, [2], { kind: "archive", archived: true }).size).toBe(0);
    expect(keptAfter(kept, [2], { kind: "trash", trashed: true }).size).toBe(0);
    const unread = keptAfter(kept, [2], { kind: "read", read: false });
    expect(unread.get(2 as never)!.unread).toBe(true);
    // Rows it doesn't keep: nothing changes.
    expect(keptAfter(kept, [7], { kind: "archive", archived: true })).toBe(kept);
  });

  it("stays the same object when nothing new was read (no needless re-render)", () => {
    const kept = keepRead(NOTHING_KEPT, [row(2, 200, false)]);
    expect(keepRead(kept, [row(1, 300)])).toBe(kept);
  });
});
