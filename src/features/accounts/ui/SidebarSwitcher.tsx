import { useState } from "react";
import type { AccountFilter, AccountId, MailView } from "../../../platform/tauri/bindings";
import {
  MORE_ACCOUNT_VIEWS,
  sameSelection,
  selectionKey,
  type Selection,
  viewSelection,
  viewTitle,
} from "../../mailbox/model/views";
import { labelTree } from "../model/labelTree";
import { accountShortName, countText, unreadIn, viewUnread } from "../model/sidebar";
import {
  AccountProblem,
  AccountRing,
  Chevron,
  Fold,
  LabelRows,
  Row,
  type SidebarBodyProps,
  SubHeading,
  ViewItem,
  viewIcon,
} from "./sidebarParts";

const VIEWS: MailView[] = [
  { kind: "system", label: "inbox" },
  { kind: "system", label: "unread" },
  { kind: "system", label: "starred" },
  { kind: "system", label: "sent" },
  { kind: "system", label: "draft" },
  { kind: "archive" },
];

type Scope = "all" | AccountId;

/**
 * One set of views. Account chips at the top (All, then one per account)
 * choose whose mail they show, labels included, so nothing is listed twice.
 */
export function SidebarSwitcher(props: SidebarBodyProps) {
  const { accounts, labels, counts, syncStates, selection, onSelect, onReauth, isOpen, toggle } =
    props;
  const [scope, setScope] = useState<Scope>(() =>
    selection.accounts.kind === "only" && selection.accounts.ids.length === 1
      ? selection.accounts.ids[0]!
      : "all",
  );
  const multi = accounts.length > 1;
  const id = multi && scope !== "all" ? scope : undefined;
  const filter: AccountFilter = id === undefined ? { kind: "all" } : { kind: "only", ids: [id] };
  const select = (view: MailView) => onSelect(viewSelection(view, id));
  const moreSelections = MORE_ACCOUNT_VIEWS.map((v) => viewSelection(v, id));
  const moreOpen = isOpen("switcher:more");
  const shownAccounts = id === undefined ? accounts : accounts.filter((a) => a.id === id);

  const choose = (next: Scope) => {
    setScope(next);
    onSelect(viewSelection({ kind: "system", label: "inbox" }, next === "all" ? undefined : next));
  };

  return (
    <>
      {multi && (
        <div className="mt-2 mb-2 flex flex-wrap gap-1 px-1">
          <Chip
            selected={scope === "all"}
            onClick={() => choose("all")}
            count={unreadIn(counts, "INBOX", { kind: "all" })}
            title="All accounts"
          >
            All
          </Chip>
          {accounts.map((account) => (
            <Chip
              key={account.id}
              selected={scope === account.id}
              onClick={() => choose(account.id)}
              count={unreadIn(counts, "INBOX", { kind: "only", ids: [account.id] })}
              title={account.email}
            >
              <AccountRing account={account} />
              {accountShortName(account, accounts)}
            </Chip>
          ))}
        </div>
      )}
      {accounts.map((account) => (
        <AccountProblem
          key={account.id}
          state={syncStates.find((s) => s.accountId === account.id)}
          onReauth={() => onReauth(account)}
          name={multi ? accountShortName(account, accounts) : undefined}
        />
      ))}
      {VIEWS.map((view) => {
        const s = viewSelection(view, id);
        return (
          <ViewItem
            key={selectionKey(s)}
            icon={viewIcon(view)}
            title={
              view.kind === "system" && view.label === "inbox" && !id && multi
                ? "All Inboxes"
                : viewTitle(view)
            }
            count={viewUnread(counts, view, filter)}
            selected={sameSelection(selection, s)}
            onClick={() => select(view)}
          />
        );
      })}
      <Row
        title="More"
        icon={<Chevron open={moreOpen} />}
        expanded={moreOpen}
        selected={false}
        hint={!moreOpen && moreSelections.some((s: Selection) => sameSelection(selection, s))}
        onClick={() => toggle("switcher:more")}
      />
      <Fold open={moreOpen}>
        {MORE_ACCOUNT_VIEWS.map((view, i) => (
          <ViewItem
            key={selectionKey(moreSelections[i]!)}
            icon={viewIcon(view)}
            title={viewTitle(view)}
            depth={1}
            selected={sameSelection(selection, moreSelections[i]!)}
            onClick={() => select(view)}
          />
        ))}
      </Fold>
      {shownAccounts.map((account) => {
        const tree = labelTree(labels.filter((l) => l.accountId === account.id));
        if (tree.length === 0) return null;
        return (
          <div key={account.id}>
            <SubHeading>
              Labels
              {shownAccounts.length > 1 && (
                <>
                  <span className="text-content/30">·</span>
                  <AccountRing account={account} />
                  <span className="truncate">{accountShortName(account, accounts)}</span>
                </>
              )}
            </SubHeading>
            <LabelRows
              tree={tree}
              foldPrefix={String(account.id)}
              counts={counts}
              selection={selection}
              onSelect={onSelect}
              isOpen={isOpen}
              toggle={toggle}
            />
          </div>
        );
      })}
    </>
  );
}

function Chip({
  selected,
  onClick,
  count,
  title,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  count: number;
  title: string;
  children: React.ReactNode;
}) {
  const shown = countText(count);
  return (
    <button
      type="button"
      title={title}
      aria-pressed={selected}
      onClick={onClick}
      className={`flex h-6 max-w-full items-center gap-1.5 rounded-full px-2.5 text-xs transition-colors duration-[120ms] ${
        selected
          ? "bg-selection-strong text-content"
          : "bg-selection-subtle text-content/65 hover:bg-selection hover:text-content"
      }`}
    >
      <span className="flex min-w-0 items-center gap-1.5 truncate">{children}</span>
      {shown && <span className="text-content/45 tabular-nums">{shown}</span>}
    </button>
  );
}
