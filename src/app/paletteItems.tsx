import type { ThreadSummary } from "../platform/tauri/bindings";
import type { ComposeKind } from "../features/compose/model/draft";
import { actionLabel, type ThreadAction } from "../features/mailbox/model/threadActions";
import type { Selection } from "../features/mailbox/model/views";
import type { Destination } from "../features/palette/model/destinations";
import type { PaletteItem } from "../features/palette/ui/CommandPalette";
import {
  ArchiveIcon,
  ComposeIcon,
  ForwardIcon,
  InboxIcon,
  LabelIcon,
  MarkUnreadIcon,
  ReaderToggleIcon,
  ReplyAllIcon,
  ReplyIcon,
  SearchIcon,
  SidebarToggleIcon,
  SpamIcon,
  StarIcon,
  SyncIcon,
  TrashIcon,
} from "../shared/ui/icons";

type Toggle = { action: ThreadAction; run: () => void } | null;
type ToggleKind = "read" | "archive" | "star" | "trash" | "spam";

/**
 * Everything the palette offers right now: the open (or picked)
 * conversations' actions, writing and searching, the panels, and every
 * view to go to. Each says the key that does the same.
 */
export function paletteItems(p: {
  targets: ThreadSummary[];
  toggle: (kind: ToggleKind) => Toggle;
  startReply: (kind: Exclude<ComposeKind, "new">) => void;
  openLabels: () => void;
  startNew: () => void;
  focusSearch: () => void;
  syncNow: () => void;
  sidebarOpen: boolean;
  readerOpen: boolean;
  toggleSidebar: () => void;
  toggleReader: () => void;
  destinations: Destination[];
  goTo: (s: Selection) => void;
}): PaletteItem[] {
  const items: PaletteItem[] = [];
  const one = p.targets.length === 1 && !p.targets[0]!.onlyDraft;
  if (one) {
    items.push(
      {
        id: "reply",
        group: "Conversation",
        title: "Reply",
        shortcut: "r",
        icon: ReplyIcon,
        run: () => p.startReply("reply"),
      },
      {
        id: "replyAll",
        group: "Conversation",
        title: "Reply all",
        shortcut: "a",
        icon: ReplyAllIcon,
        run: () => p.startReply("replyAll"),
      },
      {
        id: "forward",
        group: "Conversation",
        title: "Forward",
        shortcut: "f",
        icon: ForwardIcon,
        run: () => p.startReply("forward"),
      },
    );
  }
  const toggles: [ToggleKind, string, PaletteItem["icon"]][] = [
    ["archive", "e", ArchiveIcon],
    ["trash", "#", TrashIcon],
    ["read", "u", MarkUnreadIcon],
    ["star", "s", StarIcon],
    ["spam", "!", SpamIcon],
  ];
  for (const [kind, shortcut, icon] of toggles) {
    const entry = p.toggle(kind);
    if (entry)
      items.push({
        id: kind,
        group: "Conversation",
        title: actionLabel(entry.action),
        shortcut,
        icon,
        run: entry.run,
      });
  }
  if (p.targets.length > 0)
    items.push({
      id: "labels",
      group: "Conversation",
      title: "Labels…",
      shortcut: "l",
      icon: LabelIcon,
      run: p.openLabels,
    });

  items.push(
    {
      id: "new",
      group: "Mail",
      title: "New message",
      shortcut: "c",
      icon: ComposeIcon,
      run: p.startNew,
    },
    {
      id: "search",
      group: "Mail",
      title: "Search mail",
      shortcut: "/",
      icon: SearchIcon,
      run: p.focusSearch,
    },
    { id: "sync", group: "Mail", title: "Sync now", icon: SyncIcon, run: p.syncNow },
    {
      id: "sidebar",
      group: "View",
      title: p.sidebarOpen ? "Hide sidebar" : "Show sidebar",
      shortcut: "⌃⌘S",
      icon: SidebarToggleIcon,
      run: p.toggleSidebar,
    },
    {
      id: "reader",
      group: "View",
      title: p.readerOpen ? "Hide reader" : "Show reader",
      shortcut: "⌃⌘R",
      icon: ReaderToggleIcon,
      run: p.toggleReader,
    },
  );
  for (const d of p.destinations)
    items.push({
      id: `go:${d.key}`,
      group: "Go to",
      title: d.title,
      detail: d.detail,
      icon: d.selection.view.kind === "userLabel" ? LabelIcon : InboxIcon,
      run: () => p.goTo(d.selection),
    });
  return items;
}
