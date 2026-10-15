import type { Account, AccountId, AccountSyncState } from "../../../platform/tauri/bindings";

export type AccountIndex = Map<AccountId, Account>;

export function indexAccounts(accounts: Account[]): AccountIndex {
  return new Map(accounts.map((a) => [a.id, a]));
}

/** Initial for the account avatar. */
export function accountInitial(a: Pick<Account, "email" | "displayName">): string {
  return (a.displayName?.trim() || a.email).charAt(0).toUpperCase();
}

export type SyncBadge = { tone: "ok" | "busy" | "warn" | "error"; label: string };

/** Short status text for an account's sync state. */
export function syncBadge(state: AccountSyncState | undefined): SyncBadge {
  switch (state?.status) {
    case undefined:
    case "idle":
      return { tone: "ok", label: "Up to date" };
    case "syncing":
      return { tone: "busy", label: "Syncing…" };
    case "backoff":
      return { tone: "warn", label: "Retrying soon" };
    case "authError":
      return { tone: "error", label: "Sign in again" };
    case "error":
      return { tone: "error", label: state.errorMessage ?? "Sync error" };
  }
}

/** Merges a status event into the cached list (one entry per account). */
export function upsertSyncState(
  list: AccountSyncState[],
  next: AccountSyncState,
): AccountSyncState[] {
  const rest = list.filter((s) => s.accountId !== next.accountId);
  return [...rest, next].toSorted((a, b) => a.accountId - b.accountId);
}
