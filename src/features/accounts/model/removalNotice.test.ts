import { describe, expect, it } from "vitest";
import { removalNotice } from "./removalNotice";

describe("removalNotice", () => {
  it("says nothing when Google ended the sign-in", () => {
    expect(removalNotice(true)).toBeNull();
  });

  it("points to the Google Account page when the sign-in couldn't be ended", () => {
    expect(removalNotice(false)).toContain("myaccount.google.com/permissions");
  });
});
