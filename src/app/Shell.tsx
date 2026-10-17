import { useCallback, useEffect, useMemo, useState } from "react";
import type { ThreadId } from "../platform/tauri/bindings";
import { indexAccounts, syncAttention } from "../features/accounts/model/accounts";
import { Sidebar } from "../features/accounts/ui/Sidebar";
import {
  clampWidth,
  LAYOUT_STORAGE_KEY,
  LIST_SHARE,
  LIST_WIDTH,
  listShareFor,
  panelToggleFor,
  parseLayout,
  READER_MIN_WIDTH,
  type SavedLayout,
  SIDEBAR_WIDTH,
  SPLITTER_WIDTH,
} from "../features/layout/model/panes";
import { Splitter } from "../features/layout/ui/Splitter";
import { useElementWidth } from "../features/layout/ui/useElementWidth";
import { Welcome } from "../features/accounts/ui/Welcome";
import { moveSelection, navKeyFor } from "../features/mailbox/model/listNavigation";
import {
  actionTargets,
  type Checked,
  NONE,
  prune,
  rangeChecked,
  toggleChecked,
} from "../features/mailbox/model/multiSelect";
import {
  actionMessage,
  actionVerb,
  inverse,
  labelToggle,
  leavesView,
  nextAfterRemoval,
  type ThreadAction,
  toggleFor,
} from "../features/mailbox/model/threadActions";
import { LabelPicker } from "../features/mailbox/ui/LabelPicker";
import { useOlderMail } from "../features/mailbox/ui/useOlderMail";
import { useThreadAction } from "../features/mailbox/ui/useThreadAction";
import { anchorBelow, type MenuAnchor } from "../shared/ui/Menu";
import { dismissToast, showToast, useToast } from "../shared/lib/toast";
import { Toast } from "../shared/ui/Toast";
import {
  ALL_INBOXES,
  type Selection,
  selectionNeedsAccount,
  selectionTitle,
  spansAccounts,
  systemSelection,
} from "../features/mailbox/model/views";
import { emptyStateFor, emptyStateKey } from "../features/mailbox/model/emptyState";
import { EmptyState } from "../features/mailbox/ui/EmptyState";
import { ThreadList } from "../features/mailbox/ui/ThreadList";
import { ThreadReader } from "../features/reader/ui/ThreadReader";
import { accountForNew } from "../features/compose/model/draft";
import { openCardEntry } from "../features/compose/model/composeState";
import { ComposeCard } from "../features/compose/ui/ComposeCard";
import { MinimizedTabs } from "../features/compose/ui/MinimizedTabs";
import { ReplyArea } from "../features/compose/ui/ReplyArea";
import {
  resumeThreadDraft,
  useCardSpot,
  useComposeActions,
  useComposeState,
} from "../features/compose/ui/useCompose";
import { SEARCH_INPUT_ID } from "./TitleSearch";
import { LABEL_BUTTON_ID, Toolbar, type ToolbarActions } from "./Toolbar";
import {
  useAccounts,
  useIdentities,
  useLabels,
  useMailEvents,
  useOAuthSetup,
  useSyncStates,
  useThreads,
} from "../shared/lib/queries";

/**
 * A file dropped outside a composer does nothing. (With Tauri's own file
 * drop turned off so composers can take files, the web view would
 * otherwise open the file in place of the app.)
 */
function useIgnoreStrayDrops() {
  useEffect(() => {
    const stop = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    window.addEventListener("dragover", stop);
    window.addEventListener("drop", stop);
    return () => {
      window.removeEventListener("dragover", stop);
      window.removeEventListener("drop", stop);
    };
  }, []);
}

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

export function Shell() {
  useMailEvents();
  useIgnoreStrayDrops();
  const accountsQuery = useAccounts();
  const setup = useOAuthSetup();
  const syncStates = useSyncStates().data ?? [];
  const labels = useLabels({ kind: "all" }).data ?? [];
  const accountList = useMemo(() => accountsQuery.data ?? [], [accountsQuery.data]);
  const accounts = useMemo(() => indexAccounts(accountList), [accountList]);
  const identities = useIdentities().data ?? [];
  const compose = useComposeActions(accountList);
  const composeState = useComposeState();
  const openCard = openCardEntry(composeState);
  const cardSpot = useCardSpot();

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

  const showAccount = spansAccounts(selection, accountList.length);

  const threadsQuery = useThreads(selection);
  const threads = useMemo(
    () => threadsQuery.data?.pages.flatMap((p) => p.threads) ?? [],
    [threadsQuery.data],
  );
  const [selectedId, setSelectedId] = useState<ThreadId | null>(null);
  // The last conversation opened, kept while the reader slides closed so it
  // doesn't empty out mid-animation. Updated during render, not in an effect.
  const [shownId, setShownId] = useState<ThreadId | null>(null);
  // Conversations picked with ⌘/⇧-click or `x`, on top of the open one.
  // Picks that left the list (archived, trashed, …) are dropped here,
  // during render, rather than in an effect.
  const [checkedState, setChecked] = useState<Checked>(NONE);
  const checked = prune(checkedState, threads);
  const targets = actionTargets(threads, checked, selectedId);
  const toast = useToast();
  const [labelAnchor, setLabelAnchor] = useState<MenuAnchor | null>(null);
  const { mutate: mutateThreads } = useThreadAction();
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = threadsQuery;
  // Past the last cached page, ask Gmail for older mail. Not while the
  // list is refreshing or standing in for the previous view.
  const older = useOlderMail(selection);
  const settled = !threadsQuery.isPlaceholderData && !threadsQuery.isFetching;
  const fromGmail = !hasNextPage && settled && older.available;
  const { load: loadOlder } = older;
  const loadMore = useCallback(
    () => void (hasNextPage ? fetchNextPage() : loadOlder()),
    [hasNextPage, fetchNextPage, loadOlder],
  );

  // Splitter positions, remembered between launches. The sidebar keeps its
  // pixel width; the list is a share of the space beside it, so the list
  // and reader resize together with the window.
  const [layout, setLayout] = useState(() => parseLayout(localStorage.getItem(LAYOUT_STORAGE_KEY)));
  const saveLayout = (next: SavedLayout) => {
    setLayout(next);
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(next));
  };
  const sidebarWidth = layout.sidebarWidth;
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
  /**
   * Runs an action on the chosen conversations (or `ids`). If they leave
   * the current view, the next conversation opens, as in Mail. Archive,
   * trash and labels say what happened, with Undo; errors always show.
   */
  const act = useCallback(
    // Named, so Undo can call it again.
    function run(action: ThreadAction, ids: ThreadId[], undoable = true) {
      if (ids.length === 0) return;
      if (leavesView(action, selection.view)) {
        const removed = new Set(ids);
        setSelectedId((current) => nextAfterRemoval(threads, removed, current));
        setChecked(NONE);
      }
      const message = actionMessage(action, ids.length);
      if (message)
        showToast({
          message,
          action: undoable
            ? {
                label: "Undo",
                run: () => {
                  run(inverse(action), ids, false);
                  // Back to where you were, if it had moved on.
                  if (leavesView(action, selection.view) && ids.length === 1)
                    setSelectedId(ids[0]!);
                },
              }
            : undefined,
        });
      mutateThreads(
        { ids, action },
        {
          onError: (error) =>
            showToast({
              tone: "error",
              message: `Couldn’t ${actionVerb(action)}: ${error.message}`,
            }),
        },
      );
    },
    [mutateThreads, selection.view, threads],
  );
  const lastUndo = toast?.action;
  const { startNew: openNew } = compose;
  const startNew = useCallback(() => {
    const account = accountForNew(
      baseSelection.accounts,
      accountList.map((a) => a.id),
    );
    if (account !== undefined) void openNew(account);
  }, [openNew, baseSelection.accounts, accountList]);
  const [panesRef, panesWidth] = useElementWidth<HTMLDivElement>();
  const resizeSidebar = (w: number) =>
    saveLayout({ ...layout, sidebarWidth: clampWidth(w, SIDEBAR_WIDTH.min, SIDEBAR_WIDTH.max) });
  const resizeList = (w: number) =>
    saveLayout({ ...layout, listShare: listShareFor(w, panesWidth) });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A menu or dialog handles its own keys.
      if (e.target instanceof Element && e.target.closest("[role=menu], [role=dialog], dialog"))
        return;
      const panel = panelToggleFor(e);
      if (panel) {
        e.preventDefault();
        if (panel === "sidebar") toggleSidebar();
        else toggleReader();
        return;
      }
      if (e.key === "/" && !isEditable(e.target)) {
        e.preventDefault();
        document.getElementById(SEARCH_INPUT_ID)?.focus();
        return;
      }
      if (e.key === "Escape" && isEditable(e.target)) {
        (e.target as HTMLElement).blur();
        return;
      }
      // Escape first drops picked conversations, then closes the open one
      // (and with it the reader).
      if (e.key === "Escape" && checked.size > 0) {
        e.preventDefault();
        setChecked(NONE);
        return;
      }
      if (e.key === "Escape" && selectedId !== null) {
        e.preventDefault();
        setSelectedId(null);
        return;
      }
      // Undo the last archive, trash or label change: z (as in Gmail) or ⌘Z.
      if (
        !isEditable(e.target) &&
        lastUndo &&
        ((e.key === "z" && !e.metaKey && !e.ctrlKey && !e.altKey) ||
          (e.key === "z" && e.metaKey && !e.shiftKey))
      ) {
        e.preventDefault();
        lastUndo.run();
        dismissToast();
        return;
      }
      const plain = !isEditable(e.target) && !e.metaKey && !e.ctrlKey && !e.altKey;
      const toggles: Record<string, "read" | "archive" | "star" | "trash" | "spam"> = {
        u: "read",
        e: "archive",
        s: "star",
        "#": "trash",
        // Gmail's key for Report spam.
        "!": "spam",
      };
      const kind = plain ? toggles[e.key] : undefined;
      if (kind) {
        const action = toggleFor(kind, targets);
        if (action) {
          e.preventDefault();
          act(
            action,
            targets.map((t) => t.id),
          );
        }
        return;
      }
      if (plain && e.key === "l" && targets.length > 0) {
        e.preventDefault();
        const button = document.getElementById(LABEL_BUTTON_ID);
        if (button) setLabelAnchor(anchorBelow(button));
        return;
      }
      if (plain && e.key === "c") {
        e.preventDefault();
        startNew();
        return;
      }
      const replyKinds = { r: "reply", a: "replyAll", f: "forward" } as const;
      const replyKind = plain ? replyKinds[e.key as keyof typeof replyKinds] : undefined;
      if (replyKind && selectedId !== null) {
        e.preventDefault();
        setReaderOpen(true);
        void compose.startReply(replyKind, selectedId);
        return;
      }
      if (plain && e.key === "x" && selectedId !== null) {
        e.preventDefault();
        setChecked(toggleChecked(checked, selectedId, selectedId));
        return;
      }
      const nav = navKeyFor(e, isEditable(e.target));
      if (!nav) return;
      e.preventDefault();
      setSelectedId((current) => moveSelection(threads, current, nav));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    threads,
    selectedId,
    checked,
    targets,
    act,
    lastUndo,
    toggleSidebar,
    toggleReader,
    startNew,
    compose,
  ]);

  if (accountsQuery.isPending) return null;
  if (accountList.length === 0) return <Welcome setup={setup.data} />;

  // The reader only appears with a conversation to show.
  const readerVisible = readerOpen && selectedId !== null;
  const targetIds = targets.map((t) => t.id);
  const toggle = (kind: "read" | "archive" | "star" | "trash" | "spam") => {
    const action = toggleFor(kind, targets);
    return action ? { action, run: () => act(action, targetIds) } : null;
  };
  const toolbarActions: ToolbarActions = {
    archive: toggle("archive"),
    trash: toggle("trash"),
    spam: toggle("spam"),
    read: toggle("read"),
    star: toggle("star"),
    label:
      targets.length > 0
        ? (button: HTMLElement) => setLabelAnchor((open) => (open ? null : anchorBelow(button)))
        : null,
  };
  const pickerAccount = targets[0]?.accountId;
  const pickerLabels = labels.filter((l) => l.accountId === pickerAccount);

  return (
    <div className="flex h-full flex-col bg-glass-sidebar">
      <Toolbar
        search={search}
        onSearch={setSearch}
        actions={toolbarActions}
        sidebarOpen={sidebarOpen}
        syncAttention={syncAttention(syncStates)}
        readerOpen={readerOpen}
        hasSelection={selectedId !== null}
        count={targets.length}
        onToggleSidebar={toggleSidebar}
        onToggleReader={toggleReader}
        onCompose={startNew}
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
              onAccountRemoved={(id) => {
                // Leave views that only showed that account's mail, and
                // close its conversation if one was open.
                if (chosen && selectionNeedsAccount(chosen, id, labels)) {
                  setChosen(null);
                  setSearch("");
                }
                if (threads.find((t) => t.id === selectedId)?.accountId === id) setSelectedId(null);
              }}
            />
            <Splitter
              label="Resize sidebar"
              width={sidebarWidth}
              onResize={resizeSidebar}
              onReset={() => saveLayout({ ...layout, sidebarWidth: SIDEBAR_WIDTH.initial })}
            />
          </div>
        </div>
        <div ref={panesRef} className="flex min-w-0 flex-1">
          {/* The list is the body: a rounded card on the glass. With the
              reader hidden it grows to fill; growth animates with the reader. */}
          <section
            className="panel panel-slide flex min-w-0 flex-col overflow-hidden"
            style={{
              flex: `${readerVisible ? 0 : 1} 1 ${layout.listShare * 100}%`,
              minWidth: LIST_WIDTH.min,
            }}
          >
            <div className="flex h-10 shrink-0 items-center gap-2 px-4">
              <h2 className="truncate text-sm font-semibold">
                {selectionTitle(selection, accountList, labels)}
              </h2>
              {checked.size > 0 && (
                <span className="ml-auto flex shrink-0 items-center gap-2 text-xs text-content/55">
                  {checked.size} selected
                  <button
                    type="button"
                    className="rounded px-1.5 py-0.5 hover:bg-selection hover:text-content"
                    onClick={() => setChecked(NONE)}
                    title="Clear selection (Esc)"
                  >
                    Clear
                  </button>
                </span>
              )}
            </div>
            <ThreadList
              threads={threads}
              accounts={accounts}
              showAccount={showAccount}
              selectedId={selectedId}
              checked={checked}
              onSelect={(id, how) => {
                // ⌘-click picks or unpicks one; ⇧-click picks a range.
                // Either way the open conversation stays as it is.
                if (how === "toggle") {
                  setChecked(toggleChecked(checked, selectedId, id));
                  return;
                }
                if (how === "range") {
                  setChecked(rangeChecked(threads, checked, selectedId, id));
                  return;
                }
                setChecked(NONE);
                // A conversation that's only a draft opens in the composer,
                // as in Gmail, rather than as a preview.
                if (threads.find((t) => t.id === id)?.onlyDraft) {
                  void resumeThreadDraft(id);
                  return;
                }
                setSelectedId(id);
                // Clicking the open conversation again also brings it back.
                setReaderOpen(true);
              }}
              // Nothing selected also slides the reader closed.
              onClearSelection={() => {
                setChecked(NONE);
                setSelectedId(null);
              }}
              // Not while the previous view's list stands in for this one.
              hasMore={(hasNextPage && !threadsQuery.isPlaceholderData) || fromGmail}
              loadMore={loadMore}
              loading={threadsQuery.isPending || isFetchingNextPage}
              older={older}
              empty={
                <EmptyState
                  state={emptyStateFor(selection.view)}
                  swapKey={emptyStateKey(selection.view)}
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
                width={Math.round(layout.listShare * panesWidth)}
                onResize={resizeList}
                onReset={() => saveLayout({ ...layout, listShare: LIST_SHARE.initial })}
              />
              {/* The reader sits on the glass like a right-hand sidebar. While
                  it slides closed it keeps showing the last conversation. */}
              <main className="flex min-w-0 flex-1 flex-col">
                {shownId !== null && (
                  <ThreadReader
                    threadId={shownId}
                    accounts={accounts}
                    renderFooter={(detail) => (
                      <ReplyArea
                        detail={detail}
                        identities={identities}
                        accounts={accountList}
                        onStart={(kind) => void compose.startReply(kind, detail.thread.id)}
                        onSend={(entry) => void compose.send(entry.draft)}
                      />
                    )}
                  />
                )}
              </main>
            </div>
          </div>
        </div>
      </div>
      {labelAnchor && targets.length > 0 && (
        <LabelPicker
          anchor={labelAnchor}
          labels={pickerLabels}
          targets={targets}
          onToggle={(label) => {
            const action = labelToggle(targets, label);
            act(action, targetIds);
            // Removing the label of the view you're in sends the
            // conversation away (and opens the next): the picker would now
            // be about a different conversation, so it closes.
            if (leavesView(action, selection.view)) setLabelAnchor(null);
          }}
          onClose={() => setLabelAnchor(null)}
        />
      )}
      {openCard && (
        <ComposeCard
          key={openCard.draft.id}
          entry={openCard}
          identities={identities}
          accounts={accountList}
          onSend={() => void compose.send(openCard.draft)}
        />
      )}
      <MinimizedTabs
        entries={composeState.cards.filter((c) => c.minimized)}
        accounts={accountList}
        besideCard={openCard !== undefined && cardSpot === "bottom-right"}
      />
      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  );
}
