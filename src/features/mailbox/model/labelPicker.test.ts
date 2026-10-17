import { describe, expect, it } from "vitest";
import type { Label } from "../../../platform/tauri/bindings";
import { filterLabels, newLabelName, pickerName } from "./labelPicker";

const label = (id: number, name: string): Label => ({
  id,
  accountId: 1,
  gmailLabelId: `Label_${id}`,
  name,
  kind: "user",
  colorBg: null,
  colorFg: null,
});

describe("label picker", () => {
  const labels = [label(1, "Work"), label(2, "Acme: Review"), label(3, "[Orbit]/Work notes")];

  it("names labels by their sidebar path", () => {
    expect(pickerName(labels[1]!)).toBe("Acme / Review");
    expect(pickerName(labels[2]!)).toBe("Orbit / Work notes");
  });

  it("filters by every typed word, sorted by name", () => {
    expect(filterLabels(labels, "").map((l) => l.id)).toEqual([2, 3, 1]);
    expect(filterLabels(labels, "work").map((l) => l.id)).toEqual([3, 1]);
    expect(filterLabels(labels, "notes WORK").map((l) => l.id)).toEqual([3]);
    expect(filterLabels(labels, "zzz")).toEqual([]);
  });
});

it("offers a new label only for a fresh, complete name", () => {
  const labels = [{ name: "Work" }, { name: "Work/Acme" }];
  expect(newLabelName(labels, " Travel ")).toBe("Travel");
  expect(newLabelName(labels, "work")).toBeNull();
  expect(newLabelName(labels, "Work / Beta")).toBe("Work/Beta");
  expect(newLabelName(labels, "Work/")).toBeNull();
  expect(newLabelName(labels, "  ")).toBeNull();
});
