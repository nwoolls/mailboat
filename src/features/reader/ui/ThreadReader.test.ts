import { describe, expect, it } from "vitest";
import { initiallyExpanded } from "./ThreadReader";

describe("initiallyExpanded", () => {
  it("opens unread messages and the newest one", () => {
    const messages = [
      { id: 1, unread: false },
      { id: 2, unread: true },
      { id: 3, unread: false },
      { id: 4, unread: false },
    ];
    expect([...initiallyExpanded(messages)].toSorted()).toEqual([2, 4]);
  });
  it("handles empty threads", () => {
    expect(initiallyExpanded([]).size).toBe(0);
  });
});
