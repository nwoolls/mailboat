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
import { panels, setSavedReaderOpen, setSidebarOpen } from "../features/layout/ui/panels";
import { Onboarding } from "../features/onboarding/ui/Onboarding";
import { onboarding, updateProgress } from "../features/onboarding/ui/progress";
import {
  finishedForExistingAccounts,
  showOnboarding,
} from "../features/onboarding/model/onboarding";
import {
  moveKeyboard,
  moveSelection,
  navKeyFor,
  rangeKeyFor,
} from "../features/mailbox/model/listNavigation";
import { pageReader, stepEmail } from "../features/reader/ui/readerKeys";
import {
  actionTargets,
  type Checked,
  NONE,
  prune,
  menuTargets,
  rangeBetween,
  rangeChecked,
  toggleChecked,
} from "../features/mailbox/model/multiSelect";
import {
  actionMessage,
  actionVerb,
  inverse,
  labelToggle,
  leavesView,
  moveAfterRemoval,
  selectionAfterUndo,
  type ThreadAction,
  deleteKeyAction,
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
  selectionKey,
  selectionNeedsAccount,
  selectionTitle,
  spansAccounts,
  systemSelection,
} from "../features/mailbox/model/views";
import { emptyStateFor, emptyStateKey, isFirstSync } from "../features/mailbox/model/emptyState";
import { EmptyState } from "../features/mailbox/ui/EmptyState";
import { EmptySpamButton } from "../features/mailbox/ui/EmptySpamButton";
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
import { ShowOriginalDialog } from "../features/reader/ui/ShowOriginalDialog";
import { VacationBanner } from "../features/vacation/ui/VacationBanner";
import type { SettingsSectionId } from "../features/settings/model/sections";
import { SettingsNav } from "../features/settings/ui/SettingsNav";
import { SettingsPage } from "../features/settings/ui/SettingsPage";
import { SettingsTitleBar } from "../features/settings/ui/SettingsTitleBar";
import { accountForNew } from "../features/compose/model/draft";
import { openCardEntry } from "../features/compose/model/composeState";
import { ComposeCard } from "../features/compose/ui/ComposeCard";
import { useSignIn } from "../features/accounts/ui/useSignIn";
import { SignedOutNotices, useSignedOutNotices } from "../features/accounts/ui/SignedOutNotices";
import { CodeNotices } from "../features/codes/ui/CodeNotices";
import { UpdateNotice } from "../features/updates/ui/UpdateNotice";
import { useUpdateEvents } from "../features/updates/ui/updateStore";
import { MinimizedTabs } from "../features/compose/ui/MinimizedTabs";
import { ReplyArea } from "../features/compose/ui/ReplyArea";
import {
  resumeThreadDraft,
  useCardSpot,
  useComposeActions,
  useComposeState,
  minimizeOpenCard,
} from "../features/compose/ui/useCompose";
import { useFeatureFlags } from "../shared/lib/featureFlags";
import { accelMatches, IS_MAC, primaryKey } from "../shared/lib/platform";
import { SEARCH_INPUT_ID } from "./TitleSearch";
import { rememberSearch } from "../features/search/ui/history";
import { LABEL_BUTTON_ID, Toolbar, type ToolbarActions } from "./Toolbar";
import {
  useAccounts,
  useAiStatus,
  useAppSettings,
  useIdentities,
  useLabels,
  useMailEvents,
  useOAuthSetup,
  usePrefetchAiReplyIdeas,
  useSyncStates,
  useThreads,
} from "../shared/lib/queries";
import { aiChoices, canSummarize, canWrite } from "../features/ai/model/providers";
import { openAssistantForNextReply } from "../features/ai/ui/assistantOpen";
import { requestSummary } from "../features/ai/ui/summaryRequests";
import { translateInMessage } from "../features/ai/ui/translations";
import { selectedInMessage } from "../features/reader/ui/MessageFrame";

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

/** PageDown / PageUp: how many rows a screenful of the list is (less one, to keep context). */
function listPageRows(): number {
  const list = document.querySelector<HTMLElement>('[role=listbox][aria-label="Conversations"]');
  const row = list?.querySelector<HTMLElement>("[role=option]");
  // Rows are 4px apart.
  if (!list || !row) return 10;
  return Math.max(1, Math.floor(list.clientHeight / (row.offsetHeight + 4)) - 1);
}

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

/**
 * The sidebar peek's timing: how long the pointer rests on the sidebar
 * button before it opens (so passing over the button doesn't open it),
 * how long after the pointer leaves that it closes (time to cross the gap
 * between the button and the panel), and how long it takes to slide out
 * (`peek-out` in index.css; sliding in is `peek-in`).
 */
const PEEK_OPEN_MS = 300;
const PEEK_CLOSE_MS = 280;
const PEEK_SLIDE_OUT_MS = 120;
/** Docking (the button clicked while peeking): as long as the panel slide
 * (`--motion-panel-duration`), so the two finish together. */
const PEEK_DOCK_MS = 220;

/** "docking": the button was clicked while peeking; the peek glides into
 * the sidebar's place as the sidebar opens under it, then goes. */
type Peek = "closed" | "open" | "leaving" | "docking";

export function Shell() {
  useMailEvents();
  useUpdateEvents();
  useIgnoreStrayDrops();
  const accountsQuery = useAccounts();
  const setup = useOAuthSetup();
  const onboardingProgress = onboarding.use();
  const syncStates = useSyncStates().data ?? [];
  // One browser sign-in at a time, for the sidebar and the signed-out notice.
  const signIn = useSignIn();
  const firstSyncing = syncStates.some(isFirstSync);
  const labels = useLabels({ kind: "all" }).data ?? [];
  const flags = useFeatureFlags();
  const accountList = useMemo(() => accountsQuery.data ?? [], [accountsQuery.data]);
  // Someone who had accounts before onboarding existed is recorded as past
  // it as soon as they are seen with accounts, so removing every account
  // later (however it happens) doesn't start it.
  const pastOnboarding = finishedForExistingAccounts(accountList.length, onboardingProgress);
  useEffect(() => {
    if (pastOnboarding) updateProgress(pastOnboarding);
  }, [pastOnboarding]);
  const signedOutNotices = useSignedOutNotices(accountList, syncStates);
  const accounts = useMemo(() => indexAccounts(accountList), [accountList]);
  const identities = useIdentities().data ?? [];
  const compose = useComposeActions(accountList);
  const composeState = useComposeState();
  const openCard = openCardEntry(composeState);
  const cardSpot = useCardSpot();

  // Until the user picks a view: every account's Inbox, or the inbox itself when
  // there is only one account.
  const [chosen, setChosen] = useState<Selection | null>(null);
  const onlyAccount = accountList.length === 1 ? accountList[0] : undefined;
  const baseSelection =
    chosen ?? (onlyAccount ? systemSelection("inbox", onlyAccount.id) : ALL_INBOXES);
  const [search, setSearch] = useState("");
  const { searchSpamTrash } = viewingPrefs.use();
  const selection: Selection = search.trim()
    ? {
        accounts: baseSelection.accounts,
        view: { kind: "search", text: search.trim(), withSpamTrash: searchSpamTrash },
      }
    : baseSelection;

  const showAccount = spansAccounts(selection, accountList.length);

  const threadsQuery = useThreads(selection);
  const threads = useMemo(
    () => threadsQuery.data?.pages.flatMap((p) => p.threads) ?? [],
    [threadsQuery.data],
  );
  const [selectedId, setSelectedId] = useState<ThreadId | null>(null);
  // The row selected without being previewed: closed with Esc, or moved
  // to with j/k while no preview shows. It stays highlighted, the buttons
  // and keys act on it, and Enter or `o` previews it. Previewing any
  // conversation (or leaving the view) drops it.
  const [cursorState, setCursorId] = useState<ThreadId | null>(null);
  if (selectedId !== null && cursorState !== null) setCursorId(null);
  const cursorId = threads.some((t) => t.id === cursorState) ? cursorState : null;
  // The conversation the buttons and keys act on: previewed or not.
  const chosenId = selectedId ?? cursorId;

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
  const [rangeEndState, setRangeEnd] = useState<ThreadId | null>(null);
  const rangeEnd = rangeEndState !== null && checked.has(rangeEndState) ? rangeEndState : null;
  const targets = actionTargets(threads, checked, chosenId);
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
  const [originalFor, setOriginalFor] = useState<ThreadId | null>(null);
  // A sender about to be blocked (a rule sending their mail to the Trash).
  const [blocking, setBlocking] = useState<{ accountId: AccountId; email: string } | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // The Settings page's section while it's open. The mail stays mounted
  // underneath (hidden), so closing returns to it exactly as it was.
  const [settings, setSettings] = useState<SettingsSectionId | null>(null);
  const openSettings = useCallback(() => setSettings((open) => open ?? "general"), []);
  // The app → Settings… (⌘,) in the menu bar.
  useEffect(() => {
    if (!IS_TAURI) return;
    const unlisten = events.openSettingsEvent.listen(openSettings);
    return () => void unlisten.then((fn) => fn());
  }, [openSettings]);
  // Settings covers the mail, so a message being written folds into its
  // tab at the bottom rather than floating over the Settings page.
  const settingsOpen = settings !== null;
  useEffect(() => {
    if (settingsOpen) minimizeOpenCard();
  }, [settingsOpen]);
  // When `g` was pressed, for Gmail's "go to" keys (0: not waiting).
  const goPending = useRef(0);
  const goTo = useCallback((s: Selection) => {
    setChosen(s);
    setSearch("");
    setSelectedId(null);
    setCursorId(null);
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
  // Either side panel can be hidden, down to just the list; remembered
  // between launches.
  // The reader's own state: whether it shows is remembered however it
  // changed (its button, Esc, Return, or a click bringing it back; owner,
  // 2026-10-24), so the next launch starts the way it was left.
  const sidebarOpen = panels.use().sidebarOpen;
  const [readerOpen, setReaderOpen] = useState(() => panels.get().readerOpen);
  useEffect(() => setSavedReaderOpen(readerOpen), [readerOpen]);
  // Opening a different conversation (a click, or j/k while it shows)
  // brings a hidden reader back. Adjusted during render, not in an effect.
  if (selectedId !== null && selectedId !== shownId) {
    setShownId(selectedId);
    setReaderOpen(true);
  }
  // While the sidebar is hidden, hovering its toolbar button floats it over
  // the list (as Notion Calendar does); it stays while the pointer is on
  // it and goes a moment after the pointer leaves both.
  const [peek, setPeek] = useState<Peek>("closed");
  const peekTimer = useRef(0);
  // Slides out, then goes (unless the pointer came back meanwhile).
  const closePeek = useCallback(() => {
    window.clearTimeout(peekTimer.current);
    // (A docking peek finishes docking.)
    setPeek((p) => (p === "closed" || p === "docking" ? p : "leaving"));
    peekTimer.current = window.setTimeout(
      () => setPeek((p) => (p === "leaving" ? "closed" : p)),
      PEEK_SLIDE_OUT_MS,
    );
  }, []);
  const hoverSidebar = useCallback(
    (inside: boolean) => {
      window.clearTimeout(peekTimer.current);
      if (inside && !panels.get().sidebarOpen) {
        // Back onto it while it slides out: it stays. Otherwise it opens
        // after a moment, unless the sidebar was pinned open meanwhile.
        setPeek((p) => (p === "leaving" ? "open" : p));
        peekTimer.current = window.setTimeout(
          () => setPeek((p) => (panels.get().sidebarOpen ? "closed" : p === "closed" ? "open" : p)),
          PEEK_OPEN_MS,
        );
      } else if (!inside) {
        peekTimer.current = window.setTimeout(closePeek, PEEK_CLOSE_MS);
      }
    },
    [closePeek],
  );
  const toggleSidebar = useCallback(() => {
    const opening = !panels.get().sidebarOpen;
    // Pinning it open while peeking: the peek becomes the sidebar instead
    // of the sidebar sliding in a second time behind it.
    setPeek((p) => (opening && (p === "open" || p === "leaving") ? "docking" : "closed"));
    window.setTimeout(() => setPeek((p) => (p === "docking" ? "closed" : p)), PEEK_DOCK_MS);
    setSidebarOpen(opening);
  }, []);
  const toggleReader = useCallback(() => {
    setReaderOpen(!readerOpen);
  }, [readerOpen]);
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
        const moved = moveAfterRemoval(
          threads,
          new Set(ids),
          { previewed: selectedId, selected: cursorId, previewing: readerOpen },
          viewingPrefs.get().afterRemoval,
        );
        setSelectedId(moved.previewed);
        setCursorId(moved.selected);
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
    [mutateThreads, selection.view, threads, selectedId, cursorId, readerOpen],
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
  // `mailto:` links (another app's, with the app the default email reader,
  // or one clicked in an email) open a new message, from the open
  // conversation's account if there is one. Links wait in Rust until the
  // accounts have loaded, so one that launched the app isn't lost.
  const { startFromMailto } = compose;
  const mailtoAccount =
    threads.find((t) => t.id === chosenId)?.accountId ??
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
  // A clicked new-mail notification opens its conversation, as in Mail:
  // in the list if it's there, otherwise from the Inbox (Settings, if
  // open, makes way). Read through a ref so the listener stays put.
  const openNotified = useRef<(id: ThreadId) => void>(() => {});
  useEffect(() => {
    openNotified.current = (id) => {
      setSettings(null);
      if (!threads.some((t) => t.id === id))
        goTo(onlyAccount ? systemSelection("inbox", onlyAccount.id) : ALL_INBOXES);
      setChecked(NONE);
      setSelectedId(id);
      setCursorId(id);
      setReaderOpen(true);
    };
  });
  useEffect(() => {
    if (!IS_TAURI) return;
    const unlisten = events.notificationOpenedEvent.listen(({ payload }) => {
      if (payload.threadId !== null) openNotified.current(payload.threadId);
    });
    return () => void unlisten.then((fn) => fn());
  }, []);
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
  const ai = aiChoices(useAppSettings().data);
  const aiStatus = useAiStatus().data;
  const prefetchIdeas = usePrefetchAiReplyIdeas();
  const commandsFor = (rows: ThreadSummary[]) =>
    conversationCommands(rows, {
      // The palette's own search box doesn't count as typing.
      editing: (editing && !paletteOpen) || settings !== null,
      canFilter: criteriaLikeThreads(rows, selfEmailsOf) !== null,
      blockEmail: senderToBlock(rows, selfEmailsOf)?.email ?? null,
      ai: { summarize: canSummarize(ai, aiStatus), write: canWrite(ai, aiStatus) },
    });
  const conversationList = commandsFor(targets);
  const appList = appCommands({
    sidebarOpen,
    readerOpen,
    hasConversation: chosenId !== null,
    hasAccounts: accountList.length > 0,
  });
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
      case "forward":
      case "replyAi":
      case "summarize": {
        const row = rows[0];
        if (!row) return;
        // Writing a reply happens in the conversation, so that one opens;
        // so does a summary, which shows above it.
        if (row.id !== selectedId) {
          setChecked(NONE);
          setSelectedId(row.id);
        }
        setReaderOpen(true);
        if (id === "summarize") {
          requestSummary(row.id);
          return;
        }
        if (id === "replyAi") {
          // As the reader's Reply with AI button: a plain Reply with the
          // writing assistant open, its chips started while it loads.
          openAssistantForNextReply(row.id);
          prefetchIdeas(row.id, ai.writingProvider);
        }
        void compose.startReply(id === "replyAi" ? "reply" : id, row.id);
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
      case "original":
        setOriginalFor(ids[0] ?? null);
        return;
      case "translate": {
        // What's selected in an email; the translation shows under it.
        const selected = selectedInMessage();
        if (selected) void translateInMessage(selected.messageId, selected.text);
        else showToast({ message: "Select text in an email to translate it." });
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
  const commandsRef = useRef(allCommands);
  useEffect(() => {
    runRef.current = runCommand;
    commandsRef.current = allCommands;
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
      // Windows has no menu bar: its shortcuts are matched here instead
      // (Ctrl for ⌘). The panels and the palette have their own below.
      if (!IS_MAC) {
        if (accelMatches(e, "Cmd+,")) {
          e.preventDefault();
          openSettings();
          return;
        }
        const command = commandsRef.current.find(
          (c) =>
            c.accel &&
            c.id !== "sidebar" &&
            c.id !== "reader" &&
            c.id !== "palette" &&
            accelMatches(e, c.accel),
        );
        if (command) {
          e.preventDefault();
          if (command.enabled) runRef.current(command.id);
          return;
        }
      }
      const panel = panelToggleFor(e);
      if (panel) {
        e.preventDefault();
        if (panel === "sidebar") toggleSidebar();
        else toggleReader();
        return;
      }
      // ⌘K (Ctrl+K): the command palette (inside the editor, ⌘K adds a link).
      if (accelMatches(e, "Cmd+K") && !isEditable(e.target)) {
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
      // Then hides the reader, exactly as its toolbar button does; the
      // conversation stays selected.
      if (e.key === "Escape" && selectedId !== null && readerOpen) {
        e.preventDefault();
        setReaderOpen(false);
        return;
      }
      // Undo the last archive, trash or label change: z (as in Gmail) or ⌘Z.
      if (
        !isEditable(e.target) &&
        lastUndo &&
        ((e.key === "z" && !e.metaKey && !e.ctrlKey && !e.altKey) ||
          (e.key === "z" && primaryKey(e) && !e.shiftKey))
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
      // Delete (⌫, or the forward delete key): Move to Trash or Archive,
      // as chosen in Settings → Viewing.
      if (plain && !e.shiftKey && (e.key === "Backspace" || e.key === "Delete")) {
        const action = deleteKeyAction(viewingPrefs.get().deleteKey, targets);
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
      // Writing a reply happens in the conversation, so it's previewed.
      if (replyKind && chosenId !== null) {
        e.preventDefault();
        setSelectedId(chosenId);
        setReaderOpen(true);
        void compose.startReply(replyKind, chosenId);
        return;
      }
      if (plain && e.key === "x" && chosenId !== null) {
        e.preventDefault();
        setChecked(toggleChecked(checked, chosenId, chosenId));
        return;
      }
      // Enter or `o` previews the selected row, showing the reader again
      // as its toolbar button does.
      if (
        plain &&
        (e.key === "o" || (e.key === "Enter" && e.target === document.body)) &&
        chosenId !== null &&
        !(readerOpen && selectedId !== null)
      ) {
        e.preventDefault();
        setSelectedId(chosenId);
        setReaderOpen(true);
        return;
      }
      const previewing = readerOpen && selectedId !== null;
      // Space / ⇧Space: the open email a screenful down or up (not on a
      // focused button, which Space presses).
      if (
        plain &&
        e.key === " " &&
        previewing &&
        !(e.target instanceof Element && e.target.closest("button, a"))
      ) {
        if (pageReader(e.shiftKey ? -1 : 1)) e.preventDefault();
        return;
      }
      // n / p: the next or previous email in the open conversation.
      if (plain && !e.shiftKey && (e.key === "n" || e.key === "p") && previewing) {
        if (stepEmail(e.key === "n" ? "next" : "prev")) e.preventDefault();
        return;
      }
      // ⇧↓ / ⇧↑: pick the rows from the selected one to here, as in Mail.
      const grow = rangeKeyFor(e, isEditable(e.target));
      if (grow) {
        e.preventDefault();
        if (chosenId === null) {
          setCursorId(moveSelection(threads, null, grow));
          return;
        }
        const end = moveSelection(threads, rangeEnd ?? chosenId, grow);
        if (end === null) return;
        setChecked(rangeBetween(threads, chosenId, end));
        setRangeEnd(end);
        return;
      }
      const nav = navKeyFor(e, isEditable(e.target));
      if (!nav) return;
      e.preventDefault();
      // With a preview showing, j/k preview the next one; without, they
      // only move the selection (owner, 2026-10-24).
      const moved = moveKeyboard(
        threads,
        { previewed: selectedId, selected: cursorId, previewing: readerOpen },
        nav,
        listPageRows(),
      );
      setSelectedId(moved.previewed);
      setCursorId(moved.selected);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    threads,
    selectedId,
    cursorId,
    chosenId,
    rangeEnd,
    readerOpen,
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
    openSettings,
    commandsRef,
    runRef,
  ]);

  if (accountsQuery.isPending) return null;
  if (showOnboarding(accountList.length, onboardingProgress))
    return <Onboarding setup={setup.data} accounts={accountList} />;

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
    <div className="relative flex h-full flex-col bg-glass-sidebar">
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
          hasSelection={chosenId !== null}
          count={targets.length}
          names={Object.fromEntries(allCommands.map((c) => [c.id, c.title]))}
          onToggleSidebar={toggleSidebar}
          onSidebarHover={hoverSidebar}
          onToggleReader={toggleReader}
          canCompose={accountList.length > 0}
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
            // Under the docking peek, already in place: no slide of its own.
            data-instant={peek === "docking" || undefined}
            style={{ width: sidebarWidth + SPLITTER_WIDTH }}
          >
            {/* Settings' sections cover the mail sidebar, which stays as it
                was (folds, scroll) underneath. While a peek docks over it,
                it's hidden (not faded), so its text isn't drawn twice, and
                shows again in the same frame the peek goes. */}
            <div
              className="relative flex shrink-0"
              style={{ visibility: peek === "docking" ? "hidden" : undefined }}
            >
              <div className={`flex ${settings ? "invisible" : ""}`} inert={settings !== null}>
                <Sidebar
                  accounts={accountList}
                  width={sidebarWidth}
                  syncStates={syncStates}
                  selection={baseSelection}
                  onSelect={goTo}
                  onAccountRemoved={onAccountRemoved}
                  onOpenSettings={openSettings}
                  signIn={signIn}
                  errorInNotice={signedOutNotices.list.some((a) => a.email === signIn.hint)}
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
        {(peek === "docking" || (peek !== "closed" && !sidebarShown)) && (
          // The hidden sidebar, floating over the list for a peek.
          <div
            // `on-glass` as the sidebar's own panel has, so its text is the
            // same weight and nothing changes when it hands over.
            className="sidebar-peek on-glass absolute top-10 bottom-2 left-2 z-30 flex overflow-hidden rounded-[10px] pt-1 pr-2"
            data-leaving={peek === "leaving" || undefined}
            data-docking={peek === "docking" || undefined}
            onPointerEnter={() => hoverSidebar(true)}
            onPointerLeave={() => hoverSidebar(false)}
            onKeyDown={(e) => {
              if (e.key === "Escape") closePeek();
            }}
          >
            <Sidebar
              accounts={accountList}
              width={sidebarWidth}
              syncStates={syncStates}
              selection={baseSelection}
              onSelect={goTo}
              onAccountRemoved={onAccountRemoved}
              onOpenSettings={openSettings}
              signIn={signIn}
              errorInNotice={signedOutNotices.list.some((a) => a.email === signIn.hint)}
            />
          </div>
        )}
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
                {checked.size === 0 &&
                  selection.view.kind === "system" &&
                  selection.view.label === "spam" &&
                  threads.length > 0 && <EmptySpamButton accounts={selection.accounts} />}
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
                viewKey={selectionKey(selection)}
                placeholder={threadsQuery.isPlaceholderData}
                threads={threads}
                onSwipe={(id, action) => act(action, [id])}
                accounts={accounts}
                showAccount={showAccount}
                selectedId={selectedId}
                cursorId={cursorId}
                keepInView={rangeEnd ?? chosenId}
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
                  // Opening one of its results means the search was used.
                  if (search.trim()) rememberSearch(search);
                }}
                // Nothing selected also slides the reader closed.
                onClearSelection={() => {
                  setChecked(NONE);
                  setSelectedId(null);
                  setCursorId(null);
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
                    state={emptyStateFor(selection.view, firstSyncing, accountList.length === 0)}
                    swapKey={emptyStateKey(selection.view, firstSyncing, accountList.length === 0)}
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
                onSelect={setSettings}
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
          onSwitch={(id, kind) => void compose.switchKind(id, kind)}
        />
      )}
      <div className="fixed top-12 right-3 z-50 flex flex-col gap-2">
        <SignedOutNotices
          list={signedOutNotices.list}
          onDismiss={signedOutNotices.dismiss}
          signIn={signIn}
        />
        <UpdateNotice />
        <CodeNotices
          onOpen={(id) => {
            setSelectedId(id);
            setReaderOpen(true);
          }}
        />
      </div>
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
            // The AI ones too, while AI isn't set up (Settings → AI).
            const reply = ["reply", "replyAll", "forward", "replyAi", "summarize"];
            if (reply.includes(c.id) && !c.enabled) return null;
            // About text selected in an email, not the row.
            if (c.id === "translate") return null;
            const line =
              (c.id === "archive" && list[0]?.enabled) ||
              c.id === "filterLike" ||
              c.id === "original";
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
            .filter((c) => c.id === "filterLike" || c.id === "block" || c.id === "original")
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
      {originalFor !== null && (
        <ShowOriginalDialog threadId={originalFor} onClose={() => setOriginalFor(null)} />
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
