import { describe, expect, it } from "vitest";
import { defaultMailAppRow } from "./mailApp";
import { APP_NAME } from "../../../shared/lib/brand";

describe("defaultMailAppRow", () => {
  it(`offers no button when ${APP_NAME} is already the default`, () => {
    expect(defaultMailAppRow({ kind: "this" }).action).toBeUndefined();
  });

  it("names the app that opens email links today", () => {
    const row = defaultMailAppRow({ kind: "other", name: "Mail" }, true);
    expect(row.description).toBe("Mail opens email links.");
    expect(row.action).toBe(`Make ${APP_NAME} the default`);
  });

  it("sends Windows users to Windows Settings, which picks the default", () => {
    const row = defaultMailAppRow({ kind: "other", name: "Outlook" }, false);
    expect(row.action).toBe("Choose in Windows Settings");
    // A build run without its installer isn't registered: nothing to pick.
    expect(defaultMailAppRow({ kind: "notInstalled" }, false).action).toBeUndefined();
  });

  it("says which copy gets links, with no button that couldn't change it", () => {
    const row = defaultMailAppRow({ kind: "otherCopy", path: "/Applications/App.app" }, true);
    expect(row.description).toContain("/Applications/App.app");
    expect(row.action).toBeUndefined();
  });
});
