import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ThreadId } from "../platform/tauri/bindings";
import { indexAccounts } from "../features/accounts/model/accounts";
import { Sidebar } from "../features/accounts/ui/Sidebar";
import {
  clampWidth,
  LIST_WIDTH,
  listMaxWidth,
  READER_MIN_WIDTH,
  SIDEBAR_WIDTH,
} from "../features/layout/model/panes";
import { Splitter } from "../features/layout/ui/Splitter";
import { Welcome } from "../features/accounts/ui/Welcome";
import { moveSelection, navKeyFor } from "../features/mailbox/model/listNavigation";
import { readToggle } from "../features/mailbox/model/readState";
import { useSetRead } from "../features/mailbox/ui/useSetRead";
import {
  ALL_INBOXES,
  type Selection,
  selectionTitle,
  spansAccounts,
  systemSelection,
} from "../features/mailbox/model/views";
import { ThreadList } from "../features/mailbox/ui/ThreadList";
import { ThreadReader } from "../features/reader/ui/ThreadReader";
import { Toolbar } from "./Toolbar";
import {
  useAccounts,
  useLabels,
  useMailEvents,
  useOAuthSetup,
  useSyncStates,
  useThreads,
} from "../shared/lib/queries";

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

export function Shell() {
  useMailEvents();
  const accountsQuery = useAccounts();
  const setup = useOAuthSetup();
  const syncStates = useSyncStates().data ?? [];
  const labels = useLabels({ kind: "all" }).data ?? [];
  const accountList = useMemo(() => accountsQuery.data ?? [], [accountsQuery.data]);
  const accounts = useMemo(() => indexAccounts(accountList), [accountList]);

  // Until the user picks a view: All Inboxes, or the inbox itself when
  // there is only one account.
  const [chosen, setChosen] = useState<Selection | null>(null);
  const onlyAccount = accountList.length === 1 ? accountList[0] : undefined;
  const baseSelection =
    chosen ?? (onlyAccount ? systemSelection("inbox", onlyAccount.id) : ALL_INBOXES);
  const [search, setSearch] = useState("");
  const selection: Selection = search.trim()
    ? { accounts: baseSelection.accounts, view: { kind: "search", text: search.trim() } }
    : baseSelection;

  const threadsQuery = useThreads(selection);
  const threads = useMemo(
    () => threadsQuery.data?.pages.flatMap((p) => p.threads) ?? [],
    [threadsQuery.data],
  );
  const [selectedId, setSelectedId] = useState<ThreadId | null>(null);
  const { mutate: setRead } = useSetRead();
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = threadsQuery;
  const loadMore = useCallback(() => void fetchNextPage(), [fetchNextPage]);

  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_WIDTH.initial);
  const [listWidth, setListWidth] = useState(LIST_WIDTH.initial);
  const panesRef = useRef<HTMLDivElement>(null);
  const resizeSidebar = (w: number) =>
    setSidebarWidth(clampWidth(w, SIDEBAR_WIDTH.min, SIDEBAR_WIDTH.max));
  const resizeList = (w: number) =>
    setListWidth(
      clampWidth(w, LIST_WIDTH.min, listMaxWidth(panesRef.current?.clientWidth ?? Infinity)),
    );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !isEditable(e.target)) {
        e.preventDefault();
        document.getElementById("mailboat-search")?.focus();
        return;
      }
      if (e.key === "Escape" && isEditable(e.target)) {
        (e.target as HTMLElement).blur();
        return;
      }
      if (e.key === "u" && !isEditable(e.target) && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const toggle = readToggle(threads, selectedId);
        if (toggle) {
          e.preventDefault();
          setRead({ ids: [toggle.id], read: toggle.read });
        }
        return;
      }
      const nav = navKeyFor(e, isEditable(e.target));
      if (!nav) return;
      e.preventDefault();
      setSelectedId((current) => moveSelection(threads, current, nav));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [threads, selectedId, setRead]);

  if (accountsQuery.isPending) return null;
  if (accountList.length === 0) return <Welcome setup={setup.data} />;

  const readToggleTarget = readToggle(threads, selectedId);
  const toggleRead = readToggleTarget
    ? () => setRead({ ids: [readToggleTarget.id], read: readToggleTarget.read })
    : null;

  return (
    <div className="flex h-full flex-col bg-glass-sidebar">
      <Toolbar onToggleRead={toggleRead} />
      <div className="flex min-h-0 flex-1 pr-2 pb-2">
        <Sidebar
          accounts={accountList}
          width={sidebarWidth}
          syncStates={syncStates}
          selection={baseSelection}
          onSelect={(s) => {
            setChosen(s);
            setSearch("");
            setSelectedId(null);
          }}
        />
        <Splitter
          label="Resize sidebar"
          width={sidebarWidth}
          onResize={resizeSidebar}
          onReset={() => setSidebarWidth(SIDEBAR_WIDTH.initial)}
        />
        <div ref={panesRef} className="flex min-w-0 flex-1">
          {/* The list is the body: a rounded card on the glass. It shrinks
              with the window before the reader drops below its minimum. */}
          <section
            className="panel flex min-w-0 flex-col overflow-hidden"
            style={{ flex: `0 1 ${listWidth}px`, minWidth: LIST_WIDTH.min }}
          >
            <div className="flex h-10 shrink-0 items-center px-4">
              <h2 className="truncate text-sm font-semibold">
                {selectionTitle(selection, accountList, labels)}
              </h2>
            </div>
            <div className="px-3 pb-2">
              <input
                id="mailboat-search"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search  /"
                className="w-full rounded-md bg-selection-subtle px-3 py-1.5 outline-none placeholder:text-content/30 focus:bg-selection"
              />
            </div>
            <ThreadList
              threads={threads}
              accounts={accounts}
              showAccount={spansAccounts(selection, accountList.length)}
              selectedId={selectedId}
              onSelect={setSelectedId}
              hasMore={hasNextPage}
              loadMore={loadMore}
              loading={threadsQuery.isPending || isFetchingNextPage}
            />
          </section>
          <Splitter
            label="Resize conversation list"
            width={listWidth}
            onResize={resizeList}
            onReset={() => setListWidth(LIST_WIDTH.initial)}
          />
          {/* The reader sits on the glass like a right-hand sidebar. */}
          <main className="flex flex-1 flex-col" style={{ minWidth: READER_MIN_WIDTH }}>
            <ThreadReader threadId={selectedId} accounts={accounts} />
          </main>
        </div>
      </div>
    </div>
  );
}
