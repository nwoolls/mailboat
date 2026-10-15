import type { Account, AccountSyncState, Label } from "../../../platform/tauri/bindings";
import { useLabels } from "../../../shared/lib/queries";
import {
  ACCOUNT_VIEWS,
  labelSelection,
  sameSelection,
  type Selection,
  selectionKey,
  UNIFIED_VIEWS,
  viewSelection,
  viewTitle,
} from "../../mailbox/model/views";
import { accountInitial, syncBadge } from "../model/accounts";
import { useSignIn } from "./useSignIn";

type Props = {
  accounts: Account[];
  syncStates: AccountSyncState[];
  selection: Selection;
  onSelect: (s: Selection) => void;
};

export function Sidebar({ accounts, syncStates, selection, onSelect }: Props) {
  const labels = useLabels({ kind: "all" }).data ?? [];
  const signIn = useSignIn();

  return (
    <nav className="flex h-full w-56 shrink-0 flex-col border-r border-stroke bg-background-raised">
      {/* Space for the macOS traffic lights; also the window drag handle. */}
      <div data-tauri-drag-region className="h-11 shrink-0" />
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {accounts.length > 1 && (
          <Section title="All accounts">
            {UNIFIED_VIEWS.map((view) => {
              const s = viewSelection(view);
              return (
                <ViewItem
                  key={selectionKey(s)}
                  selected={sameSelection(selection, s)}
                  onClick={() => onSelect(s)}
                  title={
                    view.kind === "system" && view.label === "inbox"
                      ? "All Inboxes"
                      : viewTitle(view)
                  }
                />
              );
            })}
          </Section>
        )}
        {accounts.map((account) => (
          <AccountSection
            key={account.id}
            account={account}
            labels={labels.filter((l) => l.accountId === account.id)}
            state={syncStates.find((s) => s.accountId === account.id)}
            selection={selection}
            onSelect={onSelect}
            onReauth={() => signIn.start(account.email)}
          />
        ))}
      </div>
      <div className="border-t border-stroke p-2">
        {signIn.pending ? (
          <div className="flex items-center gap-2 px-2 py-1.5 text-content/60">
            <span className="truncate">Waiting for browser sign-in…</span>
            <button
              type="button"
              className="ml-auto shrink-0 text-accent hover:underline"
              onClick={signIn.cancel}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="w-full rounded-md px-2 py-1.5 text-left text-content/60 hover:bg-selection hover:text-content"
            onClick={() => signIn.start()}
          >
            + Add account
          </button>
        )}
        {signIn.error && <p className="selectable px-2 pt-1 text-xs text-danger">{signIn.error}</p>}
      </div>
    </nav>
  );
}

function Section({
  title,
  children,
  aside,
}: {
  title: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <div className="mt-3">
      <div className="flex items-center gap-2 px-2 pb-1 text-[11px] font-medium tracking-wide text-content/40">
        <span className="truncate">{title}</span>
        {aside}
      </div>
      {children}
    </div>
  );
}

function ViewItem({
  title,
  selected,
  onClick,
  color,
}: {
  title: string;
  selected: boolean;
  onClick: () => void;
  color?: string | null;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left ${
        selected ? "bg-selection-strong text-content" : "text-content/70 hover:bg-selection"
      }`}
    >
      {color !== undefined && (
        <span
          className="h-2 w-2 shrink-0 rounded-sm"
          style={{ background: color ?? "currentColor", opacity: color ? 1 : 0.3 }}
        />
      )}
      <span className="truncate">{title}</span>
    </button>
  );
}

function AccountSection({
  account,
  labels,
  state,
  selection,
  onSelect,
  onReauth,
}: {
  account: Account;
  labels: Label[];
  state: AccountSyncState | undefined;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onReauth: () => void;
}) {
  const badge = syncBadge(state);
  const tone = { ok: "", busy: "text-content/40", warn: "text-warn", error: "text-danger" }[
    badge.tone
  ];
  return (
    <Section
      title={account.email}
      aside={
        <span
          className="ml-auto flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold text-white"
          style={{ background: account.color }}
        >
          {accountInitial(account)}
        </span>
      }
    >
      {badge.tone !== "ok" && (
        <div className={`px-2 pb-1 text-xs ${tone}`}>
          {badge.tone === "error" && state?.status === "authError" ? (
            <button type="button" className="underline" onClick={onReauth}>
              {badge.label}
            </button>
          ) : (
            <span className="selectable">{badge.label}</span>
          )}
        </div>
      )}
      {ACCOUNT_VIEWS.map((view) => {
        const s = viewSelection(view, account.id);
        return (
          <ViewItem
            key={selectionKey(s)}
            title={viewTitle(view)}
            selected={sameSelection(selection, s)}
            onClick={() => onSelect(s)}
          />
        );
      })}
      {labels.map((label) => {
        const s = labelSelection(label);
        return (
          <ViewItem
            key={label.id}
            title={label.name}
            color={label.colorBg}
            selected={sameSelection(selection, s)}
            onClick={() => onSelect(s)}
          />
        );
      })}
    </Section>
  );
}
