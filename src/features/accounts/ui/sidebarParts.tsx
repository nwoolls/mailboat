import type {
  Account,
  AccountSyncState,
  Label,
  LabelUnread,
  MailView,
} from "../../../platform/tauri/bindings";
import {
  AlertIcon,
  AllMailIcon,
  ArchiveIcon,
  ChevronIcon,
  DraftIcon,
  type IconProps,
  ImportantIcon,
  InboxIcon,
  SentIcon,
  SpamIcon,
  StarIcon,
  TrashIcon,
  UnreadIcon,
} from "../../../shared/ui/icons";
import { labelSelection, sameSelection, type Selection } from "../../mailbox/model/views";
import { syncBadge } from "../model/accounts";
import { containsLabel, type LabelNode } from "../model/labelTree";
import { countText } from "../model/sidebar";

/** What every sidebar layout gets. */
export type SidebarBodyProps = {
  accounts: Account[];
  labels: Label[];
  counts: LabelUnread[];
  syncStates: AccountSyncState[];
  selection: Selection;
  onSelect: (s: Selection) => void;
  onReauth: (account: Account) => void;
  /** Folds, by key; they reset on relaunch. */
  isOpen: (key: string) => boolean;
  toggle: (key: string) => void;
};

export type Icon = (props: IconProps) => React.ReactNode;

export function viewIcon(view: MailView): Icon {
  switch (view.kind) {
    case "allMail":
      return AllMailIcon;
    case "archive":
      return ArchiveIcon;
    case "system":
      return {
        inbox: InboxIcon,
        unread: UnreadIcon,
        starred: StarIcon,
        important: ImportantIcon,
        sent: SentIcon,
        draft: DraftIcon,
        spam: SpamIcon,
        trash: TrashIcon,
      }[view.label];
    default:
      return InboxIcon;
  }
}

/**
 * A sidebar section. Its header is a row like the others (28px). The title
 * lines up with the view icons on the left; an `aside` (the account avatar)
 * ends flush with the right edge of a selected row's highlight.
 */
export function Section({
  title,
  children,
  aside,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <div className="mt-2">
      <div className="mb-1 flex h-7 items-center gap-2 pl-2 text-[11px] font-medium tracking-wide text-content/45">
        <span className="flex min-w-0 items-center gap-2 truncate">{title}</span>
        {aside && <span className="ml-auto flex shrink-0">{aside}</span>}
      </div>
      {children}
    </div>
  );
}

/** A small heading inside a section ("Labels"). */
export function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-2 pt-3 pb-1 text-[11px] font-medium tracking-wide text-content/45">
      {children}
    </div>
  );
}

/**
 * Every sidebar row: a 16px icon slot, the name, then an unread count on
 * the right. `trailing` (a fold's chevron) sits outside the main button so
 * it can toggle without selecting.
 */
export function Row({
  title,
  selected,
  onClick,
  icon,
  depth = 0,
  expanded,
  hint,
  count = 0,
  trailing,
  strong,
}: {
  title: React.ReactNode;
  selected: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  depth?: number;
  /** For folds: whether it's open (sets aria-expanded). */
  expanded?: boolean;
  /** A collapsed fold that holds the current view gets a faint fill. */
  hint?: boolean;
  count?: number;
  trailing?: React.ReactNode;
  /** Slightly brighter, for account headers that act as rows. */
  strong?: boolean;
}) {
  const shown = countText(count);
  return (
    <div
      className={`flex h-7 w-full items-center rounded-md pr-1 transition-colors duration-[120ms] ${
        selected
          ? "bg-selection-strong text-content"
          : hint
            ? "bg-selection-subtle text-content/80"
            : `${strong ? "text-content/90" : "text-content/75"} hover:bg-selection hover:text-content`
      }`}
    >
      <button
        type="button"
        onClick={onClick}
        aria-expanded={expanded}
        aria-current={selected ? "page" : undefined}
        className="flex min-w-0 flex-1 items-center gap-2 self-stretch pr-1 text-left"
        style={{ paddingLeft: 8 + depth * 16 }}
      >
        <span
          className={`flex w-4 shrink-0 justify-center ${selected ? "text-content" : "text-content/55"}`}
        >
          {icon}
        </span>
        <span className="truncate">{title}</span>
        {shown && (
          <span
            className={`ml-auto shrink-0 text-xs tabular-nums ${selected ? "text-content/70" : "text-content/45"}`}
          >
            {shown}
          </span>
        )}
      </button>
      {trailing}
    </div>
  );
}

export function ViewItem({ icon: Icon, ...rest }: { icon: Icon } & Omit<RowProps, "icon">) {
  return <Row {...rest} icon={<Icon size={15} />} />;
}
type RowProps = Parameters<typeof Row>[0];

/** A fold's chevron, turning down when open. */
export function Chevron({ open }: { open: boolean }) {
  return (
    <ChevronIcon
      size={13}
      className={`transition-transform duration-[160ms] ease-out ${open ? "rotate-90" : ""}`}
    />
  );
}

/** A small chevron button at a row's right end that only opens or closes a fold. */
export function FoldToggle({
  open,
  onToggle,
  label,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={open ? `Hide ${label}` : `Show ${label}`}
      aria-expanded={open}
      onClick={onToggle}
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-content/40 hover:bg-selection hover:text-content"
    >
      <Chevron open={open} />
    </button>
  );
}

/** Height-animated container for a fold's rows. */
export function Fold({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div
      className={`grid transition-[grid-template-rows] duration-[180ms] ease-out ${
        open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
      }`}
      inert={!open}
    >
      <div className="overflow-hidden">{children}</div>
    </div>
  );
}

/**
 * The account's mark, as on list rows: a hollow ring in a softened account
 * colour, so it never reads as an unread dot.
 */
export function AccountRing({ account }: { account: Pick<Account, "color" | "email"> }) {
  return (
    <span
      className="h-2 w-2 shrink-0 rounded-full"
      style={{ border: `1.5px solid color-mix(in srgb, ${account.color} 75%, transparent)` }}
      title={account.email}
    />
  );
}

/**
 * A label's colour dot, only for labels given a colour in Gmail (the grey
 * dots on every other label were noise). Gmail allows very dark colours
 * that vanish on the glass, so each gets a faint outline.
 */
function LabelDot({ color }: { color: string | null }) {
  if (!color) return null;
  return (
    <span
      className="h-2 w-2 rounded-full shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-content)_25%,transparent)]"
      style={{ background: color }}
    />
  );
}

/** An account's labels as rows, groups folding open. */
export function LabelRows({
  tree,
  depth = 0,
  foldPrefix,
  counts,
  selection,
  onSelect,
  isOpen,
  toggle,
}: {
  tree: LabelNode[];
  depth?: number;
  /** Keeps fold keys apart between accounts. */
  foldPrefix: string;
  counts: LabelUnread[];
  selection: Selection;
  onSelect: (s: Selection) => void;
  isOpen: (key: string) => boolean;
  toggle: (key: string) => void;
}) {
  const selectedLabel = selection.view.kind === "userLabel" ? selection.view.labelId : null;
  const countOf = (label: Label | null) =>
    label ? (counts.find((c) => c.labelId === label.id)?.unread ?? 0) : 0;
  const render = (node: LabelNode, d: number): React.ReactNode => {
    if (node.children.length === 0 && node.label) {
      const s = labelSelection(node.label);
      return (
        <Row
          key={node.key}
          title={node.name}
          depth={d}
          icon={<LabelDot color={node.label.colorBg} />}
          count={countOf(node.label)}
          selected={sameSelection(selection, s)}
          onClick={() => onSelect(s)}
        />
      );
    }
    const key = `${foldPrefix}:label:${node.key}`;
    const groupOpen = isOpen(key);
    const own = node.label ? labelSelection(node.label) : null;
    return (
      <div key={node.key}>
        <Row
          title={node.name}
          depth={d}
          icon={<Chevron open={groupOpen} />}
          expanded={groupOpen}
          count={countOf(node.label)}
          selected={own !== null && sameSelection(selection, own)}
          hint={!groupOpen && selectedLabel !== null && containsLabel(node, selectedLabel)}
          onClick={() => {
            // A group that is also a label opens its mail and the fold.
            if (own) onSelect(own);
            if (!own || !groupOpen) toggle(key);
          }}
        />
        <Fold open={groupOpen}>{node.children.map((c) => render(c, d + 1))}</Fold>
      </div>
    );
  };
  return <>{tree.map((node) => render(node, depth))}</>;
}

/**
 * Only problems you can act on get a line; syncing and retrying stay on
 * the avatar so the list never jumps.
 */
export function AccountProblem({
  state,
  onReauth,
  name,
}: {
  state: AccountSyncState | undefined;
  onReauth: () => void;
  /** Named when the line isn't already under the account's own header. */
  name?: string;
}) {
  const badge = syncBadge(state);
  if (badge.tone !== "error") return null;
  return (
    <div className="flex items-start gap-1.5 px-2 pb-1 text-xs text-danger">
      <AlertIcon size={13} className="mt-px shrink-0" />
      {name && <span className="shrink-0">{name}:</span>}
      {state?.status === "authError" ? (
        <button type="button" className="underline" onClick={onReauth}>
          {badge.label}
        </button>
      ) : (
        <span className="selectable">{badge.label}</span>
      )}
    </div>
  );
}
