import { describe, expect, it } from "vitest";
import { pageOf } from "./paging";

const list = Array.from({ length: 23 }, (_, i) => i + 1);

describe("rule pages", () => {
  it("cuts a list into pages", () => {
    expect(pageOf(list, 0)).toMatchObject({ page: 0, pages: 3, from: 1, to: 10, total: 23 });
    const last = pageOf(list, 2);
    expect(last.items).toEqual([21, 22, 23]);
    expect(last).toMatchObject({ from: 21, to: 23 });
  });

  it("shows the last page when the list shrank under the page", () => {
    expect(pageOf(list.slice(0, 12), 5)).toMatchObject({ page: 1, from: 11, to: 12 });
    expect(pageOf(list, -1).page).toBe(0);
  });

  it("has one empty page for no items", () => {
    expect(pageOf([], 3)).toMatchObject({ items: [], page: 0, pages: 1, from: 0, to: 0 });
  });
});
