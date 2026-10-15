import { describe, expect, it } from "vitest";
import type { AccountSyncState } from "../../../platform/tauri/bindings";
import { accountInitial, syncBadge, upsertSyncState } from "./accounts";

const state = (accountId: number, status: AccountSyncState["status"]): AccountSyncState => ({
  accountId,
  status,
  errorKind: null,
  errorMessage: null,
  lastSyncAt: null,
});

describe("accounts", () => {
  it("initials prefer the display name", () => {
    expect(accountInitial({ email: "me@gmail.com", displayName: "jordan" })).toBe("N");
    expect(accountInitial({ email: "work@example.com", displayName: null })).toBe("W");
  });

  it("an auth error asks the user to sign in again", () => {
    expect(syncBadge(state(1, "authError"))).toEqual({ tone: "error", label: "Sign in again" });
    expect(syncBadge(undefined).tone).toBe("ok");
  });

  it("status events replace only their own account's entry", () => {
    const list = [state(1, "idle"), state(2, "idle")];
    const next = upsertSyncState(list, state(2, "authError"));
    expect(next.map((s) => s.status)).toEqual(["idle", "authError"]);
  });
});
