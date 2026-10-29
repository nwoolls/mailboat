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
      return {
        tone: "warn",
        label:
          state.errorKind === "rate_limited"
            ? "Google asked to slow down — continuing shortly"
            : "Retrying soon",
      };
    case "authError":
      return { tone: "error", label: "Google signed you out · sign in again" };
    case "error":
      return { tone: "error", label: state.errorMessage ?? "Sync error" };
  }
}

/** Hover text for the account avatar: the badge, plus when it last synced. */
export function syncHint(state: AccountSyncState | undefined, locale?: string): string {
  const badge = syncBadge(state);
  if (badge.tone !== "ok" || !state?.lastSyncAt) return badge.label;
  const when = new Date(state.lastSyncAt).toLocaleString(locale, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${badge.label} · last synced ${when}`;
}

/**
 * The most serious problem across accounts, for the dot on the sidebar
 * toggle when the sidebar is hidden. Routine syncing isn't a problem.
 */
export function syncAttention(states: AccountSyncState[]): "warn" | "error" | null {
  const tones = new Set(states.map((s) => syncBadge(s).tone));
  if (tones.has("error")) return "error";
  if (tones.has("warn")) return "warn";
  return null;
}

/** Merges a status event into the cached list (one entry per account). */
export function upsertSyncState(
  list: AccountSyncState[],
  next: AccountSyncState,
): AccountSyncState[] {
  const rest = list.filter((s) => s.accountId !== next.accountId);
  return [...rest, next].toSorted((a, b) => a.accountId - b.accountId);
}
