import { describe, expect, it } from "vitest";
import type { LabelUnread, MailView } from "../../../platform/tauri/bindings";
import { countText, unreadIn, viewUnread } from "./sidebar";

const counts: LabelUnread[] = [
  { labelId: 1, accountId: 1, gmailLabelId: "INBOX", unread: 2 },
  { labelId: 2, accountId: 1, gmailLabelId: "UNREAD", unread: 5000 },
  { labelId: 3, accountId: 1, gmailLabelId: "Label_1", unread: 1 },
  { labelId: 4, accountId: 1, gmailLabelId: "STARRED", unread: 1 },
  { labelId: 11, accountId: 2, gmailLabelId: "INBOX", unread: 3 },
  { labelId: 5, accountId: 1, gmailLabelId: "DRAFT", unread: 2 },
  { labelId: 15, accountId: 2, gmailLabelId: "DRAFT", unread: 1 },
  { labelId: 13, accountId: 2, gmailLabelId: "Label_1", unread: 4 },
];
const ALL = { kind: "all" } as const;
const system = (label: "inbox" | "unread" | "starred" | "sent" | "draft"): MailView => ({
  kind: "system",
  label,
});

describe("sidebar unread counts", () => {
  it("sums Inbox over all accounts, or just the chosen ones", () => {
    expect(unreadIn(counts, "INBOX", ALL)).toBe(5);
    expect(unreadIn(counts, "INBOX", { kind: "only", ids: [2] })).toBe(3);
  });

  it("keeps same-ID user labels apart (they belong to one account each)", () => {
    expect(viewUnread(counts, { kind: "userLabel", labelId: 3 }, ALL)).toBe(1);
    expect(viewUnread(counts, { kind: "userLabel", labelId: 13 }, ALL)).toBe(4);
  });

  it("counts only where unread is actionable: Inbox and labels, not Starred", () => {
    expect(viewUnread(counts, system("inbox"), ALL)).toBe(5);
    expect(viewUnread(counts, system("starred"), ALL)).toBe(0);
    expect(viewUnread(counts, system("unread"), ALL)).toBe(0);
    expect(viewUnread(counts, system("sent"), ALL)).toBe(0);
    expect(viewUnread(counts, { kind: "archive" }, ALL)).toBe(0);
  });

  it("counts saved drafts, per account or all together", () => {
    expect(viewUnread(counts, system("draft"), ALL)).toBe(3);
    expect(viewUnread(counts, system("draft"), { kind: "only", ids: [2] })).toBe(1);
  });

  it("formats counts quietly", () => {
    expect(countText(0)).toBeNull();
    expect(countText(12)).toBe("12");
    expect(countText(1200)).toBe("999+");
  });
});
