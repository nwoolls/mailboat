import { expect, it } from "vitest";
import { contactMatches, matchContacts } from "./contacts";

const jane = { name: "Jane Doe", email: "jd@acme.example", wrote: true };
const sam = { name: null, email: "sam@x.example", wrote: false };

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
  const list = [jane, sam, { ...sam, email: "sally@x.example" }];
  expect(matchContacts(list, "s", 1)).toEqual([sam]);
  expect(matchContacts(list, "x.example").map((c) => c.email)).toEqual([
    "sam@x.example",
    "sally@x.example",
  ]);
});
