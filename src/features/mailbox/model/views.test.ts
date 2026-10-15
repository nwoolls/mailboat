import { describe, expect, it } from "vitest";
import type { Account, Label } from "../../../platform/tauri/bindings";
import {
  ALL_INBOXES,
  labelSelection,
  sameSelection,
  selectionKey,
  selectionTitle,
  spansAccounts,
  systemSelection,
  toListQuery,
} from "./views";

const accounts: Account[] = [
  {
    id: 1,
    email: "me@gmail.com",
    displayName: null,
    avatarUrl: null,
    color: "#5b8def",
    oauthClient: "default",
  },
  {
    id: 2,
    email: "me@example.com",
    displayName: null,
    avatarUrl: null,
    color: "#e0795b",
    oauthClient: "default",
  },
];
const work = (id: number, accountId: number): Label => ({
  id,
  accountId,
  gmailLabelId: "Label_1",
  name: "Work",
  kind: "user",
  colorBg: null,
  colorFg: null,
});

describe("selections", () => {
  it("All Inboxes is the inbox query over every account", () => {
    expect(toListQuery(ALL_INBOXES)).toEqual({
      accounts: { kind: "all" },
      view: { kind: "system", label: "inbox" },
      cursor: null,
      limit: 100,
    });
  });

  it("a single-account view is the same query filtered to one account", () => {
    expect(toListQuery(systemSelection("inbox", 2)).accounts).toEqual({ kind: "only", ids: [2] });
    expect(toListQuery(systemSelection("inbox", 2)).view).toEqual(toListQuery(ALL_INBOXES).view);
  });

  it("user labels with the same name in two accounts stay separate selections", () => {
    const a = labelSelection(work(10, 1));
    const b = labelSelection(work(20, 2));
    expect(a.accounts).toEqual({ kind: "only", ids: [1] });
    expect(sameSelection(a, b)).toBe(false);
  });

  it("keys ignore account order", () => {
    const x = { accounts: { kind: "only" as const, ids: [2, 1] }, view: ALL_INBOXES.view };
    const y = { accounts: { kind: "only" as const, ids: [1, 2] }, view: ALL_INBOXES.view };
    expect(selectionKey(x)).toBe(selectionKey(y));
  });

  it("only marks rows with their account when the view can mix accounts", () => {
    expect(spansAccounts(ALL_INBOXES, 1)).toBe(false);
    expect(spansAccounts(ALL_INBOXES, 2)).toBe(true);
    expect(spansAccounts(systemSelection("inbox", 1), 2)).toBe(false);
  });

  it("titles", () => {
    expect(selectionTitle(ALL_INBOXES, accounts, [])).toBe("All Inboxes");
    expect(selectionTitle(systemSelection("sent", 2), accounts, [])).toBe("Sent — me@example.com");
    expect(selectionTitle(labelSelection(work(10, 1)), accounts, [work(10, 1)])).toBe("Work");
  });
});
