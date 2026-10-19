import { describe, expect, it } from "vitest";
import { newDraft } from "./draft";
import { draftFromMailto } from "./mailto";

const blank = () => newDraft([], 1, "me@x.com");

describe("draftFromMailto", () => {
  it("fills in every field and shows Cc and Bcc when they have someone", () => {
    const d = draftFromMailto(blank(), {
      to: ['"Doe, Jane" <jane@x.com>', "bob@x.com"],
      cc: ["cat@x.com"],
      bcc: [],
      subject: "Hello",
      body: "Line 1\nLine 2\n\nNext <paragraph>",
    });
    expect(d.to).toEqual([
      { name: "Doe, Jane", email: "jane@x.com" },
      { name: null, email: "bob@x.com" },
    ]);
    expect(d.cc).toEqual([{ name: null, email: "cat@x.com" }]);
    expect(d.showCc).toBe(true);
    expect(d.showBcc).toBe(false);
    expect(d.subject).toBe("Hello");
    expect(d.html).toBe("<p>Line 1<br>Line 2</p><p>Next &lt;paragraph&gt;</p>");
    expect(d.text).toContain("Next <paragraph>");
    expect(d.from.email).toBe("me@x.com");
  });

  it("an empty link is a blank message", () => {
    const d = draftFromMailto(blank(), { to: [], cc: [], bcc: [], subject: "", body: "" });
    expect(d.to).toEqual([]);
    expect(d.html).toBe("");
  });
});
