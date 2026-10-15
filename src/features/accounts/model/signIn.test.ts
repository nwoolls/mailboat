import { describe, expect, it } from "vitest";
import { IpcError } from "../../../platform/tauri/ipc";
import { signInErrorMessage } from "./signIn";

describe("signInErrorMessage", () => {
  it("stays quiet when the user cancelled", () => {
    expect(
      signInErrorMessage(new IpcError({ kind: "cancelled", message: "cancelled" })),
    ).toBeNull();
    expect(signInErrorMessage(null)).toBeNull();
  });
  it("shows real failures", () => {
    expect(signInErrorMessage(new IpcError({ kind: "auth", message: "sign-in timed out" }))).toBe(
      "sign-in timed out",
    );
  });
});
