import type { CommandId } from "../features/commands/model/commands";
import type { ThreadAction } from "../features/mailbox/model/threadActions";
import {
  ArchiveIcon,
  ComposeIcon,
  type IconProps,
  LabelIcon,
  MarkUnreadIcon,
  MoreIcon,
  MoveToInboxIcon,
  ReaderToggleIcon,
  RestoreIcon,
  SidebarToggleIcon,
  SpamIcon,
  StarIcon,
  TrashIcon,
} from "../shared/ui/icons";
import { TitleSearch } from "./TitleSearch";
import { accelLabel, IS_MAC } from "../shared/lib/platform";

/** Room for the macOS traffic lights at the left of the toolbar (Windows
 * keeps its window buttons in its own title bar). */
const TRAFFIC_LIGHTS_WIDTH = IS_MAC ? 80 : 8;

/** The Label button, which `l` also opens the picker under. */
export const LABEL_BUTTON_ID = "toolbar-label";

/** What a toggling button would do now, for the chosen conversations. */
type Toggle = { action: ThreadAction; run: () => void } | null;

export type ToolbarActions = {
  archive: Toggle;
  trash: Toggle;
  spam: Toggle;
  read: Toggle;
  star: Toggle;
  /** Opens (or closes) the label picker under the button. */
  label: ((button: HTMLElement) => void) | null;
  /** Opens (or closes) the More menu under the button. */
  more: ((button: HTMLElement) => void) | null;
};

type Props = {
  search: string;
  onSearch: (text: string) => void;
  /** Mail actions for the chosen conversations; null when nothing is chosen. */
  actions: ToolbarActions;
  sidebarOpen: boolean;
  /** A sync problem to flag on the sidebar toggle while the sidebar is hidden. */
  syncAttention: "warn" | "error" | null;
  readerOpen: boolean;
  /** A conversation is open: the reader can show. */
  hasSelection: boolean;
  /** How many conversations the actions apply to (named in tooltips if several). */
  count: number;
  /**
   * The commands' names (`features/commands`), so tooltips say what the
   * menu bar, right-click menu and ⌘K say.
   */
  names: Partial<Record<CommandId, string>>;
  onToggleSidebar: () => void;
  /** The pointer went onto (true) or off (false) the sidebar button. */
  onSidebarHover?: (inside: boolean) => void;
  onToggleReader: () => void;
  onCompose: () => void;
};

/**
 * Window title bar, Tern-style: drags the window and holds mail actions on
 * the right. Buttons that toggle (archive, trash, read, star) show what
 * they'd do now: archived mail offers "Move to Inbox", Trash "Restore".
 */
export function Toolbar({
  search,
  onSearch,
  actions,
  sidebarOpen,
  syncAttention,
  readerOpen,
  hasSelection,
  count,
  names,
  onToggleSidebar,
  onSidebarHover,
  onToggleReader,
  onCompose,
}: Props) {
  const many = count > 1 ? ` ${count} conversations` : "";
  const archive = actions.archive?.action;
  const trash = actions.trash?.action;
  const star = actions.star?.action;
  const moveToInbox = archive?.kind === "archive" && !archive.archived;
  const restore = trash?.kind === "trash" && !trash.trashed;
  const unstar = star?.kind === "star" && !star.starred;
  return (
    <header
      data-tauri-drag-region
      className="relative flex h-10 shrink-0 items-center gap-0.5 pr-2"
      style={{ paddingLeft: TRAFFIC_LIGHTS_WIDTH }}
    >
      <ToolButton
        icon={SidebarToggleIcon}
        label={names.sidebar ?? ""}
        shortcut={accelLabel("Ctrl+Cmd+S")}
        onClick={onToggleSidebar}
        onHover={onSidebarHover}
        pressed={sidebarOpen}
        dot={sidebarOpen ? null : syncAttention}
      />
      <div data-tauri-drag-region className="flex-1 self-stretch" />
      <TitleSearch value={search} onChange={onSearch} />
      {/* Conversation actions dim with nothing chosen. */}
      <ToolButton
        icon={moveToInbox ? MoveToInboxIcon : ArchiveIcon}
        label={(names.archive ?? "") + many}
        shortcut="e"
        onClick={actions.archive?.run}
        disabled={!actions.archive}
      />
      <ToolButton
        icon={restore ? RestoreIcon : TrashIcon}
        label={(names.trash ?? "") + many}
        shortcut="#"
        onClick={actions.trash?.run}
        disabled={!actions.trash}
      />
      <ToolButton
        icon={SpamIcon}
        label={(names.spam ?? "") + many}
        shortcut="!"
        onClick={actions.spam?.run}
        disabled={!actions.spam}
      />
      <ToolButton
        icon={MarkUnreadIcon}
        label={(names.read ?? "") + many}
        shortcut="u"
        onClick={actions.read?.run}
        disabled={!actions.read}
      />
      <ToolButton
        icon={StarIcon}
        label={(names.star ?? "") + many}
        shortcut="s"
        onClick={actions.star?.run}
        disabled={!actions.star}
        // Every chosen conversation is starred: the star lights up.
        pressed={unstar}
        tone={unstar ? "text-warn" : undefined}
      />
      <ToolButton
        id={LABEL_BUTTON_ID}
        icon={LabelIcon}
        label={(names.labels ?? "") + many}
        shortcut="l"
        onClick={actions.label ?? undefined}
        disabled={!actions.label}
      />
      <ToolButton
        icon={MoreIcon}
        label="More"
        onClick={actions.more ?? undefined}
        disabled={!actions.more}
      />
      <span className="mx-1.5 h-4 w-px bg-stroke" />
      <ToolButton icon={ComposeIcon} label={names.new ?? ""} shortcut="c" onClick={onCompose} />
      <span className="mx-1.5 h-4 w-px bg-stroke" />
      <ToolButton
        icon={ReaderToggleIcon}
        label={!hasSelection ? "Reader opens with a conversation" : (names.reader ?? "")}
        shortcut={accelLabel("Ctrl+Cmd+R")}
        onClick={onToggleReader}
        disabled={!hasSelection}
        pressed={readerOpen}
      />
    </header>
  );
}

function ToolButton({
  id,
  icon: Icon,
  label,
  shortcut,
  onClick,
  disabled,
  pressed,
  tone,
  dot,
  onHover,
}: {
  id?: string;
  icon: (props: IconProps) => React.ReactNode;
  label: string;
  shortcut?: string;
  onClick?: (button: HTMLElement) => void;
  disabled?: boolean;
  /** For toggles: whether the thing it controls is showing. */
  pressed?: boolean;
  /** Text colour class for the icon (e.g. a lit star). */
  tone?: string;
  /** Small status dot in the corner (e.g. a sync problem behind a hidden panel). */
  dot?: "warn" | "error" | null;
  /** The pointer went onto (true) or off (false) the button. */
  onHover?: (inside: boolean) => void;
}) {
  const soon = !onClick && !disabled;
  const title = [label, shortcut && `(${shortcut})`, soon && "· coming soon"]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      id={id}
      type="button"
      title={title}
      aria-label={label}
      aria-pressed={pressed}
      onClick={(e) => onClick?.(e.currentTarget)}
      onPointerEnter={onHover && (() => onHover(true))}
      onPointerLeave={onHover && (() => onHover(false))}
      disabled={disabled}
      className={`relative flex h-7 w-7 items-center justify-center rounded-md transition-colors duration-[120ms] hover:bg-selection hover:text-content disabled:opacity-35 disabled:hover:bg-transparent ${
        tone ?? "text-content/70"
      }`}
    >
      <Icon />
      {dot && (
        <span
          className={`absolute top-1 right-1 h-1.5 w-1.5 rounded-full ${
            dot === "error" ? "bg-danger" : "bg-warn"
          }`}
        />
      )}
    </button>
  );
}
