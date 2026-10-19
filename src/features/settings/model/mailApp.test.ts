import { describe, expect, it } from "vitest";
import { defaultMailAppRow } from "./mailApp";

describe("defaultMailAppRow", () => {
  it("offers no button when Mailboat is already the default", () => {
    expect(defaultMailAppRow({ kind: "this" }).action).toBeUndefined();
  });

  it("names the app that opens email links today", () => {
    const row = defaultMailAppRow({ kind: "other", name: "Mail" });
    expect(row.description).toBe("Mail opens email links.");
    expect(row.action).toBe("Make Mailboat the default");
  });

  it("says which copy gets links, with no button that couldn't change it", () => {
    const row = defaultMailAppRow({ kind: "otherCopy", path: "/Applications/Mailboat.app" });
    expect(row.description).toContain("/Applications/Mailboat.app");
    expect(row.action).toBeUndefined();
  });
});
