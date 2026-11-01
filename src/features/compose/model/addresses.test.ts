import { describe, expect, it } from "vitest";
import {
  formatAddress,
  isValidEmail,
  moveAddress,
  parseAddresses,
  uniqueAddresses,
} from "./addresses";

describe("isValidEmail", () => {
  it("accepts ordinary addresses", () => {
    expect(isValidEmail("a.b+c@mail.x.example")).toBe(true);
  });
  it("rejects anything that could break a header", () => {
    for (const bad of [
      "",
      "a",
      "@x.example",
      "a@",
      "a b@x.example",
      "a@x.example>",
      "a@b@c",
      "a\n@x",
    ])
      expect(isValidEmail(bad), bad).toBe(false);
  });
});

describe("parseAddresses", () => {
  it("splits on commas, semicolons and newlines outside quotes and brackets", () => {
    expect(
      parseAddresses('a@x.example, "Doe, Jane" <jane@y.example>; Bob <bob@z.example>\nc@w.example'),
    ).toEqual([
      { name: null, email: "a@x.example" },
      { name: "Doe, Jane", email: "jane@y.example" },
      { name: "Bob", email: "bob@z.example" },
      { name: null, email: "c@w.example" },
    ]);
  });
  it("keeps invalid pieces so the field can flag them", () => {
    expect(parseAddresses("bob, ,a@x.example")).toEqual([
      { name: null, email: "bob" },
      { name: null, email: "a@x.example" },
    ]);
  });
});

describe("uniqueAddresses", () => {
  it("drops repeats (any case) and excluded emails", () => {
    const list = [
      { name: "A", email: "a@x.example" },
      { name: null, email: "A@X.example" },
      { name: null, email: "me@x.example" },
    ];
    expect(uniqueAddresses(list, ["ME@x.example"])).toEqual([{ name: "A", email: "a@x.example" }]);
  });
});

it("formats with or without a name", () => {
  expect(formatAddress({ name: "Jo", email: "jo@x.example" })).toBe("Jo <jo@x.example>");
  expect(formatAddress({ name: null, email: "jo@x.example" })).toBe("jo@x.example");
});

describe("moveAddress", () => {
  const bob = { name: "Bob", email: "bob@z.example" };
  const carol = { name: null, email: "carol@z.example" };
  const lines = { to: [bob, carol], cc: [], bcc: [], subject: "kept" };

  it("moves the address, name and all, to the end of the other line", () => {
    const moved = moveAddress({ ...lines, cc: [carol] }, bob, "to", "cc");
    expect(moved).toEqual({ to: [carol], cc: [carol, bob], bcc: [], subject: "kept" });
  });
  it("never copies: an address already there just leaves the first line", () => {
    const moved = moveAddress(
      { ...lines, bcc: [{ name: null, email: "BOB@z.example" }] },
      bob,
      "to",
      "bcc",
    );
    expect(moved.to).toEqual([carol]);
    expect(moved.bcc).toEqual([{ name: null, email: "BOB@z.example" }]);
  });
  it("dropping on the same line changes nothing", () => {
    expect(moveAddress(lines, bob, "to", "to")).toBe(lines);
  });
});
