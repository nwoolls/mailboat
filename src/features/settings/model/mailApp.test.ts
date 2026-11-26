import { describe, expect, it } from "vitest";
import { defaultMailAppRow } from "./mailApp";
import { APP_NAME } from "../../../shared/lib/brand";

describe("defaultMailAppRow", () => {
  it(`offers no button when ${APP_NAME} is already the default`, () => {
    expect(defaultMailAppRow({ kind: "this" }).action).toBeUndefined();
  });

  it("names the app that opens email links today", () => {
    const row = defaultMailAppRow({ kind: "other", name: "Mail" }, "mac");
    expect(row.description).toBe("Mail opens email links.");
    expect(row.action).toBe(`Make ${APP_NAME} the default`);
  });

  it("sends Windows users to Windows Settings, which picks the default", () => {
    const row = defaultMailAppRow({ kind: "other", name: "Outlook" }, "windows");
    expect(row.action).toBe("Choose in Windows Settings");
    // A build run without its installer isn't registered: nothing to pick.
    expect(defaultMailAppRow({ kind: "notInstalled" }, "windows").action).toBeUndefined();
  });

  it("says which copy gets links, with no button that couldn't change it", () => {
    const row = defaultMailAppRow({ kind: "otherCopy", path: "/Applications/App.app" }, "mac");
    expect(row.description).toContain("/Applications/App.app");
    expect(row.action).toBeUndefined();
  });

  it("lets Linux set the default from here, as the Mac does", () => {
    const row = defaultMailAppRow({ kind: "other", name: "Mail Reader" }, "linux");
    expect(row.description).toBe("Mail Reader opens email links.");
    expect(row.action).toBe(`Make ${APP_NAME} the default`);
    // An AppImage has no desktop entry to choose.
    expect(defaultMailAppRow({ kind: "notInstalled" }, "linux").action).toBeUndefined();
  });
});
