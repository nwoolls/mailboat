import type { Account, AccountId, AccountSyncState } from "../../../platform/tauri/bindings";

/**
 * What the notice says after the headline. It gives no reason: Google's
 * `invalid_grant` is the same whether the seven-day limit of a project in
 * Testing ended the sign-in, it was revoked, or a password changed.
 */
export const SIGNED_OUT_NEXT = "Sign in again to keep this account's mail up to date.";

/** The accounts Google has signed out, in account order. */
export function signedOut(accounts: Account[], states: AccountSyncState[]): Account[] {
  const out = new Set(states.filter((s) => s.status === "authError").map((s) => s.accountId));
  return accounts.filter((a) => out.has(a.id));
}

/**
 * The signed-out accounts still to tell about. A dismissal lasts until the
 * account signs in again (or the app is quit: it's only remembered in the
 * window, so the notice returns at the next launch).
 */
export function unseen(out: Account[], dismissed: ReadonlySet<AccountId>): Account[] {
  return out.filter((a) => !dismissed.has(a.id));
}

/**
 * The dismissals that still apply. Only an account that is back (a whole
 * pass worked) or gone is forgotten: a retry shows it syncing, then signed
 * out again, and that is the same sign-out.
 */
export function stillDismissed(
  accounts: Account[],
  states: AccountSyncState[],
  dismissed: ReadonlySet<AccountId>,
): ReadonlySet<AccountId> {
  const back = new Set(states.filter((s) => s.status === "idle").map((s) => s.accountId));
  const exists = new Set(accounts.map((a) => a.id));
  const kept = [...dismissed].filter((id) => exists.has(id) && !back.has(id));
  return kept.length === dismissed.size ? dismissed : new Set(kept);
}
