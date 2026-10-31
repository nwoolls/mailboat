import { describe, expect, it } from "vitest";
import { newDraft } from "./draft";
import { draftFromMailto } from "./mailto";

const blank = () => newDraft([], 1, "me@x.example");

describe("draftFromMailto", () => {
  it("fills in every field and shows Cc and Bcc when they have someone", () => {
    const d = draftFromMailto(blank(), {
      to: ['"Doe, Jane" <jane@x.example>', "bob@x.example"],
      cc: ["cat@x.example"],
      bcc: [],
      subject: "Hello",
      body: "Line 1\nLine 2\n\nNext <paragraph>",
    });
    expect(d.to).toEqual([
      { name: "Doe, Jane", email: "jane@x.example" },
      { name: null, email: "bob@x.example" },
    ]);
    expect(d.cc).toEqual([{ name: null, email: "cat@x.example" }]);
    expect(d.showCc).toBe(true);
    expect(d.showBcc).toBe(false);
    expect(d.subject).toBe("Hello");
    expect(d.html).toBe("<p>Line 1<br>Line 2</p><p>Next &lt;paragraph&gt;</p>");
    expect(d.text).toContain("Next <paragraph>");
    expect(d.from.email).toBe("me@x.example");
  });

  it("an empty link is a blank message", () => {
    const d = draftFromMailto(blank(), { to: [], cc: [], bcc: [], subject: "", body: "" });
    expect(d.to).toEqual([]);
    expect(d.html).toBe("");
  });
});
