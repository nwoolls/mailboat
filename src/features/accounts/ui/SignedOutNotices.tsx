import { useState } from "react";
import type { Account, AccountId, AccountSyncState } from "../../../platform/tauri/bindings";
import { ClearIcon } from "../../../shared/ui/icons";
import { signedOut, SIGNED_OUT_NEXT, stillDismissed, unseen } from "../model/signedOut";
import type { SignIn } from "./useSignIn";

/**
 * The signed-out accounts the notice still has to show. A dismissal lasts
 * until the account is back; it lives in the window only, so the notice
 * returns at the next launch while the account is still signed out.
 */
export function useSignedOutNotices(accounts: Account[], syncStates: AccountSyncState[]) {
  const [dismissed, setDismissed] = useState<ReadonlySet<AccountId>>(new Set());
  // An account that signed in again is forgotten, so a later sign-out is new.
  // Adjusting this component's own state while rendering is React's way to
  // follow changing props (an effect is what the repo's rules rule out); it
  // can't loop, as `stillDismissed` returns the same set when nothing changed.
  const kept = stillDismissed(accounts, syncStates, dismissed);
  if (kept !== dismissed) setDismissed(kept);
  return {
    list: unseen(signedOut(accounts, syncStates), kept),
    dismiss: (id: AccountId) => setDismissed(new Set([...kept, id])),
  };
}

/**
 * A notice at the top right for each account Google has signed out, with a
 * Sign in again button (as the sign-in code notices: glass, never modal).
 * It goes when the account signs in again. Dismissing it only hides it for
 * now: it returns at the next launch while the account is still signed
 * out, and the account's red dot and menu stay either way. A failed
 * sign-in is told here while the notice shows (the sidebar's own line
 * stands down), so it is never said twice.
 */
export function SignedOutNotices({
  list,
  onDismiss,
  signIn,
}: {
  list: Account[];
  onDismiss: (id: AccountId) => void;
  signIn: SignIn;
}) {
  if (list.length === 0) return null;
  // One browser sign-in at a time: only the account it is for shows waiting,
  // Cancel and a failure; the others wait their turn.
  const mine = (a: Account) => signIn.hint === a.email;

  return (
    <section
      aria-label="Signed out"
      role="status"
      className="notice-card w-[min(320px,calc(100vw-24px))] overflow-hidden rounded-xl"
    >
      <ul className="divide-y divide-stroke">
        {list.map((a) => (
          <li key={a.id} className="px-3 py-2.5">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-semibold">Google signed you out</div>
                <div className="selectable truncate text-[12px] text-content/85">{a.email}</div>
              </div>
              <button
                type="button"
                aria-label={`Dismiss for ${a.email}`}
                title="Dismiss"
                onClick={() => onDismiss(a.id)}
                className="-mt-0.5 -mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-content/45 hover:bg-selection hover:text-content"
              >
                <ClearIcon size={12} strokeWidth={2} />
              </button>
            </div>
            <p className="mt-1 text-[11px] text-content/50">{SIGNED_OUT_NEXT}</p>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                disabled={signIn.pending}
                aria-label={`Sign in again for ${a.email}`}
                onClick={() => signIn.start(a.email)}
                className="flex h-7 items-center rounded-md bg-accent px-2.5 text-[12px] font-medium text-white hover:brightness-110 disabled:opacity-60"
              >
                {signIn.pending && mine(a) ? "Waiting for the browser…" : "Sign in again"}
              </button>
              {signIn.pending && mine(a) && (
                <button
                  type="button"
                  aria-label={`Cancel sign-in for ${a.email}`}
                  onClick={() => signIn.cancel()}
                  className="h-7 rounded-md px-2 text-[12px] text-content/60 hover:bg-selection hover:text-content"
                >
                  Cancel
                </button>
              )}
            </div>
            {signIn.error && mine(a) && (
              <p className="selectable mt-2 text-[11px] text-danger">{signIn.error}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
