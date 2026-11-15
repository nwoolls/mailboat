import { describe, expect, it } from "vitest";
import { readButtonShowsUnread } from "./readButton";

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
