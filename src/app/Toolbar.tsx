import {
  ArchiveIcon,
  ComposeIcon,
  type IconProps,
  LabelIcon,
  MarkUnreadIcon,
  MoreIcon,
  ReaderToggleIcon,
  SidebarToggleIcon,
  StarIcon,
  TrashIcon,
} from "../shared/ui/icons";
import { TitleSearch } from "./TitleSearch";

/** Room for the macOS traffic lights at the left of the toolbar. */
const TRAFFIC_LIGHTS_WIDTH = 80;

type Props = {
  search: string;
  onSearch: (text: string) => void;
  /** Toggle read/unread on the selected conversation (same as `u`), if any. */
  onToggleRead: (() => void) | null;
  sidebarOpen: boolean;
  /** A sync problem to flag on the sidebar toggle while the sidebar is hidden. */
  syncAttention: "warn" | "error" | null;
  readerOpen: boolean;
  /** A conversation is selected: the reader can show, and actions apply. */
  hasSelection: boolean;
  onToggleSidebar: () => void;
  onToggleReader: () => void;
};

/**
 * Window title bar, Tern-style: drags the window and holds mail actions on
 * the right. Most actions arrive in Milestone 3; until then they only show
 * where they'll live.
 */
export function Toolbar({
  search,
  onSearch,
  onToggleRead,
  sidebarOpen,
  syncAttention,
  readerOpen,
  hasSelection,
  onToggleSidebar,
  onToggleReader,
}: Props) {
  return (
    <header
      data-tauri-drag-region
      className="relative flex h-10 shrink-0 items-center gap-0.5 pr-2"
      style={{ paddingLeft: TRAFFIC_LIGHTS_WIDTH }}
    >
      <ToolButton
        icon={SidebarToggleIcon}
        label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
        shortcut="⌃⌘S"
        onClick={onToggleSidebar}
        pressed={sidebarOpen}
        dot={sidebarOpen ? null : syncAttention}
      />
      <div data-tauri-drag-region className="flex-1 self-stretch" />
      <TitleSearch value={search} onChange={onSearch} />
      {/* Conversation actions dim with nothing selected. */}
      <ToolButton icon={ArchiveIcon} label="Archive" shortcut="e" disabled={!hasSelection} />
      <ToolButton icon={TrashIcon} label="Delete" shortcut="#" disabled={!hasSelection} />
      <ToolButton
        icon={MarkUnreadIcon}
        label="Mark read / unread"
        shortcut="u"
        onClick={onToggleRead ?? undefined}
        disabled={!onToggleRead}
      />
      <ToolButton icon={StarIcon} label="Star" shortcut="s" disabled={!hasSelection} />
      <ToolButton icon={LabelIcon} label="Label" shortcut="l" disabled={!hasSelection} />
      <ToolButton icon={MoreIcon} label="More" disabled={!hasSelection} />
      <span className="mx-1.5 h-4 w-px bg-stroke" />
      <ToolButton icon={ComposeIcon} label="Compose" shortcut="c" />
      <span className="mx-1.5 h-4 w-px bg-stroke" />
      <ToolButton
        icon={ReaderToggleIcon}
        label={
          !hasSelection
            ? "Reader opens with a conversation"
            : readerOpen
              ? "Hide reader"
              : "Show reader"
        }
        shortcut="⌃⌘R"
        onClick={onToggleReader}
        disabled={!hasSelection}
        pressed={readerOpen}
      />
    </header>
  );
}

function ToolButton({
  icon: Icon,
  label,
  shortcut,
  onClick,
  disabled,
  pressed,
  dot,
}: {
  icon: (props: IconProps) => React.ReactNode;
  label: string;
  shortcut?: string;
  onClick?: () => void;
  disabled?: boolean;
  /** For toggles: whether the thing it controls is showing. */
  pressed?: boolean;
  /** Small status dot in the corner (e.g. a sync problem behind a hidden panel). */
  dot?: "warn" | "error" | null;
}) {
  const soon = !onClick && !disabled;
  const title = [label, shortcut && `(${shortcut})`, soon && "· coming soon"]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type="button"
      title={title}
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      disabled={disabled}
      className="relative flex h-7 w-7 items-center justify-center rounded-md text-content/70 transition-colors duration-[120ms] hover:bg-selection hover:text-content disabled:opacity-35 disabled:hover:bg-transparent"
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
