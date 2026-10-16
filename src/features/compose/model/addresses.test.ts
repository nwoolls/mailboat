import { describe, expect, it } from "vitest";
import { formatAddress, isValidEmail, parseAddresses, uniqueAddresses } from "./addresses";

describe("isValidEmail", () => {
  it("accepts ordinary addresses", () => {
    expect(isValidEmail("a.b+c@example.co.uk")).toBe(true);
  });
  it("rejects anything that could break a header", () => {
    for (const bad of ["", "a", "@x.com", "a@", "a b@x.com", "a@x.com>", "a@b@c", "a\n@x"])
      expect(isValidEmail(bad), bad).toBe(false);
  });
});

describe("parseAddresses", () => {
  it("splits on commas, semicolons and newlines outside quotes and brackets", () => {
    expect(parseAddresses('a@x.com, "Doe, Jane" <jane@y.com>; Bob <bob@z.com>\nc@w.com')).toEqual([
      { name: null, email: "a@x.com" },
      { name: "Doe, Jane", email: "jane@y.com" },
      { name: "Bob", email: "bob@z.com" },
      { name: null, email: "c@w.com" },
    ]);
  });
  it("keeps invalid pieces so the field can flag them", () => {
    expect(parseAddresses("bob, ,a@x.com")).toEqual([
      { name: null, email: "bob" },
      { name: null, email: "a@x.com" },
    ]);
  });
});

describe("uniqueAddresses", () => {
  it("drops repeats (any case) and excluded emails", () => {
    const list = [
      { name: "A", email: "a@x.com" },
      { name: null, email: "A@X.com" },
      { name: null, email: "me@x.com" },
    ];
    expect(uniqueAddresses(list, ["ME@x.com"])).toEqual([{ name: "A", email: "a@x.com" }]);
  });
});

it("formats with or without a name", () => {
  expect(formatAddress({ name: "Jo", email: "jo@x.com" })).toBe("Jo <jo@x.com>");
  expect(formatAddress({ name: null, email: "jo@x.com" })).toBe("jo@x.com");
});
