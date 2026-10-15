import {
  ArchiveIcon,
  ComposeIcon,
  type IconProps,
  LabelIcon,
  MarkUnreadIcon,
  MoreIcon,
  StarIcon,
  TrashIcon,
} from "../shared/ui/icons";

/** Room for the macOS traffic lights at the left of the toolbar. */
const TRAFFIC_LIGHTS_WIDTH = 84;

type Props = {
  /** Toggle read/unread on the selected conversation (same as `u`), if any. */
  onToggleRead: (() => void) | null;
};

/**
 * Window title bar, Tern-style: drags the window and holds mail actions on
 * the right. Most actions arrive in Milestone 3; until then they only show
 * where they'll live.
 */
export function Toolbar({ onToggleRead }: Props) {
  return (
    <header
      data-tauri-drag-region
      className="flex h-10 shrink-0 items-center gap-0.5 pr-2"
      style={{ paddingLeft: TRAFFIC_LIGHTS_WIDTH }}
    >
      <div data-tauri-drag-region className="flex-1 self-stretch" />
      <ToolButton icon={ArchiveIcon} label="Archive" shortcut="e" />
      <ToolButton icon={TrashIcon} label="Delete" shortcut="#" />
      <ToolButton
        icon={MarkUnreadIcon}
        label="Mark read / unread"
        shortcut="u"
        onClick={onToggleRead ?? undefined}
        disabled={!onToggleRead}
      />
      <ToolButton icon={StarIcon} label="Star" shortcut="s" />
      <ToolButton icon={LabelIcon} label="Label" shortcut="l" />
      <ToolButton icon={MoreIcon} label="More" />
      <span className="mx-1.5 h-4 w-px bg-stroke" />
      <ToolButton icon={ComposeIcon} label="Compose" shortcut="c" />
    </header>
  );
}

function ToolButton({
  icon: Icon,
  label,
  shortcut,
  onClick,
  disabled,
}: {
  icon: (props: IconProps) => React.ReactNode;
  label: string;
  shortcut?: string;
  onClick?: () => void;
  disabled?: boolean;
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
      onClick={onClick}
      disabled={disabled}
      className="flex h-7 w-7 items-center justify-center rounded-md text-content/70 transition-colors duration-[120ms] hover:bg-selection hover:text-content disabled:opacity-35 disabled:hover:bg-transparent"
    >
      <Icon />
    </button>
  );
}
