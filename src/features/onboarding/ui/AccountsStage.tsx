import { useEffect, useState } from "react";
import {
  type Account,
  type AccountId,
  type AccountSyncState,
  commands,
  events,
  type SyncProgress,
} from "../../../platform/tauri/bindings";
import { IS_TAURI, unwrap } from "../../../platform/tauri/ipc";
import { APP_NAME } from "../../../shared/lib/brand";
import { useSyncStates } from "../../../shared/lib/queries";
import { useTrueAfter } from "../../../shared/lib/useTrueAfter";
import { AddIcon, CheckIcon, ExternalIcon, LockIcon } from "../../../shared/ui/icons";
import { signInAgainReason } from "../../accounts/model/permissions";
import { useSignIn } from "../../accounts/ui/useSignIn";
import {
  type Advice,
  BLOCKED_HINT_MS,
  consoleUrl,
  explainSignInError,
  explainSyncError,
  type GuideStepId,
  stepLinkLabel,
} from "../model/onboarding";
import { SignInSketches } from "./ConsoleSketch";

/**
 * Add Gmail accounts: the first sign-in also proves the Google Cloud setup
 * works. Before it, what Google will show (its warning about an app still
 * being tested, and the permission boxes, which start empty) is drawn so it
 * doesn't alarm anyone. Each account then shows with its first sync under
 * way.
 */
export function AccountsStage({
  accounts,
  projectId,
  onNext,
  onFix,
}: {
  accounts: Account[];
  /** The Google Cloud project in use, to open its pages. */
  projectId: string | null;
  onNext: () => void;
  /** Back to the Google Cloud stage, to fix what a failed sign-in points at. */
  onFix: () => void;
}) {
  const signIn = useSignIn();
  const states = useSyncStates().data ?? [];
  const progress = useSyncProgress();
  const advice: Advice | null = signIn.error ? explainSignInError(signIn.error) : null;
  const first = accounts.length === 0;
  // Google's "Access blocked" page never comes back to the app, so after a
  // wait the screen says what it means.
  const stuck = useTrueAfter(signIn.pending, BLOCKED_HINT_MS);
  const open = (step: GuideStepId) => void unwrap(commands.linkOpen(consoleUrl(step, projectId)));

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-[22px] font-semibold tracking-tight">
          {first ? "Add your first Gmail account" : "Your Gmail accounts"}
        </h1>
        <p className="mt-1 max-w-lg text-content/60">
          Sign-in happens in your browser; {APP_NAME} never sees your password. Gmail and Google
          Workspace accounts both work, as many as you like.
        </p>
      </header>

      {first && (
        <section className="space-y-2.5 rounded-xl bg-selection-subtle p-4 ring-1 ring-stroke">
          <h2 className="flex items-center gap-1.5 text-[13px] font-medium">
            <LockIcon size={14} className="text-content/60" />
            Two things Google will show you
          </h2>
          <p className="text-[13px] leading-relaxed text-content/65">
            First a warning that Google hasn’t verified the app. That’s expected: it’s your own
            private project. Press <b>Continue</b>. Then the permissions, which start empty: tick{" "}
            <b>Select all</b>, or {APP_NAME} can’t read your mail.
          </p>
          <SignInSketches />
          <p className="text-[12px] text-content/55">
            Google says “Access blocked” instead? That address isn’t a test user yet.{" "}
            <button
              type="button"
              className="text-accent hover:underline"
              onClick={() => open("users")}
            >
              Open Test users
            </button>
          </p>
        </section>
      )}

      {accounts.length > 0 && (
        <ul className="space-y-1.5">
          {accounts.map((account) => (
            <AccountRow
              key={account.id}
              account={account}
              status={states.find((s) => s.accountId === account.id)}
              progress={progress.get(account.id)}
            />
          ))}
        </ul>
      )}

      <div className="flex items-center gap-3">
        {signIn.pending ? (
          <>
            <span className="text-content/60">Finish signing in in your browser…</span>
            <button type="button" className="text-accent hover:underline" onClick={signIn.cancel}>
              Cancel
            </button>
          </>
        ) : first ? (
          <button
            type="button"
            autoFocus
            onClick={() => signIn.start()}
            className="rounded-md bg-accent px-4 py-2 font-medium text-white"
          >
            Sign in with Google
          </button>
        ) : (
          <>
            <button
              type="button"
              autoFocus
              onClick={onNext}
              className="rounded-md bg-accent px-4 py-2 font-medium text-white"
            >
              Continue
            </button>
            <button
              type="button"
              onClick={() => signIn.start()}
              className="flex items-center gap-1.5 rounded-md px-3 py-2 text-content/70 hover:bg-selection"
            >
              <AddIcon size={14} /> Add another account
            </button>
          </>
        )}
      </div>

      {stuck && (
        <p className="onb-rise text-[13px] text-content/65">
          Google showing “Access blocked”? That address isn’t a test user yet: add it under Test
          users, then sign in again.{" "}
          <button
            type="button"
            className="text-accent hover:underline"
            onClick={() => open("users")}
          >
            Open Test users
          </button>
        </p>
      )}

      {advice && (
        <div role="alert" className="onb-rise space-y-2">
          <p className="selectable text-[13px] text-danger">{advice.message}</p>
          {advice.step && (
            <div className="flex items-center gap-4 text-[13px]">
              <button
                type="button"
                className="flex items-center gap-1 text-accent hover:underline"
                onClick={() => open(advice.step!)}
              >
                {stepLinkLabel(advice.step)} <ExternalIcon size={12} />
              </button>
              {(advice.step === "client" || advice.step === "apis") && (
                <button type="button" className="text-accent hover:underline" onClick={onFix}>
                  Back to the Google Cloud setup
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AccountRow({
  account,
  status,
  progress,
}: {
  account: Account;
  status: AccountSyncState | undefined;
  progress: SyncProgress | undefined;
}) {
  const synced = status?.lastSyncAt != null && status.status === "idle";
  const failed = status?.status === "error" || status?.status === "authError";
  const advice = failed ? explainSyncError(status?.errorMessage ?? null) : null;
  const missing = signInAgainReason(account.missingPermissions);
  const share = progress && progress.total > 0 ? Math.min(1, progress.done / progress.total) : null;
  return (
    <li className="onb-rise flex items-center gap-3 rounded-xl bg-selection-subtle px-3.5 py-2.5 ring-1 ring-stroke">
      <Avatar account={account} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{account.displayName ?? account.email}</div>
        <div className="truncate text-[12px] text-content/55">
          {failed
            ? (advice?.message ?? status?.errorMessage ?? "Sync stopped")
            : synced
              ? (missing ?? "Synced")
              : syncLine(progress)}
        </div>
        {!synced && !failed && (
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-selection">
            <div
              className={`h-full rounded-full bg-accent transition-[width] duration-500 ${
                share === null ? "w-1/3 animate-pulse" : ""
              }`}
              style={share === null ? undefined : { width: `${Math.max(4, share * 100)}%` }}
            />
          </div>
        )}
      </div>
      {synced && (
        <span className="onb-tick flex size-5 items-center justify-center rounded-full bg-accent text-white">
          <CheckIcon size={12} strokeWidth={2.5} />
        </span>
      )}
    </li>
  );
}

function syncLine(progress: SyncProgress | undefined): string {
  if (!progress || progress.total === 0) return "Getting ready…";
  const n = `${progress.done.toLocaleString()} of ${progress.total.toLocaleString()}`;
  return progress.phase === "listing"
    ? `Finding conversations… ${n}`
    : progress.phase === "fetching"
      ? `Bringing in conversations… ${n}`
      : `Downloading emails… ${n}`;
}

function Avatar({ account }: { account: Account }) {
  const [broken, setBroken] = useState(false);
  const letter = (account.displayName ?? account.email).slice(0, 1).toUpperCase();
  return account.avatarUrl && !broken ? (
    <img
      src={account.avatarUrl}
      alt=""
      onError={() => setBroken(true)}
      referrerPolicy="no-referrer"
      className="size-8 shrink-0 rounded-full ring-2"
      style={{ ["--tw-ring-color" as string]: account.color }}
    />
  ) : (
    <span
      className="flex size-8 shrink-0 items-center justify-center rounded-full text-[13px] font-medium text-white"
      style={{ background: account.color }}
    >
      {letter}
    </span>
  );
}

/** The latest sync progress of each account, from Rust's events. */
function useSyncProgress(): Map<AccountId, SyncProgress> {
  const [byAccount, setByAccount] = useState(() => new Map<AccountId, SyncProgress>());
  useEffect(() => {
    if (!IS_TAURI) return;
    const unlisten = events.syncProgressEvent.listen((e) =>
      setByAccount((m) => new Map(m).set(e.payload.accountId, e.payload)),
    );
    return () => void unlisten.then((fn) => fn());
  }, []);
  return byAccount;
}
