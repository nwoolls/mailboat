import { describe, expect, it } from "vitest";
import { nextOpened, readButtonShowsUnread } from "./readButton";

describe("the read button's envelope", () => {
  it("follows what it will do", () => {
    expect(readButtonShowsUnread({ marksUnread: true, opening: false, markRead: "open" })).toBe(
      true,
    );
    expect(readButtonShowsUnread({ marksUnread: false, opening: false, markRead: "open" })).toBe(
      false,
    );
  });

  it("shows Mark as unread for an unread conversation that opening marks read", () => {
    expect(readButtonShowsUnread({ marksUnread: false, opening: true, markRead: "open" })).toBe(
      true,
    );
    // Read later, or never: it is still unread, so Mark as read.
    expect(readButtonShowsUnread({ marksUnread: false, opening: true, markRead: "delay" })).toBe(
      false,
    );
    expect(readButtonShowsUnread({ marksUnread: false, opening: true, markRead: "never" })).toBe(
      false,
    );
  });
});

describe("the conversation opened while unread", () => {
  const rows = [
    { id: 1, unread: true },
    { id: 2, unread: false },
  ];

  it("is decided from its row when opened", () => {
    expect(nextOpened(null, 1, rows)).toEqual({ id: 1, unread: true });
    expect(nextOpened({ id: 1, unread: true }, 2, rows)).toEqual({ id: 2, unread: false });
  });

  it("waits for a row not in the list yet (opened from a notification), then keeps it", () => {
    const waiting = nextOpened(null, 3, rows);
    expect(waiting).toEqual({ id: 3, unread: null });
    expect(nextOpened(waiting, null, rows)).toBe(waiting);
    const decided = nextOpened(waiting, null, [...rows, { id: 3, unread: true }]);
    expect(decided).toEqual({ id: 3, unread: true });
    // Marked read since: still the one opened while unread.
    expect(nextOpened(decided, null, [{ id: 3, unread: false }])).toBe(decided);
  });
});
