import type { Command, CommandId } from "../features/commands/model/commands";
import {
  AiIcon,
  ArchiveIcon,
  TranslateIcon,
  BlockIcon,
  ComposeIcon,
  ForwardIcon,
  type IconProps,
  LabelIcon,
  MarkReadIcon,
  MarkUnreadIcon,
  PrintIcon,
  ReaderToggleIcon,
  ReplyAllIcon,
  ReplyIcon,
  RulesIcon,
  SearchIcon,
  SentIcon,
  SidebarToggleIcon,
  SourceIcon,
  SpamIcon,
  StarIcon,
  SyncIcon,
  TrashIcon,
} from "../shared/ui/icons";

/** Each command's icon, wherever it's listed (palette, right-click menu). */
const COMMAND_ICONS: Partial<Record<CommandId, (props: IconProps) => React.ReactNode>> = {
  reply: ReplyIcon,
  replyAll: ReplyAllIcon,
  forward: ForwardIcon,
  replyAi: AiIcon,
  sendAgain: SentIcon,
  summarize: AiIcon,
  translate: TranslateIcon,
  archive: ArchiveIcon,
  trash: TrashIcon,
  read: MarkReadIcon,
  star: StarIcon,
  spam: SpamIcon,
  labels: LabelIcon,
  filterLike: RulesIcon,
  block: BlockIcon,
  original: SourceIcon,
  print: PrintIcon,
  new: ComposeIcon,
  search: SearchIcon,
  sync: SyncIcon,
  sidebar: SidebarToggleIcon,
  reader: ReaderToggleIcon,
};

/**
 * A command's icon for what it will do now: Mark as read an open envelope,
 * Mark as unread a closed one, as Gmail shows them.
 */
export function commandIcon(c: Pick<Command, "id" | "action">) {
  if (c.id === "read" && c.action?.kind === "read" && !c.action.read) return MarkUnreadIcon;
  return COMMAND_ICONS[c.id];
}
