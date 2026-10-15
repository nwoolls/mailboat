import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ThreadId } from "../platform/tauri/bindings";
import { indexAccounts } from "../features/accounts/model/accounts";
import { Sidebar } from "../features/accounts/ui/Sidebar";
import {
  clampWidth,
  LIST_WIDTH,
  listMaxWidth,
  panelToggleFor,
  READER_MIN_WIDTH,
  SIDEBAR_WIDTH,
  SPLITTER_WIDTH,
} from "../features/layout/model/panes";
import { Splitter } from "../features/layout/ui/Splitter";
import { Welcome } from "../features/accounts/ui/Welcome";
import { moveSelection, navKeyFor } from "../features/mailbox/model/listNavigation";
import { readToggle } from "../features/mailbox/model/readState";
import { useSetRead } from "../features/mailbox/ui/useSetRead";
import {
  ALL_INBOXES,
  type Selection,
  selectionKey,
  selectionTitle,
  spansAccounts,
  systemSelection,
} from "../features/mailbox/model/views";
import { emptyStateFor } from "../features/mailbox/model/emptyState";
import { EmptyState } from "../features/mailbox/ui/EmptyState";
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
  // The last conversation opened, kept while the reader slides closed so it
  // doesn't empty out mid-animation. Updated during render, not in an effect.
  const [shownId, setShownId] = useState<ThreadId | null>(null);
  const { mutate: setRead } = useSetRead();
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = threadsQuery;
  const loadMore = useCallback(() => void fetchNextPage(), [fetchNextPage]);

  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_WIDTH.initial);
  const [listWidth, setListWidth] = useState(LIST_WIDTH.initial);
  // Either side panel can be hidden, down to just the list. Not persisted.
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [readerOpen, setReaderOpen] = useState(true);
  // Opening a different conversation (click or j/k) brings a hidden reader
  // back. Adjusted during render rather than in an effect.
  if (selectedId !== null && selectedId !== shownId) {
    setShownId(selectedId);
    setReaderOpen(true);
  }
  const toggleSidebar = useCallback(() => setSidebarOpen((open) => !open), []);
  const toggleReader = useCallback(() => setReaderOpen((open) => !open), []);
  const panesRef = useRef<HTMLDivElement>(null);
  const resizeSidebar = (w: number) =>
    setSidebarWidth(clampWidth(w, SIDEBAR_WIDTH.min, SIDEBAR_WIDTH.max));
  const resizeList = (w: number) =>
    setListWidth(
      clampWidth(w, LIST_WIDTH.min, listMaxWidth(panesRef.current?.clientWidth ?? Infinity)),
    );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const panel = panelToggleFor(e);
      if (panel) {
        e.preventDefault();
        if (panel === "sidebar") toggleSidebar();
        else toggleReader();
        return;
      }
      if (e.key === "/" && !isEditable(e.target)) {
        e.preventDefault();
        document.getElementById("mailboat-search")?.focus();
        return;
      }
      if (e.key === "Escape" && isEditable(e.target)) {
        (e.target as HTMLElement).blur();
        return;
      }
      // Escape closes the open conversation (and with it the reader).
      if (e.key === "Escape" && selectedId !== null) {
        e.preventDefault();
        setSelectedId(null);
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
  }, [threads, selectedId, setRead, toggleSidebar, toggleReader]);

  if (accountsQuery.isPending) return null;
  if (accountList.length === 0) return <Welcome setup={setup.data} />;

  // The reader only appears with a conversation to show.
  const readerVisible = readerOpen && selectedId !== null;
  const readToggleTarget = readToggle(threads, selectedId);
  const toggleRead = readToggleTarget
    ? () => setRead({ ids: [readToggleTarget.id], read: readToggleTarget.read })
    : null;

  return (
    <div className="flex h-full flex-col bg-glass-sidebar">
      <Toolbar
        onToggleRead={toggleRead}
        sidebarOpen={sidebarOpen}
        readerOpen={readerOpen}
        readerAvailable={selectedId !== null}
        onToggleSidebar={toggleSidebar}
        onToggleReader={toggleReader}
      />
      <div className="flex min-h-0 flex-1 pr-2 pb-2">
        {/* Panels stay mounted and slide: the wrapper animates its width and
            clips, while the content keeps its own width (no reflow) and fades
            in from the side. Closed, the sidebar leaves an 8px gutter. */}
        <div
          className="panel-slide on-glass flex shrink-0 overflow-hidden"
          style={{ width: sidebarOpen ? sidebarWidth + SPLITTER_WIDTH : SPLITTER_WIDTH }}
          inert={!sidebarOpen}
        >
          <div
            className="panel-slide-content flex shrink-0"
            data-open={sidebarOpen}
            style={{ width: sidebarWidth + SPLITTER_WIDTH }}
          >
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
          </div>
        </div>
        <div ref={panesRef} className="flex min-w-0 flex-1">
          {/* The list is the body: a rounded card on the glass. With the
              reader hidden it grows to fill; growth animates with the reader. */}
          <section
            className="panel panel-slide flex min-w-0 flex-col overflow-hidden"
            style={{
              flex: `${readerVisible ? 0 : 1} 1 ${listWidth}px`,
              minWidth: LIST_WIDTH.min,
            }}
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
              onSelect={(id) => {
                setSelectedId(id);
                // Clicking the open conversation again also brings it back.
                setReaderOpen(true);
              }}
              hasMore={hasNextPage}
              loadMore={loadMore}
              loading={threadsQuery.isPending || isFetchingNextPage}
              empty={
                <EmptyState
                  // Replays the entrance per view, but not per search keystroke.
                  key={selection.view.kind === "search" ? "search" : selectionKey(selection)}
                  state={emptyStateFor(selection.view)}
                />
              }
            />
          </section>
          <div
            className="panel-slide on-glass flex overflow-hidden"
            style={{
              flex: `${readerVisible ? 1 : 0} 1 0px`,
              minWidth: readerVisible ? SPLITTER_WIDTH + READER_MIN_WIDTH : 0,
            }}
            inert={!readerVisible}
          >
            <div
              className="panel-slide-content from-right flex flex-1"
              data-open={readerVisible}
              style={{ minWidth: SPLITTER_WIDTH + READER_MIN_WIDTH }}
            >
              <Splitter
                label="Resize conversation list"
                width={listWidth}
                onResize={resizeList}
                onReset={() => setListWidth(LIST_WIDTH.initial)}
              />
              {/* The reader sits on the glass like a right-hand sidebar. While
                  it slides closed it keeps showing the last conversation. */}
              <main className="flex min-w-0 flex-1 flex-col">
                {shownId !== null && <ThreadReader threadId={shownId} accounts={accounts} />}
              </main>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
