import { describe, expect, it } from "vitest";
import {
  findDenylistInPassage,
  findIssues,
  findPassageIssues,
  joinLines,
  parseDenylist,
} from "./privacy";

const kinds = (text: string, deny: string[] = []) => findIssues(text, deny).map((f) => f.kind);

describe("findIssues", () => {
  it("lets reserved domains and placeholders through", () => {
    expect(kinds("ann@x.example, bob@work.example.com, me@gmail.com, a@example.com")).toEqual([]);
    expect(findIssues("contact@project.app", [], ["project.app"])).toEqual([]);
    expect(kinds("Co-author noreply@anthropic.com, bot 1+x@users.noreply.github.com")).toEqual([]);
  });

  it("flags an address at a real domain, or a stranger's Gmail address", () => {
    expect(kinds("write to jane@company.com")).toEqual(["email address"]);
    expect(kinds("jane.doe@gmail.com")).toEqual(["email address"]);
  });

  it("flags phone numbers except fictional 555 ones", () => {
    expect(kinds("call (212) 867-5309")).toEqual(["phone number"]);
    expect(kinds("call 1-800-555-0142 or 555-0100")).toEqual([]);
  });

  it("flags a phone number written without separators, when it reads as a phone number", () => {
    expect(kinds("call 2128675309 today")).toEqual(["phone number"]);
    expect(kinds("const MAX = 4294967296")).toEqual([]);
    expect(kinds("call 2125550123")).toEqual([]);
  });

  it("flags measurements of a real mailbox", () => {
    expect(kinds("Of the 23,000 cached HTML emails, most adapt")).toEqual([
      "real-mailbox measurement",
    ]);
    expect(kinds("about 3% of messages still need it")).toEqual(["real-mailbox measurement"]);
    expect(kinds("5 matches in 40 ms on the real cache")).toEqual(["real-mailbox measurement"]);
    expect(kinds("a small share of cached HTML emails")).toEqual([]);
  });

  it("flags terms from the local denylist, whatever the case", () => {
    expect(kinds("an email from Acme Corp", ["acme corp"])).toEqual(["denylisted term"]);
    expect(kinds("nothing here", ["acme corp"])).toEqual([]);
  });

  it("lets a line opt out, only with a reason", () => {
    expect(kinds("jane@company.com // privacy-ok: documentation example")).toEqual([]);
    expect(kinds("jane@company.com // privacy-ok")).toEqual(["email address"]);
  });

  it("only trusts reserved domains, not look-alikes or other real tools", () => {
    expect(kinds("a@example.co.uk")).toEqual(["email address"]);
    expect(kinds("a@notexample.com")).toEqual(["email address"]);
    expect(kinds("someone@google.com, x@github.com, y@anthropic.com")).toEqual([
      "email address",
      "email address",
      "email address",
    ]);
    expect(kinds("a@b.example, c@d.invalid, e@f.test, g@example.org")).toEqual([]);
  });
});

describe("findPassageIssues", () => {
  it("flags a count of emails or boxes in a passage about what was observed", () => {
    expect(
      findPassageIssues("Checked by rendering nine newsletters in dark mode").map((f) => f.kind),
    ).toEqual(["count of real mail"]);
    expect(
      findPassageIssues("a screenshot showed four white boxes\n left out").map((f) => f.kind),
    ).toEqual(["count of real mail"]);
    expect(findPassageIssues("the owner saw a few hundred emails changed").length).toBe(1);
  });

  it("leaves ordinary prose alone", () => {
    expect(findPassageIssues("two emails in a thread are shown newest first")).toEqual([]);
    expect(findPassageIssues("Checked by rendering several newsletters")).toEqual([]);
  });
});

describe("passages across a line wrap", () => {
  it("joins lines and drops comment and list markers", () => {
    expect(joinLines(["// Acme", "// Corp wrote", "- this"])).toBe("Acme Corp wrote this");
  });

  it("finds a multiword denylisted name split by a wrap", () => {
    expect(
      findDenylistInPassage(joinLines(["from Acme", "Corp today"]), ["acme corp"]),
    ).toHaveLength(1);
  });
});

describe("parseDenylist", () => {
  it("skips comments and blank lines", () => {
    expect(parseDenylist("# names\nAcme\n\n  Beta Co  \n")).toEqual(["Acme", "Beta Co"]);
  });
});
