import { describe, expect, it } from "vitest";
import type {
  Label,
  ThreadDetail,
  ThreadId,
  ThreadSummary,
} from "../../../platform/tauri/bindings";
import {
  actionLabel,
  actionMessage,
  inverse,
  labelState,
  labelToggle,
  leavesView,
  nextAfterRemoval,
  selectionAfterUndo,
  toggleFor,
  updateSummary,
  withAction,
  withDetailAction,
} from "./threadActions";

const thread = (id: number, over: Partial<ThreadSummary> = {}): ThreadSummary => ({
  id,
  accountId: 1,
  subject: "s",
  snippet: "",
  senders: [],
  lastMessageAt: 0,
  messageCount: 1,
  unread: false,
  starred: false,
  hasAttachments: false,
  inInbox: true,
  inTrash: false,
  labelIds: [],
  onlyDraft: false,
  inSpam: false,
  ...over,
});

const label = (id: number, name: string, accountId = 1): Label => ({
  id,
  accountId,
  gmailLabelId: `Label_${id}`,
  name,
  kind: "user",
  colorBg: null,
  colorFg: null,
});

const inbox = { kind: "system", label: "inbox" } as const;
const page = (...threads: ThreadSummary[]) => ({
  pages: [{ threads, nextCursor: null }],
  pageParams: [null],
});

describe("toggleFor", () => {
  it("does the action unless every conversation already has it", () => {
    const starred = thread(1, { starred: true });
    const plain = thread(2);
    expect(toggleFor("star", [starred, plain])).toEqual({ kind: "star", starred: true });
    expect(toggleFor("star", [starred])).toEqual({ kind: "star", starred: false });
    expect(toggleFor("read", [thread(1, { unread: true })])).toEqual({ kind: "read", read: true });
    expect(toggleFor("archive", [thread(1, { inInbox: false })])).toEqual({
      kind: "archive",
      archived: false,
    });
    expect(toggleFor("trash", [thread(1, { inTrash: true })])).toEqual({
      kind: "trash",
      trashed: false,
    });
    expect(toggleFor("trash", [])).toBeNull();
  });
});

describe("leavesView", () => {
  it("knows which views lose a conversation", () => {
    expect(leavesView({ kind: "archive", archived: true }, inbox)).toBe(true);
    expect(leavesView({ kind: "archive", archived: true }, { kind: "allMail" })).toBe(false);
    expect(leavesView({ kind: "archive", archived: false }, { kind: "archive" })).toBe(true);
    expect(leavesView({ kind: "trash", trashed: true }, { kind: "allMail" })).toBe(true);
    expect(leavesView({ kind: "trash", trashed: true }, { kind: "system", label: "trash" })).toBe(
      false,
    );
    expect(leavesView({ kind: "trash", trashed: false }, { kind: "system", label: "trash" })).toBe(
      true,
    );
    expect(leavesView({ kind: "star", starred: false }, { kind: "system", label: "starred" })).toBe(
      true,
    );
    const work = label(7, "Work");
    expect(
      leavesView({ kind: "labels", add: [], remove: [work] }, { kind: "userLabel", labelId: 7 }),
    ).toBe(true);
    expect(
      leavesView({ kind: "labels", add: [], remove: [work] }, { kind: "userLabel", labelId: 8 }),
    ).toBe(false);
    expect(leavesView({ kind: "read", read: true }, { kind: "system", label: "unread" })).toBe(
      false,
    );
  });
});

describe("withAction", () => {
  it("drops rows that leave the view and leaves the original untouched", () => {
    const data = page(thread(1), thread(2));
    const next = withAction(data, new Set([2]), { kind: "archive", archived: true }, inbox)!;
    expect(next.pages[0]!.threads.map((t) => t.id)).toEqual([1]);
    expect(data.pages[0]!.threads).toHaveLength(2);
  });

  it("updates rows that stay", () => {
    const next = withAction(
      page(thread(1, { unread: true }), thread(2, { unread: true })),
      new Set([2]),
      { kind: "read", read: true },
      inbox,
    )!;
    expect(next.pages[0]!.threads.map((t) => t.unread)).toEqual([true, false]);
  });
});

describe("withDetailAction", () => {
  const message = (id: number, unread: boolean) => ({
    ...thread(1),
    id,
    threadId: 1,
    from: { name: null, email: "a@x" },
    to: [],
    cc: [],
    internalDate: id,
    unread,
    draft: false,
  });
  const detail: ThreadDetail = {
    thread: thread(1, { unread: true }),
    labels: [label(7, "Work")],
    messages: [message(10, false), message(11, true)],
  };

  it("marks every message read or unread", () => {
    const next = withDetailAction(detail, { kind: "read", read: false })!;
    expect(next.thread.unread).toBe(true);
    expect(next.messages.every((m) => m.unread)).toBe(true);
  });

  it("adds and removes labels of the thread's own account only", () => {
    const next = withDetailAction(detail, {
      kind: "labels",
      add: [label(8, "Abroad"), label(9, "Other account", 2)],
      remove: [label(7, "Work")],
    })!;
    expect(next.labels.map((l) => l.name)).toEqual(["Abroad"]);
  });
});

describe("undo and messages", () => {
  it("inverts actions", () => {
    expect(inverse({ kind: "archive", archived: true })).toEqual({
      kind: "archive",
      archived: false,
    });
    const a = label(1, "A");
    expect(inverse({ kind: "labels", add: [a], remove: [] })).toEqual({
      kind: "labels",
      add: [],
      remove: [a],
    });
  });

  it("describes what happened", () => {
    expect(actionMessage({ kind: "archive", archived: true }, 1)).toBe("Conversation archived");
    expect(actionMessage({ kind: "trash", trashed: true }, 3)).toBe(
      "3 conversations moved to Trash",
    );
    expect(actionMessage({ kind: "labels", add: [label(1, "Work")], remove: [] }, 1)).toBe(
      "Labeled “Work”",
    );
    expect(actionMessage({ kind: "star", starred: true }, 1)).toBeNull();
  });
});

describe("nextAfterRemoval", () => {
  const list = [thread(1), thread(2), thread(3), thread(4)];
  it("opens the next conversation below, else above", () => {
    expect(nextAfterRemoval(list, new Set([2]), 2)).toBe(3);
    expect(nextAfterRemoval(list, new Set([2, 3]), 2)).toBe(4);
    expect(nextAfterRemoval(list, new Set([3, 4]), 4)).toBe(2);
    expect(nextAfterRemoval(list, new Set([1, 2, 3, 4]), 1)).toBeNull();
  });
  it("keeps the open conversation if it stays", () => {
    expect(nextAfterRemoval(list, new Set([3]), 1)).toBe(1);
    expect(nextAfterRemoval(list, new Set([3]), 1, "none")).toBe(1);
  });
  it("can open the one above instead, else below", () => {
    expect(nextAfterRemoval(list, new Set([3]), 3, "above")).toBe(2);
    expect(nextAfterRemoval(list, new Set([2, 3]), 3, "above")).toBe(1);
    expect(nextAfterRemoval(list, new Set([1]), 1, "above")).toBe(2);
  });
  it("can open nothing", () => {
    expect(nextAfterRemoval(list, new Set([2]), 2, "none")).toBeNull();
  });
});

describe("labels in the picker", () => {
  const work = label(7, "Work");
  it("shows all, some or none", () => {
    expect(labelState([thread(1, { labelIds: [7] }), thread(2, { labelIds: [7] })], work)).toBe(
      "all",
    );
    expect(labelState([thread(1, { labelIds: [7] }), thread(2)], work)).toBe("some");
    expect(labelState([thread(1)], work)).toBe("none");
  });
  it("adds unless every conversation has it", () => {
    expect(labelToggle([thread(1, { labelIds: [7] }), thread(2)], work)).toEqual({
      kind: "labels",
      add: [work],
      remove: [],
    });
    expect(labelToggle([thread(1, { labelIds: [7] })], work)).toEqual({
      kind: "labels",
      add: [],
      remove: [work],
    });
  });
  it("updates rows' labels", () => {
    const next = withAction(
      page(thread(1, { labelIds: [3] })),
      new Set([1]),
      { kind: "labels", add: [work], remove: [label(3, "Old")] },
      inbox,
    )!;
    expect(next.pages[0]!.threads[0]!.labelIds).toEqual([7]);
  });
});

describe("spam", () => {
  it("reports spam unless all are spam, and leaves or returns to the view", () => {
    const a = toggleFor("spam", [thread(1), thread(2, { inSpam: true })]);
    expect(a).toEqual({ kind: "spam", spam: true });
    expect(toggleFor("spam", [thread(1, { inSpam: true })])).toEqual({ kind: "spam", spam: false });
    expect(leavesView({ kind: "spam", spam: true }, { kind: "system", label: "inbox" })).toBe(true);
    expect(leavesView({ kind: "spam", spam: false }, { kind: "system", label: "spam" })).toBe(true);
    expect(inverse({ kind: "spam", spam: true })).toEqual({ kind: "spam", spam: false });
    expect(updateSummary({ kind: "spam", spam: true }, thread(1, { inInbox: true }))).toMatchObject(
      {
        inSpam: true,
        inInbox: false,
      },
    );
  });
});

it("menu items say what they'd do now", () => {
  expect(actionLabel({ kind: "archive", archived: false })).toBe("Move to Inbox");
  expect(actionLabel({ kind: "spam", spam: true })).toBe("Report spam");
  expect(actionLabel(toggleFor("star", [thread(1, { starred: true })])!)).toBe("Unstar");
});

const id = (n: number) => n as ThreadId;

describe("selection after undo", () => {
  it("reopens the conversation that was open when it was archived", () => {
    expect(selectionAfterUndo(id(1), [id(1)], id(2))).toBe(1);
  });

  it("doesn't open a conversation that wasn't open (a swipe, or Inbox Zero)", () => {
    expect(selectionAfterUndo(null, [id(1)], null)).toBeNull();
    expect(selectionAfterUndo(id(3), [id(1)], id(3))).toBe(3);
  });
});
