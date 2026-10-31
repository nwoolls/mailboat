import { describe, expect, it } from "vitest";
import { formatListDate, senderParts } from "./format";

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

const p = (name: string | null, email: string, unread = false) => ({ name, email, unread });

describe("senderParts", () => {
  it("uses the full name for a single sender", () => {
    const [only] = senderParts([p("Jane Doe", "jane@x.example")]);
    expect([only?.text, only?.unread]).toEqual(["Jane Doe", false]);
  });
  it("uses first names and 'me', and marks who has unread mail", () => {
    const parts = senderParts(
      [p("Jane Doe", "jane@x.example", true), p(null, "me@gmail.com")],
      ["ME@gmail.com"],
    );
    expect(parts.map(({ text, unread }) => ({ text, unread }))).toEqual([
      { text: "Jane", unread: true },
      { text: "me", unread: false },
    ]);
  });
  it("falls back to the address when there is no name", () => {
    expect(senderParts([p(null, "billing@vendor.example")])[0]?.text).toBe("billing");
  });
  it("elides long sender lists", () => {
    const s = ["A a", "B b", "C c", "D d"].map((n, i) => p(n, `${i}@x.example`, i === 3));
    expect(senderParts(s).map((x) => (x.unread ? `*${x.text}` : x.text))).toEqual([
      "A",
      "…",
      "C",
      "*D",
    ]);
  });
});
