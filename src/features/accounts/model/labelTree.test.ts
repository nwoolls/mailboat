import { describe, expect, it } from "vitest";
import type { Label } from "../../../platform/tauri/bindings";
import { containsLabel, labelPath, labelTree } from "./labelTree";

let nextId = 1;
const label = (name: string): Label => ({
  id: nextId++,
  accountId: 1,
  gmailLabelId: `Label_${nextId}`,
  name,
  kind: "user",
  colorBg: null,
  colorFg: null,
});

describe("labelPath", () => {
  it("nests on slashes and groups on a 'Prefix: ' name", () => {
    expect(labelPath("Work/Clients")).toEqual(["Work", "Clients"]);
    expect(labelPath("Acme: Scam")).toEqual(["Acme", "Scam"]);
  });

  it("drops IMAP-style brackets", () => {
    expect(labelPath("[Gmail]/Trash/Sent")).toEqual(["Gmail", "Trash", "Sent"]);
    expect(labelPath("[Orbit]")).toEqual(["Orbit"]);
  });
});

describe("labelTree", () => {
  it("groups labels sharing a prefix, sorted by name", () => {
    const tree = labelTree([label("Notes"), label("Acme: Scam"), label("Acme: Review")]);
    expect(tree.map((n) => n.name)).toEqual(["Acme", "Notes"]);
    const acme = tree[0]!;
    expect(acme.label).toBeNull();
    expect(acme.children.map((n) => n.name)).toEqual(["Review", "Scam"]);
  });

  it("keeps a lone chain as one row", () => {
    const [node] = labelTree([label("[Gmail]/Trash/Sent")]);
    expect(node?.name).toBe("Gmail / Trash / Sent");
    expect(node?.label?.name).toBe("[Gmail]/Trash/Sent");
    expect(node?.children).toEqual([]);
  });

  it("lets a label also be a group", () => {
    const [work] = labelTree([label("Work"), label("Work/A"), label("Work/B")]);
    expect(work?.label?.name).toBe("Work");
    expect(work?.children.map((n) => n.name)).toEqual(["A", "B"]);
  });

  it("finds a label inside a group", () => {
    const scam = label("Acme: Scam");
    const [acme] = labelTree([label("Acme: Review"), scam]);
    expect(containsLabel(acme!, scam.id)).toBe(true);
    expect(containsLabel(acme!, -1)).toBe(false);
  });
});
