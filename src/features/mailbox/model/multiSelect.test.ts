import { describe, expect, it } from "vitest";
import {
  actionTargets,
  menuTargets,
  NONE,
  prune,
  rangeChecked,
  toggleChecked,
} from "./multiSelect";

const list = [1, 2, 3, 4, 5].map((id) => ({ id }));

describe("multi-select", () => {
  it("the first ⌘-click also picks the open conversation", () => {
    expect([...toggleChecked(NONE, 2, 4)]).toEqual([2, 4]);
    expect([...toggleChecked(new Set([2, 4]), 2, 4)]).toEqual([2]);
    expect([...toggleChecked(NONE, null, 4)]).toEqual([4]);
    // ⌘-clicking the open one on its own just picks it.
    expect([...toggleChecked(NONE, 2, 2)]).toEqual([2]);
  });

  it("⇧-click picks the range from the open conversation, either direction", () => {
    expect([...rangeChecked(list, NONE, 2, 4)].toSorted()).toEqual([2, 3, 4]);
    expect([...rangeChecked(list, NONE, 4, 2)].toSorted()).toEqual([2, 3, 4]);
    expect([...rangeChecked(list, new Set([5]), 1, 2)].toSorted()).toEqual([1, 2, 5]);
    expect([...rangeChecked(list, NONE, null, 3)]).toEqual([3]);
  });

  it("actions apply to the picks, else the open conversation", () => {
    expect(actionTargets(list, new Set([3, 1]), 5).map((t) => t.id)).toEqual([1, 3]);
    expect(actionTargets(list, NONE, 5).map((t) => t.id)).toEqual([5]);
    expect(actionTargets(list, NONE, null)).toEqual([]);
  });

  it("forgets picks that left the list", () => {
    const checked = new Set([1, 9]);
    expect([...prune(checked, list)]).toEqual([1]);
    const same = new Set([1, 2]);
    expect(prune(same, list)).toBe(same);
  });
});

it("a right-click menu acts on the clicked row, or all picks if it's one", () => {
  const rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
  expect(menuTargets(rows, new Set([1, 3]), 3).map((t) => t.id)).toEqual([1, 3]);
  expect(menuTargets(rows, new Set([1, 3]), 2).map((t) => t.id)).toEqual([2]);
  expect(menuTargets(rows, new Set(), 9)).toEqual([]);
});
