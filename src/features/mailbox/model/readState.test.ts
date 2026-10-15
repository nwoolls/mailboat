import { describe, expect, it } from "vitest";
import type { ThreadDetail, ThreadSummary } from "../../../platform/tauri/bindings";
import { readToggle, withDetailRead, withThreadsRead } from "./readState";

const thread = (id: number, unread: boolean): ThreadSummary => ({
  id,
  accountId: 1,
  subject: "s",
  snippet: "",
  senders: [],
  lastMessageAt: 0,
  messageCount: 1,
  unread,
  starred: false,
  hasAttachments: false,
});

describe("read state", () => {
  it("marks only the chosen threads in every cached page", () => {
    const data = {
      pages: [{ threads: [thread(1, true), thread(2, true)], nextCursor: null }],
      pageParams: [null],
    };
    const next = withThreadsRead(data, new Set([2]), true)!;
    expect(next.pages[0]!.threads.map((t) => t.unread)).toEqual([true, false]);
    expect(data.pages[0]!.threads[1]!.unread).toBe(true); // original untouched
  });

  it("marks every message in a thread detail", () => {
    const detail: ThreadDetail = {
      thread: thread(1, true),
      labels: [],
      messages: [
        {
          ...thread(1, false),
          id: 10,
          threadId: 1,
          from: { name: null, email: "a@x" },
          to: [],
          cc: [],
          internalDate: 0,
        },
        {
          ...thread(1, true),
          id: 11,
          threadId: 1,
          from: { name: null, email: "a@x" },
          to: [],
          cc: [],
          internalDate: 1,
        },
      ],
    };
    const next = withDetailRead(detail, false)!;
    expect(next.thread.unread).toBe(true);
    expect(next.messages.every((m) => m.unread)).toBe(true);
  });

  it("u flips the selected thread", () => {
    const list = [thread(1, true), thread(2, false)];
    expect(readToggle(list, 1)).toEqual({ id: 1, read: true });
    expect(readToggle(list, 2)).toEqual({ id: 2, read: false });
    expect(readToggle(list, null)).toBeNull();
  });
});
