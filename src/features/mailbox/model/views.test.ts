import { describe, expect, it } from "vitest";
import type { Account, Label } from "../../../platform/tauri/bindings";
import {
  ACCOUNT_VIEWS,
  ALL_INBOXES,
  UNIFIED_VIEWS,
  viewSelection,
  viewTitle,
  labelSelection,
  sameSelection,
  staysOnFolderClick,
  selectionKey,
  selectionNeedsAccount,
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
    missingPermissions: [],
  },
  {
    id: 2,
    email: "me@work.example.com",
    displayName: null,
    avatarUrl: null,
    color: "#e0795b",
    oauthClient: "default",
    missingPermissions: [],
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
  it("the shared Inbox is the inbox query over every account", () => {
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
    expect(selectionTitle(ALL_INBOXES, accounts, [])).toBe("Inbox");
    expect(selectionTitle(systemSelection("sent", 2), accounts, [])).toBe(
      "Sent · me@work.example.com",
    );
    expect(selectionTitle(labelSelection(work(10, 1)), accounts, [work(10, 1)])).toBe("Work");
  });

  it("names the account only when there's more than one", () => {
    expect(selectionTitle(systemSelection("inbox", 1), accounts.slice(0, 1), [])).toBe("Inbox");
  });

  it("titles a search by what was searched", () => {
    const search = {
      accounts: { kind: "all" as const },
      view: { kind: "search" as const, text: "newsy" },
    };
    expect(selectionTitle(search, accounts, [])).toBe("Results for “newsy”");
  });

  it("All Mail and Archive are views like any other, per account or unified", () => {
    const archive = viewSelection({ kind: "archive" }, 2);
    expect(toListQuery(archive)).toMatchObject({
      accounts: { kind: "only", ids: [2] },
      view: { kind: "archive" },
    });
    expect(selectionTitle(archive, accounts, [])).toBe("Archive · me@work.example.com");
    expect(selectionTitle(viewSelection({ kind: "allMail" }), accounts, [])).toBe("All Mail");
    expect(sameSelection(archive, viewSelection({ kind: "allMail" }, 2))).toBe(false);
  });

  it("every sidebar view has a distinct key and a real title", () => {
    for (const views of [UNIFIED_VIEWS, ACCOUNT_VIEWS]) {
      const keys = views.map((v) => selectionKey(viewSelection(v, 1)));
      expect(new Set(keys).size).toBe(views.length);
      expect(views.every((v) => viewTitle(v) !== "Label")).toBe(true);
    }
  });
});

describe("selectionNeedsAccount", () => {
  const workLabel: Label = {
    id: 7,
    accountId: 2,
    gmailLabelId: "Label_1",
    name: "Work",
    kind: "user",
    colorBg: null,
    colorFg: null,
  };

  it("is true for the removed account's own views and labels", () => {
    expect(selectionNeedsAccount(systemSelection("inbox", 2), 2, [workLabel])).toBe(true);
    expect(selectionNeedsAccount(labelSelection(workLabel), 2, [workLabel])).toBe(true);
  });

  it("is false for unified views and other accounts", () => {
    expect(selectionNeedsAccount(ALL_INBOXES, 2, [workLabel])).toBe(false);
    expect(selectionNeedsAccount(systemSelection("inbox", 1), 2, [workLabel])).toBe(false);
    expect(
      selectionNeedsAccount(
        { accounts: { kind: "only", ids: [1, 2] }, view: { kind: "allMail" } },
        2,
        [workLabel],
      ),
    ).toBe(false);
  });
});

// Owner, 2026-11-12: clicking the folder you're in cleared the preview and
// the selection. Now it only clears a search (as the search box's clear
// button does) and leaves them, as in Apple Mail.
describe("staysOnFolderClick", () => {
  const archive = viewSelection({ kind: "archive" }, 2);
  it("stays on the folder already shown", () => {
    expect(staysOnFolderClick(archive, viewSelection({ kind: "archive" }, 2))).toBe(true);
  });
  it("goes to another folder, or another account's", () => {
    expect(staysOnFolderClick(archive, viewSelection({ kind: "allMail" }, 2))).toBe(false);
    expect(staysOnFolderClick(archive, viewSelection({ kind: "archive" }, 3))).toBe(false);
  });
});
