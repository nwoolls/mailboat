import { describe, expect, it } from "vitest";
import { signInAgainReason } from "./permissions";
import { APP_NAME } from "../../../shared/lib/brand";

describe("signInAgainReason", () => {
  it("says nothing when the sign-in covers everything", () => {
    expect(signInAgainReason([])).toBeNull();
  });

  it("names what's missing", () => {
    expect(signInAgainReason(["calendar"])).toBe(
      `Sign in again so ${APP_NAME} can answer meeting invitations.`,
    );
    expect(signInAgainReason(["contacts", "calendar", "gmailSettings"])).toBe(
      `Sign in again so ${APP_NAME} can suggest addresses from Google Contacts, answer meeting invitations and manage rules and signatures.`,
    );
  });
});
