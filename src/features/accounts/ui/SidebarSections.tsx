import {
  MORE_ACCOUNT_VIEWS,
  PRIMARY_ACCOUNT_VIEWS,
  sameSelection,
  selectionKey,
  UNIFIED_VIEWS,
  viewSelection,
  viewTitle,
} from "../../mailbox/model/views";
import { labelTree } from "../model/labelTree";
import { countText } from "../model/sidebar";
import { anchorBelow } from "../../../shared/ui/Menu";
import { AccountAvatar } from "./AccountAvatar";
import {
  AccountProblem,
  AccountRing,
  Chevron,
  Fold,
  LabelRows,
  Row,
  Section,
  type SidebarBodyProps,
  ViewItem,
  viewIcon,
} from "./sidebarParts";

/**
 * "All accounts" views, then a section per account. Unread counts sit on
 * the right; each account's header shows its ring and address and folds
 * the whole account away (open by default, with its Inbox count shown
 * while folded); its labels sit in their own fold, closed by default.
 */
export function SidebarSections(props: SidebarBodyProps) {
  const {
    accounts,
    labels,
    countFor,
    syncStates,
    selection,
    onSelect,
    onReauth,
    onAccountMenu,
    isOpen,
    toggle,
  } = props;
  return (
    <>
      {accounts.length > 1 && (
        <Section title="All accounts">
          {UNIFIED_VIEWS.map((view) => {
            const s = viewSelection(view);
            return (
              <ViewItem
                key={selectionKey(s)}
                icon={viewIcon(view)}
                count={countFor(view, s.accounts)}
                selected={sameSelection(selection, s)}
                onClick={() => onSelect(s)}
                title={
                  view.kind === "system" && view.label === "inbox" ? "All Inboxes" : viewTitle(view)
                }
              />
            );
          })}
        </Section>
      )}
      {accounts.map((account) => {
        const filter = { kind: "only" as const, ids: [account.id] };
        // Stored as "collapsed" so accounts start open.
        const accountOpen = !isOpen(`${account.id}:collapsed`);
        const moreOpen = isOpen(`${account.id}:more`);
        const labelsOpen = isOpen(`${account.id}:labels`);
        const tree = labelTree(labels.filter((l) => l.accountId === account.id));
        const moreSelections = MORE_ACCOUNT_VIEWS.map((v) => viewSelection(v, account.id));
        const state = syncStates.find((s) => s.accountId === account.id);
        const inboxCount = countFor({ kind: "system", label: "inbox" }, filter);
        return (
          <Section
            key={account.id}
            onContextMenu={(e) => {
              e.preventDefault();
              onAccountMenu(account, { x: e.clientX, y: e.clientY });
            }}
            title={
              <button
                type="button"
                className="flex min-w-0 items-center gap-2 hover:text-content"
                aria-expanded={accountOpen}
                onClick={() => toggle(`${account.id}:collapsed`)}
              >
                <AccountRing account={account} />
                <span className="truncate">{account.email}</span>
                <Chevron open={accountOpen} />
              </button>
            }
            aside={
              <span className="flex items-center gap-2">
                {!accountOpen && countText(inboxCount) && (
                  <span className="text-xs text-content/45 tabular-nums">
                    {countText(inboxCount)}
                  </span>
                )}
                {/* The avatar opens the account's menu (sync now, remove). */}
                <button
                  type="button"
                  aria-label={`${account.email} menu`}
                  aria-haspopup="menu"
                  className="-m-1 rounded-full p-1 hover:bg-selection"
                  onClick={(e) => onAccountMenu(account, anchorBelow(e.currentTarget))}
                >
                  <AccountAvatar account={account} state={state} />
                </button>
              </span>
            }
          >
            <AccountProblem state={state} onReauth={() => onReauth(account)} />
            <Fold open={accountOpen}>
              {PRIMARY_ACCOUNT_VIEWS.map((view) => {
                const s = viewSelection(view, account.id);
                return (
                  <ViewItem
                    key={selectionKey(s)}
                    icon={viewIcon(view)}
                    title={viewTitle(view)}
                    count={countFor(view, filter)}
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
                onClick={() => toggle(`${account.id}:more`)}
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
                  <Row
                    title="Labels"
                    icon={<Chevron open={labelsOpen} />}
                    expanded={labelsOpen}
                    selected={false}
                    hint={
                      !labelsOpen &&
                      selection.view.kind === "userLabel" &&
                      selection.accounts.kind === "only" &&
                      selection.accounts.ids[0] === account.id
                    }
                    onClick={() => toggle(`${account.id}:labels`)}
                  />
                  <Fold open={labelsOpen}>
                    <LabelRows
                      tree={tree}
                      depth={1}
                      foldPrefix={String(account.id)}
                      countFor={countFor}
                      selection={selection}
                      onSelect={onSelect}
                      isOpen={isOpen}
                      toggle={toggle}
                    />
                  </Fold>
                </>
              )}
            </Fold>
          </Section>
        );
      })}
    </>
  );
}
