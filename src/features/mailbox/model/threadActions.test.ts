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
  deleteKeyAction,
  inverse,
  labelState,
  labelToggle,
  leavesView,
  moveAfterRemoval,
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
  signInCode: null,
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

describe("deleteKeyAction", () => {
  it("trashes or archives, and never brings conversations back", () => {
    expect(deleteKeyAction("trash", [thread(1)])).toEqual({ kind: "trash", trashed: true });
    expect(deleteKeyAction("trash", [thread(1, { inTrash: true })])).toBeNull();
    expect(deleteKeyAction("archive", [thread(1)])).toEqual({ kind: "archive", archived: true });
    expect(deleteKeyAction("archive", [thread(1, { inInbox: false })])).toBeNull();
    expect(deleteKeyAction("trash", [])).toBeNull();
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

  // Settings → Viewing → "Include Spam and Trash": such a search shows them,
  // so moving a conversation to or out of Trash or Spam keeps it in the
  // results. Undoing a restore there moved on to the next conversation and
  // opened the preview the person had collapsed.
  it("keeps conversations in a search that includes Spam and Trash", () => {
    const everywhere = { kind: "search", text: "plans", withSpamTrash: true } as const;
    for (const action of [
      { kind: "trash", trashed: true },
      { kind: "trash", trashed: false },
      { kind: "spam", spam: true },
      { kind: "spam", spam: false },
    ] as const)
      expect(leavesView(action, everywhere), JSON.stringify(action)).toBe(false);
    // An ordinary search leaves them out.
    const ordinary = { kind: "search", text: "plans" } as const;
    expect(leavesView({ kind: "trash", trashed: true }, ordinary)).toBe(true);
    expect(leavesView({ kind: "spam", spam: true }, ordinary)).toBe(true);
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

  // In a search that includes Spam and Trash, a conversation moved to
  // either stays, showing where it is now, so Restore / Not spam is on
  // offer (code review).
  it("keeps a row moved to Trash or Spam in a search that includes them", () => {
    const everywhere = { kind: "search", text: "plans", withSpamTrash: true } as const;
    const trashed = withAction(
      page(thread(1)),
      new Set([1]),
      { kind: "trash", trashed: true },
      everywhere,
    )!.pages[0]!.threads;
    expect(trashed.map((t) => [t.id, t.inTrash])).toEqual([[1, true]]);
    expect(toggleFor("trash", trashed)).toEqual({ kind: "trash", trashed: false });
    const spammed = withAction(
      page(thread(1)),
      new Set([1]),
      { kind: "spam", spam: true },
      everywhere,
    )!.pages[0]!.threads;
    expect(spammed.map((t) => [t.id, t.inSpam])).toEqual([[1, true]]);
    expect(toggleFor("spam", spammed)).toEqual({ kind: "spam", spam: false });
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

const ids = (...n: number[]) => new Set(n.map(id));

describe("moveAfterRemoval", () => {
  const list = [thread(1), thread(2), thread(3), thread(4)];

  it("with a preview showing, previews the next conversation", () => {
    expect(
      moveAfterRemoval(list, ids(2), { previewed: id(2), selected: null, previewing: true }),
    ).toEqual({ previewed: 3, selected: null });
  });

  // Owner request, 2026-11-09: after collapsing the preview by hand,
  // archiving reopened it on the next conversation, though moving with the
  // keyboard leaves it collapsed. The next one is chosen the same way, and
  // selected without being previewed.
  it("with the preview collapsed, selects the next conversation without previewing it", () => {
    // Collapsed with its button or Esc: the conversation stays chosen.
    expect(
      moveAfterRemoval(list, ids(2), { previewed: id(2), selected: null, previewing: false }),
    ).toEqual({ previewed: null, selected: 3 });
    // Moved to with j/k while collapsed.
    expect(
      moveAfterRemoval(list, ids(3), { previewed: null, selected: id(3), previewing: false }),
    ).toEqual({ previewed: null, selected: 4 });
    // Settings → Viewing: the one above.
    expect(
      moveAfterRemoval(
        list,
        ids(2),
        { previewed: id(2), selected: null, previewing: false },
        "above",
      ),
    ).toEqual({ previewed: null, selected: 1 });
    // Several removed at once, the collapsed one among them.
    expect(
      moveAfterRemoval(list, ids(2, 3), { previewed: id(2), selected: null, previewing: false }),
    ).toEqual({ previewed: null, selected: 4 });
    // Settings → Viewing: go back to the list.
    expect(
      moveAfterRemoval(
        list,
        ids(2),
        { previewed: id(2), selected: null, previewing: false },
        "none",
      ),
    ).toEqual({ previewed: null, selected: null });
  });

  it("leaves the choice alone when another conversation is removed", () => {
    expect(
      moveAfterRemoval(list, ids(4), { previewed: id(2), selected: null, previewing: false }),
    ).toEqual({ previewed: 2, selected: null });
  });
});
