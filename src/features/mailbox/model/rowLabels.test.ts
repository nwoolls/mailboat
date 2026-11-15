import { describe, expect, it } from "vitest";
import type { Label } from "../../../platform/tauri/bindings";
import { rowLabels } from "./rowLabels";

const label = (id: number, name: string, onConversations = true): Label => ({
  id,
  accountId: 1,
  gmailLabelId: `Label_${id}`,
  name,
  kind: "user",
  colorBg: null,
  colorFg: null,
  sidebar: "show",
  onConversations,
});

const byId = new Map(
  [
    label(1, "Travel"),
    label(2, "Clients"),
    label(3, "Receipts"),
    label(4, "Banking", false),
    label(5, "Archive me"),
  ].map((l) => [l.id, l]),
);
const names = (r: ReturnType<typeof rowLabels>) => [r.shown.map((l) => l.name), r.more];

describe("label chips on a row", () => {
  it("shows two, in name order, then counts the rest", () => {
    expect(names(rowLabels([1, 2, 3, 5], byId, null))).toEqual([["Archive me", "Clients"], 2]);
    expect(names(rowLabels([1], byId, null))).toEqual([["Travel"], 0]);
    expect(names(rowLabels([], byId, null))).toEqual([[], 0]);
  });

  it("leaves out the label being viewed and labels set not to show on conversations", () => {
    expect(names(rowLabels([1, 2, 4], byId, 2))).toEqual([["Travel"], 0]);
    // A label not (yet) known, e.g. from another account, is left out too.
    expect(names(rowLabels([1, 99], byId, null))).toEqual([["Travel"], 0]);
  });
});
