import { useState } from "react";
import type { Account, AccountSyncState } from "../../../platform/tauri/bindings";
import { useLabels, useUnreadCounts } from "../../../shared/lib/queries";
import { AddIcon, ClearIcon } from "../../../shared/ui/icons";
import type { Selection } from "../../mailbox/model/views";
import {
  parseSidebarStyle,
  SIDEBAR_STYLE_OPTIONS,
  SIDEBAR_STYLE_STORAGE_KEY,
  type SidebarStyle,
} from "../model/sidebar";
import { SidebarNested } from "./SidebarNested";
import { SidebarSwitcher } from "./SidebarSwitcher";
import { SidebarTidy } from "./SidebarTidy";
import type { SidebarBodyProps } from "./sidebarParts";
import { useSignIn } from "./useSignIn";

type Props = {
  accounts: Account[];
  width: number;
  syncStates: AccountSyncState[];
  selection: Selection;
  onSelect: (s: Selection) => void;
};

const LAYOUTS: Record<SidebarStyle, (props: SidebarBodyProps) => React.ReactNode> = {
  switcher: SidebarSwitcher,
  nested: SidebarNested,
  tidy: SidebarTidy,
};

export function Sidebar({ accounts, width, syncStates, selection, onSelect }: Props) {
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
  // Temporary: which layout is being tried (see model/sidebar.ts).
  const [style, setStyle] = useState<SidebarStyle>(() =>
    parseSidebarStyle(localStorage.getItem(SIDEBAR_STYLE_STORAGE_KEY)),
  );
  const chooseStyle = (value: SidebarStyle) => {
    setStyle(value);
    localStorage.setItem(SIDEBAR_STYLE_STORAGE_KEY, value);
  };
  const Layout = LAYOUTS[style];

  return (
    <nav className="flex h-full shrink-0 flex-col" style={{ width }}>
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        <Layout
          accounts={accounts}
          labels={labels}
          counts={counts}
          syncStates={syncStates}
          selection={selection}
          onSelect={onSelect}
          onReauth={(account) => signIn.start(account.email)}
          isOpen={(key) => open.has(key)}
          toggle={toggle}
        />
      </div>
      {/* A small icon bar, as in Arc's sidebar footer. Settings and the log
          console can join "Add account" here later. */}
      <div className="flex h-9 shrink-0 items-center gap-1 px-2 pb-1">
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
        {signIn.pending ? (
          <span className="truncate text-xs text-content/60">Waiting for browser sign-in…</span>
        ) : (
          // Temporary: try the sidebar layouts, then remove.
          <div className="ml-auto flex shrink-0 gap-0.5 rounded-md bg-selection-subtle p-0.5 text-[11px]">
            {SIDEBAR_STYLE_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                className={`rounded px-1.5 py-0.5 ${
                  style === o.value
                    ? "bg-selection-strong text-content"
                    : "text-content/50 hover:text-content"
                }`}
                onClick={() => chooseStyle(o.value)}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {signIn.error && <p className="selectable px-4 pb-2 text-xs text-danger">{signIn.error}</p>}
    </nav>
  );
}
