import type {
  MenuEntry,
  MenuSpec as MenuBarSpec,
  ThreadSummary,
} from "../../../platform/tauri/bindings";
import { actionLabel, type ThreadAction, toggleFor } from "../../mailbox/model/threadActions";

/**
 * Every action the app offers in more than one place, with one name each:
 * the menu bar, the right-click menu, ⌘K and the toolbar's tooltips all
 * read them from here, so they can't drift apart.
 *
 * `key` is Mailboat's own keyboard shortcut (Gmail's single keys); `accel`
 * is the menu bar's (Mail's ⌘ shortcuts, in Tauri's accelerator form).
 */
export type Command = {
  id: CommandId;
  title: string;
  enabled: boolean;
  key?: string;
  accel?: string;
  /** For a conversation action: what it does to them. */
  action?: ThreadAction;
};

export type ToggleKind = "archive" | "trash" | "read" | "star" | "spam";

export type ConversationCommandId =
  | "reply"
  | "replyAll"
  | "forward"
  | "replyAi"
  | "summarize"
  | "translate"
  | ToggleKind
  | "labels"
  | "filterLike"
  | "block"
  | "original";

export type AppCommandId =
  | "new"
  | "search"
  | "sync"
  | "sidebar"
  | "reader"
  | "palette"
  | "shortcuts"
  | GoToId;

export type GoToId = `go:${"i" | "u" | "s" | "t" | "d" | "e" | "a"}`;

export type CommandId = ConversationCommandId | AppCommandId;

type Rows = Pick<
  ThreadSummary,
  "unread" | "inInbox" | "starred" | "inTrash" | "inSpam" | "onlyDraft"
>[];

const TOGGLES: { kind: ToggleKind; key: string; accel?: string; idle: string }[] = [
  // ⌘⌫ (Mail's Delete) is left out: in a text field it deletes the line.
  { kind: "archive", key: "e", accel: "Ctrl+Cmd+A", idle: "Archive" },
  { kind: "trash", key: "#", idle: "Move to Trash" },
  { kind: "read", key: "u", accel: "Shift+Cmd+U", idle: "Mark as read" },
  { kind: "star", key: "s", accel: "Shift+Cmd+L", idle: "Star" },
  { kind: "spam", key: "!", accel: "Shift+Cmd+J", idle: "Report spam" },
];

/**
 * What can be done to `rows` (the open or picked conversations, or a
 * right-clicked one). Names follow the rows ("Move to Inbox" once all are
 * archived). While typing in a field (`editing`), the actions that change
 * them are off, so a menu shortcut can't archive mid-sentence. The AI ones
 * are on while their provider is ready (Settings → AI).
 */
export function conversationCommands(
  rows: Rows,
  o: {
    editing: boolean;
    canFilter: boolean;
    blockEmail: string | null;
    ai: { summarize: boolean; write: boolean };
  },
): Command[] {
  const one = rows.length === 1 && !rows[0]!.onlyDraft;
  const some = rows.length > 0 && !o.editing;
  const commands: Command[] = [
    { id: "reply", title: "Reply", key: "r", accel: "Cmd+R", enabled: one },
    { id: "replyAll", title: "Reply all", key: "a", accel: "Shift+Cmd+R", enabled: one },
    { id: "forward", title: "Forward", key: "f", accel: "Shift+Cmd+F", enabled: one },
    { id: "replyAi", title: "Reply with AI", enabled: one && o.ai.write },
  ];
  for (const t of TOGGLES) {
    const action = toggleFor(t.kind, rows) ?? undefined;
    commands.push({
      id: t.kind,
      title: action ? actionLabel(action) : t.idle,
      key: t.key,
      accel: t.accel,
      enabled: some && action !== undefined,
      action,
    });
  }
  commands.push(
    { id: "labels", title: "Labels…", key: "l", enabled: some },
    {
      id: "filterLike",
      title: rows.length > 1 ? "Filter messages like these…" : "Filter messages like this…",
      enabled: some && o.canFilter,
    },
    {
      id: "block",
      title: o.blockEmail ? `Block ${o.blockEmail}…` : "Block sender…",
      enabled: some && o.blockEmail !== null,
    },
    // Mail's View → Message → Raw Source key. Only looks, so it works
    // while typing too.
    { id: "original", title: "Show original", accel: "Alt+Cmd+U", enabled: rows.length === 1 },
    { id: "summarize", title: "Summarize", enabled: one && o.ai.summarize },
    // Text selected in an email; says so if there's none. Only looks.
    {
      id: "translate",
      title: "Translate selection",
      accel: "Ctrl+Cmd+T",
      enabled: rows.length === 1,
    },
  );
  return commands;
}

/**
 * The views to go to, in the sidebar's order, numbered ⌘1 to ⌘7 in the
 * menu bar as Mail numbers its favourite mailboxes. Keyed by Gmail's
 * `g then …` letters (`u` and `e` are Mailboat's: Gmail has no Unread or
 * Archive view).
 */
const GO_TO: { id: GoToId; title: string }[] = [
  { id: "go:i", title: "Go to Inbox" },
  { id: "go:u", title: "Go to Unread" },
  { id: "go:s", title: "Go to Starred" },
  { id: "go:t", title: "Go to Sent" },
  { id: "go:d", title: "Go to Drafts" },
  { id: "go:e", title: "Go to Archive" },
  { id: "go:a", title: "Go to All Mail" },
];

/** The rest: writing, searching, panels, help and going to views. */
export function appCommands(o: {
  sidebarOpen: boolean;
  readerOpen: boolean;
  hasConversation: boolean;
}): Command[] {
  return [
    { id: "new", title: "New message", key: "c", accel: "Cmd+N", enabled: true },
    { id: "search", title: "Search mail", key: "/", enabled: true },
    { id: "sync", title: "Sync now", accel: "Shift+Cmd+N", enabled: true },
    {
      id: "sidebar",
      title: o.sidebarOpen ? "Hide sidebar" : "Show sidebar",
      key: "⌃⌘S",
      accel: "Ctrl+Cmd+S",
      enabled: true,
    },
    {
      id: "reader",
      title: o.readerOpen && o.hasConversation ? "Hide reader" : "Show reader",
      key: "⌃⌘R",
      accel: "Ctrl+Cmd+R",
      enabled: o.hasConversation,
    },
    { id: "palette", title: "Command palette", key: "⌘K", accel: "Cmd+K", enabled: true },
    { id: "shortcuts", title: "Keyboard shortcuts", key: "?", enabled: true },
    ...GO_TO.map(({ id, title }, i) => ({
      id,
      title,
      key: `g then ${id.slice(3)}`,
      accel: `Cmd+${i + 1}`,
      enabled: true,
    })),
  ];
}

/** A menu in the menu bar: commands by ID, with separators. */
export type MenuSpec = { title: string; items: (CommandId | "-")[] };

/**
 * The menu bar, as Mail lays it out. File and View join macOS's own
 * (Close Window, Enter Full Screen); Mailbox and Message are Mailboat's.
 */
export const MENU_BAR: MenuSpec[] = [
  { title: "File", items: ["new"] },
  { title: "View", items: ["sidebar", "reader", "-", "palette", "shortcuts"] },
  {
    title: "Mailbox",
    items: ["sync", "search", "-", "go:i", "go:u", "go:s", "go:t", "go:d", "go:e", "go:a"],
  },
  {
    title: "Message",
    items: [
      "reply",
      "replyAll",
      "forward",
      "replyAi",
      "-",
      "archive",
      "trash",
      "read",
      "star",
      "spam",
      "labels",
      "-",
      "filterLike",
      "block",
      "-",
      "original",
      "summarize",
      "translate",
    ],
  },
];

/** What a list of every command (shortcuts, IDs) passes for no conversation. */
export const NO_CONVERSATION = {
  editing: false,
  canFilter: false,
  blockEmail: null,
  ai: { summarize: false, write: false },
};

const ALL_IDS = new Set<string>(
  [
    ...conversationCommands([], NO_CONVERSATION),
    ...appCommands({ sidebarOpen: true, readerOpen: true, hasConversation: true }),
  ].map((c) => c.id),
);

/** Whether an ID (from the menu bar, say) names one of the commands. */
export function isCommandId(id: string): id is CommandId {
  return ALL_IDS.has(id);
}

/** What the menu bar needs to know of a command. */
export type MenuState = { id: string; title: string; enabled: boolean; accel: string | null };

export function menuStates(commands: Command[]): MenuState[] {
  return commands.map(({ id, title, enabled, accel }) => ({
    id,
    title,
    enabled,
    accel: accel ?? null,
  }));
}

/** The menus for Rust to build (`menu_bar_set`), commands filled in. */
export function menuBarSpecs(layout: MenuSpec[], states: MenuState[]): MenuBarSpec[] {
  const byId = new Map(states.map((s) => [s.id, s]));
  return layout.map((menu) => ({
    title: menu.title,
    items: menu.items.flatMap((item): MenuEntry[] => {
      if (item === "-") return [{ kind: "separator" as const }];
      const state = byId.get(item);
      return state ? [{ kind: "item" as const, ...state }] : [];
    }),
  }));
}

/** How a menu shortcut reads on screen: "Shift+Cmd+R" is ⇧⌘R. */
export function accelLabel(accel: string): string {
  const symbols: Record<string, string> = { Ctrl: "⌃", Alt: "⌥", Shift: "⇧", Cmd: "⌘" };
  const parts = accel.split("+");
  const key = parts.pop() ?? "";
  const order = ["Ctrl", "Alt", "Shift", "Cmd"];
  const mods = order.filter((m) => parts.includes(m)).map((m) => symbols[m]);
  return mods.join("") + key.toUpperCase();
}
