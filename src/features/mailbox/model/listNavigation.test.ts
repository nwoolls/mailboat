import { describe, expect, it } from "vitest";
import { moveKeyboard, moveSelection, navKeyFor } from "./listNavigation";

const threads = [{ id: 10 }, { id: 20 }, { id: 30 }];
const key = (k: string, mods: Partial<KeyboardEvent> = {}) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...mods,
});

describe("list navigation", () => {
  it("maps j/k and arrows, but not while typing or with modifiers", () => {
    expect(navKeyFor(key("j"), false)).toBe("next");
    expect(navKeyFor(key("ArrowUp"), false)).toBe("prev");
    expect(navKeyFor(key("j"), true)).toBeNull();
    expect(navKeyFor(key("k", { metaKey: true }), false)).toBeNull();
    expect(navKeyFor(key("x"), false)).toBeNull();
  });

  it("moves within bounds", () => {
    expect(moveSelection(threads, null, "next")).toBe(10);
    expect(moveSelection(threads, 10, "next")).toBe(20);
    expect(moveSelection(threads, 30, "next")).toBe(30);
    expect(moveSelection(threads, 10, "prev")).toBe(10);
    expect(moveSelection(threads, 20, "last")).toBe(30);
    expect(moveSelection([], 20, "next")).toBeNull();
  });

  it("restarts at the top if the selected thread left the list", () => {
    expect(moveSelection(threads, 99, "next")).toBe(10);
  });
});

describe("moveKeyboard", () => {
  const list = [{ id: 1 }, { id: 2 }, { id: 3 }];
  it("previews the next one while a preview shows", () => {
    expect(moveKeyboard(list, { previewed: 1, selected: null, previewing: true }, "next")).toEqual({
      previewed: 2,
      selected: null,
    });
  });
  it("only moves the selection without a preview", () => {
    // Nothing chosen yet: the first row is selected, not opened.
    expect(
      moveKeyboard(list, { previewed: null, selected: null, previewing: true }, "next"),
    ).toEqual({ previewed: null, selected: 1 });
    // Carries on from the selected row.
    expect(moveKeyboard(list, { previewed: null, selected: 2, previewing: true }, "next")).toEqual({
      previewed: null,
      selected: 3,
    });
    // The reader hidden with a conversation chosen: it moves on unopened.
    expect(moveKeyboard(list, { previewed: 2, selected: null, previewing: false }, "prev")).toEqual(
      { previewed: null, selected: 1 },
    );
  });
});
