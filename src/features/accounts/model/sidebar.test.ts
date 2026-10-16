import { describe, expect, it } from "vitest";
import type { LabelUnread } from "../../../platform/tauri/bindings";
import { countText, unreadIn, viewUnread } from "./sidebar";

const counts: LabelUnread[] = [
  { labelId: 1, accountId: 1, gmailLabelId: "INBOX", unread: 2 },
  { labelId: 2, accountId: 1, gmailLabelId: "UNREAD", unread: 5 },
  { labelId: 3, accountId: 1, gmailLabelId: "Label_1", unread: 1 },
  { labelId: 11, accountId: 2, gmailLabelId: "INBOX", unread: 3 },
  { labelId: 13, accountId: 2, gmailLabelId: "Label_1", unread: 4 },
];

describe("unread counts", () => {
  it("sums Inbox over all accounts, or just the chosen ones", () => {
    expect(unreadIn(counts, "INBOX", { kind: "all" })).toBe(5);
    expect(unreadIn(counts, "INBOX", { kind: "only", ids: [2] })).toBe(3);
  });

  it("keeps same-ID user labels apart (they belong to one account each)", () => {
    expect(viewUnread(counts, { kind: "userLabel", labelId: 3 }, { kind: "all" })).toBe(1);
    expect(viewUnread(counts, { kind: "userLabel", labelId: 13 }, { kind: "all" })).toBe(4);
  });

  it("shows nothing for views where a count is noise", () => {
    expect(viewUnread(counts, { kind: "system", label: "sent" }, { kind: "all" })).toBe(0);
    expect(viewUnread(counts, { kind: "archive" }, { kind: "all" })).toBe(0);
  });

  it("formats counts quietly", () => {
    expect(countText(0)).toBeNull();
    expect(countText(12)).toBe("12");
    expect(countText(1200)).toBe("999+");
  });
});
