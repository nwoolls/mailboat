import { describe, expect, it } from "vitest";
import { deleteAllNotice } from "./deleteAllNotice";

describe("deleteAllNotice", () => {
  it("says nothing when Google ended every sign-in", () => {
    expect(deleteAllNotice(true)).toBeNull();
  });

  it("points to the Google Account page when one couldn't be ended", () => {
    expect(deleteAllNotice(false)).toContain("myaccount.google.com/permissions");
  });
});
