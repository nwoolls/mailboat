import { useState } from "react";
import type { Account, AccountSyncState, Label, MailView } from "../../../platform/tauri/bindings";
import { useLabels } from "../../../shared/lib/queries";
import {
  AddIcon,
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
import {
  labelSelection,
  MORE_ACCOUNT_VIEWS,
  PRIMARY_ACCOUNT_VIEWS,
  sameSelection,
  type Selection,
  selectionKey,
  UNIFIED_VIEWS,
  viewSelection,
  viewTitle,
} from "../../mailbox/model/views";
import { syncBadge } from "../model/accounts";
import { containsLabel, type LabelNode, labelTree } from "../model/labelTree";
import { AccountAvatar } from "./AccountAvatar";
import { useSignIn } from "./useSignIn";

type Icon = (props: IconProps) => React.ReactNode;

type Props = {
  accounts: Account[];
  width: number;
  syncStates: AccountSyncState[];
  selection: Selection;
  onSelect: (s: Selection) => void;
};

export function Sidebar({ accounts, width, syncStates, selection, onSelect }: Props) {
  const labels = useLabels({ kind: "all" }).data ?? [];
  const signIn = useSignIn();
  // Which folds are open ("More", label groups), per account. All start
  // closed; they reset on relaunch.
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <nav className="flex h-full shrink-0 flex-col" style={{ width }}>
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {accounts.length > 1 && (
          <Section title="All accounts">
            {UNIFIED_VIEWS.map((view) => {
              const s = viewSelection(view);
              return (
                <ViewItem
                  key={selectionKey(s)}
                  icon={viewIcon(view)}
                  selected={sameSelection(selection, s)}
                  onClick={() => onSelect(s)}
                  title={
                    view.kind === "system" && view.label === "inbox"
                      ? "All Inboxes"
                      : viewTitle(view)
                  }
                />
              );
            })}
          </Section>
        )}
        {accounts.map((account) => (
          <AccountSection
            key={account.id}
            account={account}
            labels={labels.filter((l) => l.accountId === account.id)}
            state={syncStates.find((s) => s.accountId === account.id)}
            selection={selection}
            onSelect={onSelect}
            onReauth={() => signIn.start(account.email)}
            isOpen={(key) => open.has(`${account.id}:${key}`)}
            onToggle={(key) => toggle(`${account.id}:${key}`)}
          />
        ))}
      </div>
      {/* A small icon bar, as in Arc's sidebar footer. Settings and the log
          console can join "Add account" here later. */}
      <div className="flex h-9 shrink-0 items-center gap-1 px-2 pb-1">
        {signIn.pending ? (
          <div className="flex min-w-0 flex-1 items-center gap-2 px-2 text-xs text-content/60">
            <span className="truncate">Waiting for browser sign-in…</span>
            <button
              type="button"
              className="ml-auto shrink-0 text-accent hover:underline"
              onClick={signIn.cancel}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            title="Add account"
            aria-label="Add account"
            className="flex h-7 w-7 items-center justify-center rounded-md text-content/60 transition-colors duration-[120ms] hover:bg-selection hover:text-content"
            onClick={() => signIn.start()}
          >
            <AddIcon size={16} />
          </button>
        )}
      </div>
      {signIn.error && <p className="selectable px-4 pb-2 text-xs text-danger">{signIn.error}</p>}
    </nav>
  );
}

function viewIcon(view: MailView): Icon {
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

function Section({
  title,
  children,
  aside,
}: {
  title: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <div className="mt-3">
      <div className="flex items-center gap-2 px-2 pb-1 text-[11px] font-medium tracking-wide text-content/45">
        <span className="truncate">{title}</span>
        {aside}
      </div>
      {children}
    </div>
  );
}

/** Every sidebar row: a 16px icon slot, then the name. */
function Row({
  title,
  selected,
  onClick,
  icon,
  depth = 0,
  expanded,
  hint,
}: {
  title: string;
  selected: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  depth?: number;
  /** For folds: whether it's open (sets aria-expanded). */
  expanded?: boolean;
  /** A collapsed fold that holds the current view gets a faint fill. */
  hint?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      aria-current={selected ? "page" : undefined}
      className={`flex h-7 w-full items-center gap-2 rounded-md pr-2 text-left transition-colors duration-[120ms] ${
        selected
          ? "bg-selection-strong text-content"
          : hint
            ? "bg-selection-subtle text-content/80"
            : "text-content/75 hover:bg-selection hover:text-content"
      }`}
      style={{ paddingLeft: 8 + depth * 16 }}
    >
      <span
        className={`flex w-4 shrink-0 justify-center ${selected ? "text-content" : "text-content/55"}`}
      >
        {icon}
      </span>
      <span className="truncate">{title}</span>
    </button>
  );
}

function ViewItem({ icon: Icon, ...rest }: { icon: Icon } & Omit<RowProps, "icon">) {
  return <Row {...rest} icon={<Icon size={15} />} />;
}
type RowProps = Parameters<typeof Row>[0];

/** A fold's chevron, turning down when open. */
function Chevron({ open }: { open: boolean }) {
  return (
    <ChevronIcon
      size={13}
      className={`transition-transform duration-[160ms] ease-out ${open ? "rotate-90" : ""}`}
    />
  );
}

/** Height-animated container for a fold's rows. */
function Fold({ open, children }: { open: boolean; children: React.ReactNode }) {
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
 * A label's color dot. Gmail allows very dark label colors that vanish on
 * the glass, so every dot gets a faint outline.
 */
function LabelDot({ color }: { color: string | null }) {
  return (
    <span
      className="h-2 w-2 rounded-full shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-content)_25%,transparent)]"
      style={{ background: color ?? "color-mix(in srgb, var(--color-content) 30%, transparent)" }}
    />
  );
}

function AccountSection({
  account,
  labels,
  state,
  selection,
  onSelect,
  onReauth,
  isOpen,
  onToggle,
}: {
  account: Account;
  labels: Label[];
  state: AccountSyncState | undefined;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onReauth: () => void;
  isOpen: (key: string) => boolean;
  onToggle: (key: string) => void;
}) {
  const badge = syncBadge(state);
  const tree = labelTree(labels);
  const selectedLabel = selection.view.kind === "userLabel" ? selection.view.labelId : null;
  const moreSelections = MORE_ACCOUNT_VIEWS.map((v) => viewSelection(v, account.id));
  const moreOpen = isOpen("more");

  const renderNode = (node: LabelNode, depth: number): React.ReactNode => {
    if (node.children.length === 0 && node.label) {
      const s = labelSelection(node.label);
      return (
        <Row
          key={node.key}
          title={node.name}
          depth={depth}
          icon={<LabelDot color={node.label.colorBg} />}
          selected={sameSelection(selection, s)}
          onClick={() => onSelect(s)}
        />
      );
    }
    const key = `label:${node.key}`;
    const groupOpen = isOpen(key);
    const own = node.label ? labelSelection(node.label) : null;
    return (
      <div key={node.key}>
        <Row
          title={node.name}
          depth={depth}
          icon={<Chevron open={groupOpen} />}
          expanded={groupOpen}
          selected={own !== null && sameSelection(selection, own)}
          hint={!groupOpen && selectedLabel !== null && containsLabel(node, selectedLabel)}
          onClick={() => {
            // A group that is also a label opens its mail and the fold.
            if (own) onSelect(own);
            if (!own || !groupOpen) onToggle(key);
          }}
        />
        <Fold open={groupOpen}>{node.children.map((c) => renderNode(c, depth + 1))}</Fold>
      </div>
    );
  };

  return (
    <Section title={account.email} aside={<AccountAvatar account={account} state={state} />}>
      {/* Only problems you can act on get a line; syncing and retrying stay
          on the avatar so the list below never jumps. */}
      {badge.tone === "error" && (
        <div className="flex items-start gap-1.5 px-2 pb-1 text-xs text-danger">
          <AlertIcon size={13} className="mt-px shrink-0" />
          {state?.status === "authError" ? (
            <button type="button" className="underline" onClick={onReauth}>
              {badge.label}
            </button>
          ) : (
            <span className="selectable">{badge.label}</span>
          )}
        </div>
      )}
      {PRIMARY_ACCOUNT_VIEWS.map((view) => {
        const s = viewSelection(view, account.id);
        return (
          <ViewItem
            key={selectionKey(s)}
            icon={viewIcon(view)}
            title={viewTitle(view)}
            selected={sameSelection(selection, s)}
            onClick={() => onSelect(s)}
          />
        );
      })}
      <Row
        title="More"
        icon={<Chevron open={moreOpen} />}
        expanded={moreOpen}
        selected={false}
        hint={!moreOpen && moreSelections.some((s) => sameSelection(selection, s))}
        onClick={() => onToggle("more")}
      />
      <Fold open={moreOpen}>
        {MORE_ACCOUNT_VIEWS.map((view, i) => {
          const s = moreSelections[i]!;
          return (
            <ViewItem
              key={selectionKey(s)}
              icon={viewIcon(view)}
              title={viewTitle(view)}
              depth={1}
              selected={sameSelection(selection, s)}
              onClick={() => onSelect(s)}
            />
          );
        })}
      </Fold>
      {tree.length > 0 && (
        <>
          <div className="px-2 pt-3 pb-1 text-[11px] font-medium tracking-wide text-content/45">
            Labels
          </div>
          {tree.map((node) => renderNode(node, 0))}
        </>
      )}
    </Section>
  );
}
