import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { commands, events } from "../platform/tauri/bindings";
import type { AccountId, ThreadId, ThreadSummary } from "../platform/tauri/bindings";
import { IS_TAURI, unwrap } from "../platform/tauri/ipc";
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
  menuTargets,
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
  selectionAfterUndo,
  type ThreadAction,
  toggleFor,
} from "../features/mailbox/model/threadActions";
import { LabelPicker } from "../features/mailbox/ui/LabelPicker";
import { ShortcutsHelp } from "../features/mailbox/ui/ShortcutsHelp";
import { GO_TO_MS, goToView } from "../features/mailbox/model/shortcuts";
import { useOlderMail } from "../features/mailbox/ui/useOlderMail";
import { useThreadAction } from "../features/mailbox/ui/useThreadAction";
import { anchorBelow, Menu, type MenuAnchor, MenuItem, MenuSeparator } from "../shared/ui/Menu";
import { MoreIcon } from "../shared/ui/icons";
import { COMMAND_ICONS } from "./commandIcons";
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
import { SCREENSAVER_EVENT, SCREENSAVERS } from "../features/screensaver/model/catalog";
import { viewingPrefs } from "../features/mailbox/ui/viewingPrefs";
import { ThreadList } from "../features/mailbox/ui/ThreadList";
import { ThreadReader } from "../features/reader/ui/ThreadReader";
import { destinations } from "../features/palette/model/destinations";
import { CommandPalette } from "../features/palette/ui/CommandPalette";
import { paletteItems } from "./paletteItems";
import {
  appCommands,
  type CommandId,
  conversationCommands,
  isCommandId,
  MENU_BAR,
  menuBarSpecs,
  type MenuState,
  menuStates,
} from "../features/commands/model/commands";
import { criteriaLikeThreads, senderToBlock } from "../features/rules/model/likeThis";
import { BlockSenderDialog } from "../features/rules/ui/BlockSenderDialog";
import { RuleEditor, type RuleEditorTarget } from "../features/rules/ui/RuleEditor";
import { VacationBanner } from "../features/vacation/ui/VacationBanner";
import type { SettingsSectionId } from "../features/settings/model/sections";
import { SettingsNav } from "../features/settings/ui/SettingsNav";
import { SettingsPage } from "../features/settings/ui/SettingsPage";
import { SettingsTitleBar } from "../features/settings/ui/SettingsTitleBar";
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
import { useFeatureFlags } from "../shared/lib/featureFlags";
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

/** How long the search text must stay the same before Gmail is asked. */
const SEARCH_SETTLE_MS = 700;

/** `value` once it has stayed the same for `ms` (until then, the previous one). */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return settled;
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
  const flags = useFeatureFlags();
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
  // The open conversation as of the last render, for actions to remember
  // what was open when they ran (Undo goes back to it).
  const openNow = useRef<ThreadId | null>(null);
  useEffect(() => {
    openNow.current = selectedId;
  });
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
  // A conversation's right-click menu, at the pointer.
  // A conversation's right-click menu: where, and which row was clicked.
  // It never opens the row (see `menuTargets`).
  const [rowMenu, setRowMenu] = useState<{ at: MenuAnchor; clicked: ThreadId } | null>(null);
  // The label picker opened from that menu acts on the menu's rows.
  const [labelFor, setLabelFor] = useState<ThreadId[] | null>(null);
  // The toolbar's More menu, under its button.
  const [moreAnchor, setMoreAnchor] = useState<MenuAnchor | null>(null);
  // A rule being made from mail ("Filter messages like these").
  const [ruleEditor, setRuleEditor] = useState<RuleEditorTarget | null>(null);
  // A sender about to be blocked (a rule sending their mail to the Trash).
  const [blocking, setBlocking] = useState<{ accountId: AccountId; email: string } | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // The Settings page's section while it's open. The mail stays mounted
  // underneath (hidden), so closing returns to it exactly as it was.
  const [settings, setSettings] = useState<SettingsSectionId | null>(null);
  const openSettings = useCallback(() => setSettings((open) => open ?? "general"), []);
  // Mailboat → Settings… (⌘,) in the menu bar.
  useEffect(() => {
    if (!IS_TAURI) return;
    const unlisten = events.openSettingsEvent.listen(openSettings);
    return () => void unlisten.then((fn) => fn());
  }, [openSettings]);
  // When `g` was pressed, for Gmail's "go to" keys (0: not waiting).
  const goPending = useRef(0);
  const goTo = useCallback((s: Selection) => {
    setChosen(s);
    setSearch("");
    setSelectedId(null);
  }, []);
  const { mutate: mutateThreads } = useThreadAction();
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = threadsQuery;
  // Past the last cached page, ask Gmail for older mail. Not while the
  // list is refreshing or standing in for the previous view.
  const older = useOlderMail(selection);
  const settled = !threadsQuery.isPlaceholderData && !threadsQuery.isFetching;
  // A search asks Gmail only once its text has stopped changing, not for
  // every half-typed word (local results still show as you type).
  const settledSearch = useSettled(search.trim(), SEARCH_SETTLE_MS);
  const searchReady = selection.view.kind !== "search" || settledSearch === search.trim();
  const fromGmail = !hasNextPage && settled && older.available && searchReady;
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
      const openBefore = openNow.current;
      if (leavesView(action, selection.view)) {
        const removed = new Set(ids);
        const { afterRemoval } = viewingPrefs.get();
        setSelectedId((current) => nextAfterRemoval(threads, removed, current, afterRemoval));
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
                  // Back to the conversation that was open, if this moved
                  // on from it; one that wasn't open (a swipe) stays closed.
                  if (leavesView(action, selection.view))
                    setSelectedId((current) => selectionAfterUndo(openBefore, ids, current));
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
  // `mailto:` links (another app's, with Mailboat the default email reader,
  // or one clicked in an email) open a new message, from the open
  // conversation's account if there is one. Links wait in Rust until the
  // accounts have loaded, so one that launched the app isn't lost.
  const { startFromMailto } = compose;
  const mailtoAccount =
    threads.find((t) => t.id === selectedId)?.accountId ??
    accountForNew(
      baseSelection.accounts,
      accountList.map((a) => a.id),
    );
  useEffect(() => {
    if (!IS_TAURI || mailtoAccount === undefined) return;
    const take = () =>
      void commands.mailtoTake().then((links) => {
        for (const link of links) void startFromMailto(mailtoAccount, link);
      });
    take();
    const unlisten = events.mailtoEvent.listen(take);
    return () => void unlisten.then((fn) => fn());
  }, [mailtoAccount, startFromMailto]);
  const [panesRef, panesWidth] = useElementWidth<HTMLDivElement>();
  const resizeSidebar = (w: number) =>
    saveLayout({ ...layout, sidebarWidth: clampWidth(w, SIDEBAR_WIDTH.min, SIDEBAR_WIDTH.max) });
  const resizeList = (w: number) =>
    saveLayout({ ...layout, listShare: listShareFor(w, panesWidth) });

  // Whether the focus is in a text field: the Message actions are off
  // then, so a menu shortcut can't archive anything mid-sentence.
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    // After the focus has settled (focusout fires before the next focusin).
    const check = () => window.setTimeout(() => setEditing(isEditable(document.activeElement)));
    document.addEventListener("focusin", check);
    document.addEventListener("focusout", check);
    return () => {
      document.removeEventListener("focusin", check);
      document.removeEventListener("focusout", check);
    };
  }, []);

  // The app's commands, named once for the menu bar, the right-click menu,
  // ⌘K and the toolbar (`features/commands`).
  const selfEmailsOf = (account: AccountId) =>
    identities.filter((i) => i.accountId === account).map((i) => i.email);
  const commandsFor = (rows: ThreadSummary[]) =>
    conversationCommands(rows, {
      // The palette's own search box doesn't count as typing.
      editing: (editing && !paletteOpen) || settings !== null,
      canFilter: criteriaLikeThreads(rows, selfEmailsOf) !== null,
      blockEmail: senderToBlock(rows, selfEmailsOf)?.email ?? null,
    });
  const conversationList = commandsFor(targets);
  const appList = appCommands({ sidebarOpen, readerOpen, hasConversation: selectedId !== null });
  const allCommands = [...conversationList, ...appList];

  /**
   * Runs a command on `rows` (the open or picked conversations, or the
   * right-clicked ones). Labels opens the picker at `labelsAt`, or under
   * the toolbar's Labels button.
   */
  const runCommand = (id: CommandId, rows = targets, labelsAt?: MenuAnchor) => {
    const command = commandsFor(rows).find((c) => c.id === id) ?? appList.find((c) => c.id === id);
    if (!command?.enabled) return;
    const ids = rows.map((t) => t.id);
    switch (id) {
      case "reply":
      case "replyAll":
      case "forward": {
        const row = rows[0];
        if (!row) return;
        // Writing a reply happens in the conversation, so that one opens.
        if (row.id !== selectedId) {
          setChecked(NONE);
          setSelectedId(row.id);
        }
        setReaderOpen(true);
        void compose.startReply(id, row.id);
        return;
      }
      case "archive":
      case "trash":
      case "read":
      case "star":
      case "spam":
        if (command.action) act(command.action, ids);
        return;
      case "labels": {
        const button = document.getElementById(LABEL_BUTTON_ID);
        const at = labelsAt ?? (button ? anchorBelow(button) : null);
        if (!at) return;
        setLabelFor(labelsAt ? ids : null);
        setLabelAnchor(at);
        return;
      }
      case "filterLike": {
        const like = criteriaLikeThreads(rows, selfEmailsOf);
        if (like)
          setRuleEditor({
            kind: "new",
            accountId: like.accountId,
            criteria: like.criteria,
            fromMail: true,
          });
        return;
      }
      case "block": {
        const who = senderToBlock(rows, selfEmailsOf);
        if (who) setBlocking(who);
        return;
      }
      case "new":
        startNew();
        return;
      case "search":
        document.getElementById(SEARCH_INPUT_ID)?.focus();
        return;
      case "sync":
        void commands.syncNow(null);
        return;
      case "sidebar":
        toggleSidebar();
        return;
      case "reader":
        toggleReader();
        return;
      case "palette":
        setPaletteOpen(true);
        return;
      case "shortcuts":
        setShortcutsOpen(true);
        return;
      default: {
        const view = goToView(id.slice(3));
        if (view) goTo({ accounts: baseSelection.accounts, view });
      }
    }
  };

  // The menu bar: built once with the commands, then kept up to date with
  // their names and on/off states. Its clicks come back as events.
  const runRef = useRef(runCommand);
  useEffect(() => {
    runRef.current = runCommand;
  });
  const menuStatesKey = JSON.stringify(menuStates(allCommands));
  const menuBuilt = useRef(false);
  useEffect(() => {
    if (!IS_TAURI) return;
    const states: MenuState[] = JSON.parse(menuStatesKey);
    if (menuBuilt.current) {
      void commands.menuBarUpdate(states.map(({ id, title, enabled }) => ({ id, title, enabled })));
      return;
    }
    menuBuilt.current = true;
    void commands.menuBarSet(menuBarSpecs(MENU_BAR, states));
  }, [menuStatesKey]);
  useEffect(() => {
    if (!IS_TAURI) return;
    const unlisten = events.menuCommandEvent.listen((e) => {
      if (isCommandId(e.payload)) runRef.current(e.payload);
    });
    return () => void unlisten.then((fn) => fn());
  }, [runRef]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Settings handles its own keys (Esc closes it).
      if (settings) return;
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
      // ⌘K: the command palette (inside the editor, ⌘K adds a link).
      if (e.key === "k" && e.metaKey && !e.ctrlKey && !e.altKey && !isEditable(e.target)) {
        e.preventDefault();
        setPaletteOpen(true);
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
      // `g` then a letter: go to a view (Gmail's keys), keeping the
      // accounts being viewed. The letter after `g` isn't its usual key.
      if (plain && e.key === "g") {
        e.preventDefault();
        goPending.current = performance.now();
        return;
      }
      if (plain && goPending.current && performance.now() - goPending.current < GO_TO_MS) {
        goPending.current = 0;
        const view = goToView(e.key);
        if (view) {
          e.preventDefault();
          goTo({ accounts: baseSelection.accounts, view });
          return;
        }
      }
      if (plain && e.key === "?") {
        e.preventDefault();
        setShortcutsOpen(true);
        return;
      }
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
        if (button) {
          setLabelFor(null);
          setLabelAnchor(anchorBelow(button));
        }
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
    goTo,
    baseSelection.accounts,
    settings,
  ]);

  if (accountsQuery.isPending) return null;
  if (accountList.length === 0) return <Welcome setup={setup.data} />;

  // Settings shows its sections in the sidebar, so the sidebar shows too.
  const sidebarShown = sidebarOpen || settings !== null;
  const onAccountRemoved = (id: AccountId) => {
    // Leave views that only showed that account's mail, and close its
    // conversation if one was open.
    if (chosen && selectionNeedsAccount(chosen, id, labels)) {
      setChosen(null);
      setSearch("");
    }
    if (threads.find((t) => t.id === selectedId)?.accountId === id) setSelectedId(null);
  };
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
        ? (button: HTMLElement) => {
            setLabelFor(null);
            setLabelAnchor((open) => (open ? null : anchorBelow(button)));
          }
        : null,
    more:
      targets.length > 0
        ? (button: HTMLElement) => setMoreAnchor((open) => (open ? null : anchorBelow(button)))
        : null,
  };
  // The label picker's conversations: the menu's rows if opened from it.
  const pickerRows = labelFor ? threads.filter((t) => labelFor.includes(t.id)) : targets;
  const pickerIds = pickerRows.map((t) => t.id);
  const pickerAccount = pickerRows[0]?.accountId;
  const pickerLabels = labels.filter((l) => l.accountId === pickerAccount);
  // The right-click menu's conversations, and what each action would do.
  const menuRows = rowMenu ? menuTargets(threads, checked, rowMenu.clicked) : [];

  return (
    <div className="flex h-full flex-col bg-glass-sidebar">
      {settings ? (
        <SettingsTitleBar section={settings} />
      ) : (
        <Toolbar
          search={search}
          onSearch={setSearch}
          actions={toolbarActions}
          sidebarOpen={sidebarOpen}
          syncAttention={syncAttention(syncStates)}
          readerOpen={readerOpen}
          hasSelection={selectedId !== null}
          count={targets.length}
          names={Object.fromEntries(allCommands.map((c) => [c.id, c.title]))}
          onToggleSidebar={toggleSidebar}
          onToggleReader={toggleReader}
          onCompose={startNew}
        />
      )}
      <div className="flex min-h-0 flex-1 pr-2 pb-2">
        {/* Panels stay mounted and slide: the wrapper animates its width and
            clips, while the content keeps its own width (no reflow) and fades
            in from the side. Closed, the sidebar leaves an 8px gutter. */}
        <div
          className="panel-slide on-glass flex shrink-0 overflow-hidden"
          style={{ width: sidebarShown ? sidebarWidth + SPLITTER_WIDTH : SPLITTER_WIDTH }}
          inert={!sidebarShown}
        >
          <div
            className="panel-slide-content flex shrink-0"
            data-open={sidebarShown}
            style={{ width: sidebarWidth + SPLITTER_WIDTH }}
          >
            {/* Settings' sections cover the mail sidebar, which stays as it
                was (folds, scroll) underneath. */}
            <div className="relative flex shrink-0">
              <div className={`flex ${settings ? "invisible" : ""}`} inert={settings !== null}>
                <Sidebar
                  accounts={accountList}
                  width={sidebarWidth}
                  syncStates={syncStates}
                  selection={baseSelection}
                  onSelect={goTo}
                  onAccountRemoved={onAccountRemoved}
                  onOpenSettings={openSettings}
                />
              </div>
              {settings && (
                <div className="absolute inset-0 flex">
                  <SettingsNav
                    section={settings}
                    width={sidebarWidth}
                    onSelect={setSettings}
                    onClose={() => setSettings(null)}
                  />
                </div>
              )}
            </div>
            <Splitter
              label="Resize sidebar"
              width={sidebarWidth}
              onResize={resizeSidebar}
              onReset={() => saveLayout({ ...layout, sidebarWidth: SIDEBAR_WIDTH.initial })}
            />
          </div>
        </div>
        <div className="relative flex min-w-0 flex-1">
          <div
            ref={panesRef}
            className={`flex min-w-0 flex-1 ${settings ? "invisible" : ""}`}
            inert={settings !== null}
          >
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
              <VacationBanner
                accounts={accountList}
                onOpenSettings={() => setSettings("vacation")}
              />
              <ThreadList
                threads={threads}
                onSwipe={(id, action) => act(action, [id])}
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
                // The menu is about the clicked row (or all picks, if it's
                // one); nothing opens, and the reader stays as it is.
                onRowMenu={(id, at) => setRowMenu({ at, clicked: id })}
                menuRowId={rowMenu?.clicked ?? null}
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
                          onSwitch={(id, kind) => void compose.switchKind(id, kind)}
                          onSend={(entry) => void compose.send(entry.draft)}
                        />
                      )}
                    />
                  )}
                </main>
              </div>
            </div>
          </div>
          {settings && (
            <div className="absolute inset-0 flex">
              <SettingsPage
                section={settings}
                accounts={accountList}
                syncStates={syncStates}
                onAccountRemoved={onAccountRemoved}
                onClose={() => setSettings(null)}
              />
            </div>
          )}
        </div>
      </div>
      {labelAnchor && pickerRows.length > 0 && (
        <LabelPicker
          anchor={labelAnchor}
          labels={pickerLabels}
          targets={pickerRows}
          onToggle={(label) => {
            const action = labelToggle(pickerRows, label);
            act(action, pickerIds);
            // Removing the label of the view you're in sends the
            // conversation away (and opens the next): the picker would now
            // be about a different conversation, so it closes.
            if (leavesView(action, selection.view)) setLabelAnchor(null);
          }}
          onCreate={(name) => {
            const account = pickerAccount;
            if (account === undefined) return;
            unwrap(commands.labelCreate(account, name))
              .then((label) => act({ kind: "labels", add: [label], remove: [] }, pickerIds))
              .catch((e: unknown) =>
                showToast({
                  tone: "error",
                  message: `Couldn’t create the label: ${e instanceof Error ? e.message : String(e)}`,
                }),
              );
          }}
          onClose={() => {
            setLabelAnchor(null);
            setLabelFor(null);
          }}
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
      {rowMenu && menuRows.length > 0 && (
        <Menu anchor={rowMenu.at} onClose={() => setRowMenu(null)} label="Conversation">
          {commandsFor(menuRows).map((c, _i, list) => {
            // Replies only for one conversation; a line after them, and
            // before the rules (where Gmail and Mail draw one too).
            if ((c.id === "reply" || c.id === "replyAll" || c.id === "forward") && !c.enabled)
              return null;
            const line = (c.id === "archive" && list[0]?.enabled) || c.id === "filterLike";
            return (
              <Fragment key={c.id}>
                {line && <MenuSeparator />}
                <MenuItem
                  icon={COMMAND_ICONS[c.id] ?? MoreIcon}
                  disabled={!c.enabled}
                  hint={c.key}
                  onSelect={() => {
                    const at = rowMenu.at;
                    setRowMenu(null);
                    runCommand(c.id, menuRows, at);
                  }}
                >
                  {c.title}
                </MenuItem>
              </Fragment>
            );
          })}
        </Menu>
      )}
      {moreAnchor && targets.length > 0 && (
        <Menu anchor={moreAnchor} onClose={() => setMoreAnchor(null)} label="More">
          {conversationList
            .filter((c) => c.id === "filterLike" || c.id === "block")
            .map((c) => (
              <MenuItem
                key={c.id}
                icon={COMMAND_ICONS[c.id] ?? MoreIcon}
                disabled={!c.enabled}
                onSelect={() => {
                  setMoreAnchor(null);
                  runCommand(c.id);
                }}
              >
                {c.title}
              </MenuItem>
            ))}
        </Menu>
      )}
      {blocking && (
        <BlockSenderDialog
          accountId={blocking.accountId}
          email={blocking.email}
          onClose={() => setBlocking(null)}
        />
      )}
      {ruleEditor && (
        <RuleEditor
          target={ruleEditor}
          accounts={accountList}
          onClose={() => setRuleEditor(null)}
        />
      )}
      {paletteOpen && (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          items={paletteItems({
            commands: allCommands,
            run: (id) => runCommand(id),
            openSettings,
            screensavers:
              flags.screensavers && threads.length === 0 && !threadsQuery.isPending
                ? SCREENSAVERS.map(({ id, label }) => ({ id, label }))
                : [],
            startScreensaver: (id) =>
              window.dispatchEvent(new CustomEvent(SCREENSAVER_EVENT, { detail: id })),
            destinations: destinations(accountList, labels),
            goTo,
          })}
        />
      )}
      {shortcutsOpen && <ShortcutsHelp onClose={() => setShortcutsOpen(false)} />}
      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  );
}
