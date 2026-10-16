import { describe, expect, it } from "vitest";
import type { MailView, UnreadCounts } from "../../../platform/tauri/bindings";
import { countText, parseCountMode, unreadIn, viewUnread } from "./sidebar";

const counts: UnreadCounts = {
  labels: [
    { labelId: 1, accountId: 1, gmailLabelId: "INBOX", unread: 2 },
    { labelId: 2, accountId: 1, gmailLabelId: "UNREAD", unread: 5000 },
    { labelId: 3, accountId: 1, gmailLabelId: "Label_1", unread: 1 },
    { labelId: 4, accountId: 1, gmailLabelId: "STARRED", unread: 1 },
    { labelId: 11, accountId: 2, gmailLabelId: "INBOX", unread: 3 },
    { labelId: 13, accountId: 2, gmailLabelId: "Label_1", unread: 4 },
  ],
  accounts: [
    { accountId: 1, allMail: 5000, archive: 4998 },
    { accountId: 2, allMail: 300, archive: 297 },
  ],
};
const ALL = { kind: "all" } as const;
const view = (label: "inbox" | "unread" | "starred" | "sent"): MailView => ({
  kind: "system",
  label,
});

describe("unread counts", () => {
  it("sums Inbox over all accounts, or just the chosen ones", () => {
    expect(unreadIn(counts.labels, "INBOX", ALL)).toBe(5);
    expect(unreadIn(counts.labels, "INBOX", { kind: "only", ids: [2] })).toBe(3);
  });

  it("keeps same-ID user labels apart (they belong to one account each)", () => {
    expect(viewUnread(counts, { kind: "userLabel", labelId: 3 }, ALL, "actionable")).toBe(1);
    expect(viewUnread(counts, { kind: "userLabel", labelId: 13 }, ALL, "actionable")).toBe(4);
  });

  it("actionable: Inbox, Starred and labels, not the backlog views", () => {
    expect(viewUnread(counts, view("inbox"), ALL, "actionable")).toBe(5);
    expect(viewUnread(counts, view("starred"), ALL, "actionable")).toBe(1);
    expect(viewUnread(counts, view("unread"), ALL, "actionable")).toBe(0);
    expect(viewUnread(counts, { kind: "archive" }, ALL, "actionable")).toBe(0);
  });

  it("everything: Unread, Archive and All Mail too, never Sent", () => {
    expect(viewUnread(counts, view("unread"), ALL, "everything")).toBe(5000);
    expect(viewUnread(counts, { kind: "archive" }, ALL, "everything")).toBe(5295);
    expect(viewUnread(counts, { kind: "allMail" }, { kind: "only", ids: [2] }, "everything")).toBe(
      300,
    );
    expect(viewUnread(counts, view("sent"), ALL, "everything")).toBe(0);
  });

  it("off: nothing", () => {
    expect(viewUnread(counts, view("inbox"), ALL, "off")).toBe(0);
  });

  it("formats counts quietly", () => {
    expect(countText(0)).toBeNull();
    expect(countText(12)).toBe("12");
    expect(countText(1200)).toBe("999+");
  });

  it("reads a saved mode, falling back to actionable", () => {
    expect(parseCountMode("off")).toBe("off");
    expect(parseCountMode(null)).toBe("actionable");
  });
});
