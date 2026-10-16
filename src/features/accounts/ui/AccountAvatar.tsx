import { useEffect, useState } from "react";
import type { Account, AccountSyncState } from "../../../platform/tauri/bindings";
import { accountInitial, syncBadge, syncHint } from "../model/accounts";

/** Syncs shorter than this never show; the once-a-minute checks stay quiet. */
const SYNC_RING_DELAY_MS = 1500;

/**
 * The account's initial with its sync status on it: a thin spinning arc
 * during a long sync, an amber dot while retrying, a red dot on errors.
 * Hover for the status and when it last synced. Nothing shifts layout.
 */
export function AccountAvatar({
  account,
  state,
}: {
  account: Account;
  state: AccountSyncState | undefined;
}) {
  const tone = syncBadge(state).tone;
  const longSync = useTrueAfter(tone === "busy", SYNC_RING_DELAY_MS);
  return (
    <span
      className="relative flex h-4 w-4 shrink-0"
      title={syncHint(state)}
      role="img"
      aria-label={`${account.email}: ${syncHint(state)}`}
    >
      {/* Keyed by URL so a new picture gets a fresh try after a failure. */}
      <AccountPicture key={account.avatarUrl ?? ""} account={account} />
      {longSync && (
        <span className="sync-ring pointer-events-none absolute -inset-[3px] rounded-full border-[1.5px] border-content/10 border-t-accent" />
      )}
      {(tone === "warn" || tone === "error") && (
        <span
          className={`absolute -right-0.5 -bottom-0.5 h-2 w-2 rounded-full ring-[1.5px] ring-background-base ${
            tone === "error" ? "bg-danger" : "bg-warn"
          }`}
        />
      )}
    </span>
  );
}

/**
 * The Google profile picture saved at sign-in, falling back to the
 * account's initial on its color if there's none or it fails to load.
 * No referrer is sent, which Google's image host can otherwise refuse.
 * Key it by `avatarUrl` so a new picture gets a fresh try after a failure.
 */
export function AccountPicture({
  account,
  size = 16,
}: {
  account: Pick<Account, "avatarUrl" | "color" | "email" | "displayName">;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  if (account.avatarUrl && !failed) {
    return (
      <img
        src={account.avatarUrl}
        alt=""
        referrerPolicy="no-referrer"
        draggable={false}
        onError={() => setFailed(true)}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.56),
        background: account.color,
      }}
    >
      {accountInitial(account)}
    </span>
  );
}

/** True once `active` has stayed true for `ms`; false again as soon as it isn't. */
function useTrueAfter(active: boolean, ms: number): boolean {
  const [elapsed, setElapsed] = useState(false);
  // Reset during render when activity stops, rather than in an effect.
  if (!active && elapsed) setElapsed(false);
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setElapsed(true), ms);
    return () => clearTimeout(timer);
  }, [active, ms]);
  return active && elapsed;
}
