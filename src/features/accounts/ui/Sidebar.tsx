import { useRef, useState } from "react";
import type { Account, AccountId, AccountSyncState } from "../../../platform/tauri/bindings";
import { useLabels, useUnreadCounts } from "../../../shared/lib/queries";
import { AddIcon, ClearIcon } from "../../../shared/ui/icons";
import { type Selection, systemSelection } from "../../mailbox/model/views";
import { viewUnread } from "../model/sidebar";
import { AccountMenu, type AccountMenuTarget } from "./AccountMenu";
import { LabelMenu, type LabelMenuTarget } from "./LabelMenu";
import { SidebarSections } from "./SidebarSections";
import { useSignIn } from "./useSignIn";

type Props = {
  accounts: Account[];
  width: number;
  syncStates: AccountSyncState[];
  selection: Selection;
  onSelect: (s: Selection) => void;
  onAccountRemoved: (id: AccountId) => void;
};

export function Sidebar({
  accounts,
  width,
  syncStates,
  selection,
  onSelect,
  onAccountRemoved,
}: Props) {
  const labels = useLabels({ kind: "all" }).data ?? [];
  const counts = useUnreadCounts().data ?? [];
  const signIn = useSignIn();
  // Which folds are open (or, for ones that start open, closed). They
  // reset on relaunch.
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const [menu, setMenu] = useState<AccountMenuTarget | null>(null);
  const [labelMenu, setLabelMenu] = useState<LabelMenuTarget | null>(null);
  // Clicking the avatar of an open menu closes it (the click outside),
  // then would reopen it straight away; remember the close to skip that.
  const lastClose = useRef({ account: -1, at: 0 });
  const openMenu: Parameters<typeof SidebarSections>[0]["onAccountMenu"] = (account, anchor) => {
    const recent = performance.now() - lastClose.current.at < 300;
    if (recent && lastClose.current.account === account.id) return;
    setMenu({ account, anchor });
  };
  const closeMenu = () => {
    if (menu) lastClose.current = { account: menu.account.id, at: performance.now() };
    setMenu(null);
  };

  return (
    <nav className="flex h-full shrink-0 flex-col" style={{ width }}>
      {/* No right padding: the 8px splitter gap is the space before the list,
          the same as between the list and the reader. */}
      <div className="flex-1 overflow-y-auto pb-4 pl-2">
        <SidebarSections
          accounts={accounts}
          labels={labels}
          countFor={(view, filter) => viewUnread(counts, view, filter)}
          syncStates={syncStates}
          selection={selection}
          onSelect={onSelect}
          onReauth={(account) => signIn.start(account.email)}
          onAccountMenu={openMenu}
          onLabelMenu={(label, anchor) => setLabelMenu({ label, anchor })}
          isOpen={(key) => open.has(key)}
          toggle={toggle}
        />
      </div>
      {/* A small icon bar, as in Arc's sidebar footer. Settings and the log
          console can join "Add account" here later. */}
      <div className="flex h-9 shrink-0 items-center gap-1 pb-1 pl-2">
        {/* While a browser sign-in is waiting, "+" turns into a cancel
            button (closing the browser tab can't be detected). */}
        <button
          type="button"
          title={signIn.pending ? "Cancel sign-in" : "Add account"}
          aria-label={signIn.pending ? "Cancel sign-in" : "Add account"}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-content/60 transition-colors duration-[120ms] hover:bg-selection hover:text-content"
          onClick={() => (signIn.pending ? signIn.cancel() : signIn.start())}
        >
          {signIn.pending ? <ClearIcon size={16} /> : <AddIcon size={16} />}
        </button>
        {signIn.pending && (
          <span className="truncate text-xs text-content/60">Waiting for browser sign-in…</span>
        )}
      </div>
      {signIn.error && <p className="selectable px-4 pb-2 text-xs text-danger">{signIn.error}</p>}
      <LabelMenu
        target={labelMenu}
        onClose={() => setLabelMenu(null)}
        onDeleted={(label) => {
          // Viewing the deleted label: go to its account's Inbox.
          if (selection.view.kind === "userLabel" && selection.view.labelId === label.id)
            onSelect(systemSelection("inbox", label.accountId));
        }}
      />
      <AccountMenu
        target={menu}
        state={syncStates.find((s) => s.accountId === menu?.account.id)}
        onClose={closeMenu}
        onRemoved={onAccountRemoved}
      />
    </nav>
  );
}
