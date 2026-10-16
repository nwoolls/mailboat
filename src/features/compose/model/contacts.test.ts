import { expect, it } from "vitest";
import { contactMatches, matchContacts } from "./contacts";

const jane = { name: "Jane Doe", email: "jd@acme.com", wrote: true };
const sam = { name: null, email: "sam@x.com", wrote: false };

it("matches address, name words and domain starts, not word middles", () => {
  expect(contactMatches(jane, "doe")).toBe(true);
  expect(contactMatches(jane, "ACME")).toBe(true);
  expect(contactMatches(jane, "jd")).toBe(true);
  expect(contactMatches(jane, "jane d")).toBe(true);
  expect(contactMatches(jane, "oe")).toBe(false);
  expect(contactMatches(jane, "  ")).toBe(false);
  expect(contactMatches(sam, "%")).toBe(false);
});

it("keeps Rust's ranking and stops at the limit", () => {
  const list = [jane, sam, { ...sam, email: "sally@x.com" }];
  expect(matchContacts(list, "s", 1)).toEqual([sam]);
  expect(matchContacts(list, "x.com").map((c) => c.email)).toEqual(["sam@x.com", "sally@x.com"]);
});
