import { describe, expect, it } from "vitest";
import { formatListDate, sendersLabel } from "./format";

describe("formatListDate", () => {
  const now = new Date(2026, 9, 14, 15, 0);
  it("shows the time for today", () => {
    expect(formatListDate(new Date(2026, 9, 14, 9, 5).getTime(), now, "en-US")).toBe("9:05 AM");
  });
  it("shows month and day earlier this year", () => {
    expect(formatListDate(new Date(2026, 1, 3).getTime(), now, "en-US")).toBe("Feb 3");
  });
  it("shows a short date for older mail", () => {
    expect(formatListDate(new Date(2024, 9, 9).getTime(), now, "en-US")).toBe("10/9/24");
  });
});

describe("sendersLabel", () => {
  it("uses the full name for a single sender", () => {
    expect(sendersLabel([{ name: "Jane Doe", email: "jane@x.com" }], 1)).toBe("Jane Doe");
  });
  it("uses first names, 'me' and a count for conversations", () => {
    const senders = [
      { name: "Jane Doe", email: "jane@x.com" },
      { name: null, email: "me@gmail.com" },
    ];
    expect(sendersLabel(senders, 3, ["ME@gmail.com"])).toBe("Jane, me (3)");
  });
  it("falls back to the address when there is no name", () => {
    expect(sendersLabel([{ name: null, email: "billing@vendor.com" }], 1)).toBe("billing");
  });
  it("elides long sender lists", () => {
    const s = ["A a", "B b", "C c", "D d"].map((n, i) => ({ name: n, email: `${i}@x.com` }));
    expect(sendersLabel(s, 4)).toBe("A, …, C, D (4)");
  });
});
