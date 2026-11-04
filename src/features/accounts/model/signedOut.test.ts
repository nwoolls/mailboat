import { describe, expect, it } from "vitest";
import type { Account, AccountId, AccountSyncState } from "../../../platform/tauri/bindings";
import { signedOut, stillDismissed, unseen } from "./signedOut";

const account = (id: number) => ({ id, email: `a${id}@x.example` }) as Account;
const state = (id: number, status: AccountSyncState["status"]) =>
  ({ accountId: id, status }) as AccountSyncState;

describe("signed-out accounts", () => {
  const accounts = [account(1), account(2), account(3)];
  const states = [state(1, "idle"), state(2, "authError"), state(3, "backoff")];

  it("are the ones in an auth error, not other trouble", () => {
    expect(signedOut(accounts, states).map((a) => a.id)).toEqual([2]);
  });

  it("are left out of the notice once dismissed", () => {
    const out = signedOut(accounts, states);
    expect(unseen(out, new Set<AccountId>()).map((a) => a.id)).toEqual([2]);
    expect(unseen(out, new Set<AccountId>([2 as AccountId]))).toEqual([]);
  });

  it("keep a dismissal across a retry, and forget it when the account is back", () => {
    const dismissed = new Set<AccountId>([2 as AccountId]);
    expect(stillDismissed(accounts, states, dismissed)).toBe(dismissed);
    // A retry: syncing, or failing some other way. The same sign-out.
    for (const status of ["syncing", "backoff", "error"] as const) {
      const retry = [state(1, "idle"), state(2, status), state(3, "idle")];
      expect(stillDismissed(accounts, retry, dismissed)).toBe(dismissed);
    }
    const back = [state(1, "idle"), state(2, "idle"), state(3, "idle")];
    expect(stillDismissed(accounts, back, dismissed).size).toBe(0);
  });

  it("forget a dismissal when the account is removed", () => {
    const dismissed = new Set<AccountId>([2 as AccountId]);
    expect(stillDismissed([account(1)], states, dismissed).size).toBe(0);
  });
});
