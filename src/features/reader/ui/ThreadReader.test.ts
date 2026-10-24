import { describe, expect, it } from "vitest";
import { initiallyExpanded, unreadArrivals } from "./ThreadReader";

describe("unreadArrivals", () => {
  const seen = new Set([1, 2]);
  it("finds unread messages that weren't there before", () => {
    const messages = [
      { id: 1, unread: false, draft: false },
      { id: 2, unread: true, draft: false },
      { id: 3, unread: true, draft: false },
      { id: 4, unread: false, draft: false },
    ];
    // 2 was there already (marked unread by hand); 4 arrived read.
    expect(unreadArrivals(seen, messages)).toEqual([3]);
  });
  it("ignores drafts and unchanged conversations", () => {
    expect(unreadArrivals(seen, [{ id: 3, unread: true, draft: true }])).toEqual([]);
    expect(
      unreadArrivals(seen, [
        { id: 1, unread: true, draft: false },
        { id: 2, unread: true, draft: false },
      ]),
    ).toEqual([]);
  });
});

describe("initiallyExpanded", () => {
  it("opens unread messages and the newest one", () => {
    const messages = [
      { id: 1, unread: false, draft: false },
      { id: 2, unread: true, draft: false },
      { id: 3, unread: false, draft: false },
      { id: 4, unread: false, draft: false },
    ];
    expect([...initiallyExpanded(messages)].toSorted()).toEqual([2, 4]);
  });
  it("opens the newest real message, not a draft reply after it", () => {
    const messages = [
      { id: 1, unread: false, draft: false },
      { id: 2, unread: false, draft: false },
      { id: 3, unread: false, draft: true },
    ];
    expect([...initiallyExpanded(messages)]).toEqual([2]);
    // A conversation that's only a draft opens it.
    expect([...initiallyExpanded([{ id: 5, unread: false, draft: true }])]).toEqual([5]);
  });
  it("handles empty threads", () => {
    expect(initiallyExpanded([]).size).toBe(0);
  });
});
