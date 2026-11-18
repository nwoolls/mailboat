import { describe, expect, it } from "vitest";
import type { OutsideRule } from "../../../platform/tauri/bindings";
import { isOutside, outsideBanner, outsideRecipients } from "./outside";

const work: OutsideRule = {
  workspace: true,
  domains: ["northwind.example", "offsite.example"],
  known: ["sam@x.example"],
};
const priya = { name: "Priya Raman", email: "priya@northwind.example" };
const jordan = { name: "Jordan Park", email: "jordan@x.example" };
const lee = { name: null, email: "lee@y.example" };

describe("who is outside, as Gmail decides", () => {
  it("marks addresses at none of the account's domains", () => {
    expect(isOutside(work, jordan.email)).toBe(true);
    expect(isOutside(work, priya.email)).toBe(false);
    expect(isOutside(work, "events@OFFSITE.example")).toBe(false);
  });

  it("never marks someone in Contacts or Other contacts", () => {
    expect(isOutside(work, "Sam@X.example")).toBe(false);
  });

  it("counts a subdomain as another domain, as Gmail does", () => {
    expect(isOutside(work, "ana@eu.northwind.example")).toBe(true);
  });

  it("marks nothing for a personal account, no rule yet, or an invalid address", () => {
    expect(isOutside({ ...work, workspace: false }, jordan.email)).toBe(false);
    expect(isOutside(undefined, jordan.email)).toBe(false);
    expect(isOutside(work, "jordan at x")).toBe(false);
  });

  it("lists each outside recipient once, in order", () => {
    expect(
      outsideRecipients(work, [priya, jordan, lee, { ...jordan, email: "JORDAN@x.example" }]),
    ).toEqual([jordan, lee]);
  });
});

describe("the banner", () => {
  const one = { ...work, domains: ["northwind.example"] };

  it("names one person and gives their address", () => {
    expect(outsideBanner(one, [jordan])).toEqual({
      title: "Jordan Park is outside your organization",
      detail: "jordan@x.example isn’t at northwind.example. Be careful sharing anything sensitive.",
    });
  });

  it("uses the address when there's no name", () => {
    expect(outsideBanner(one, [lee]).title).toBe("lee@y.example is outside your organization");
  });

  it("counts several and names them, then the rest", () => {
    expect(outsideBanner(one, [jordan, lee])).toEqual({
      title: "2 people are outside your organization",
      detail:
        "Jordan Park and lee@y.example aren’t at northwind.example. Be careful sharing anything sensitive.",
    });
    const five = ["a", "b", "c", "d", "e"].map((x) => ({ name: null, email: `${x}@y.example` }));
    expect(outsideBanner(one, five).detail).toMatch(
      /^a@y\.example, b@y\.example and 3 others aren’t/,
    );
  });

  it("mentions the aliases' domains when there are any", () => {
    expect(outsideBanner(work, [jordan]).detail).toContain(
      "isn’t at northwind.example or your aliases’ domains",
    );
  });
});
