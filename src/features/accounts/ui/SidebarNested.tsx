import type { MailView } from "../../../platform/tauri/bindings";
import { sameSelection, selectionKey, viewSelection, viewTitle } from "../../mailbox/model/views";
import { labelTree } from "../model/labelTree";
import { accountShortName, viewUnread } from "../model/sidebar";
import { AccountAvatar } from "./AccountAvatar";
import {
  AccountProblem,
  AccountRing,
  Chevron,
  Fold,
  FoldToggle,
  LabelRows,
  Row,
  type SidebarBodyProps,
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
const MORE_VIEWS: MailView[] = [
  { kind: "allMail" },
  { kind: "system", label: "important" },
  { kind: "system", label: "spam" },
  { kind: "system", label: "trash" },
];

/**
 * As in Mimestream and Apple Mail: one set of views over all accounts.
 * Each view's chevron unfolds a row per account (Inbox starts unfolded).
 * Below, each account gets a header that folds its labels (closed by
 * default).
 */
export function SidebarNested(props: SidebarBodyProps) {
  const { accounts, labels, counts, syncStates, selection, onSelect, onReauth, isOpen, toggle } =
    props;
  const multi = accounts.length > 1;
  const moreOpen = isOpen("nested:more");

  const viewRow = (view: MailView, depth: number) => {
    const s = viewSelection(view);
    const key = `nested:${selectionKey(s)}`;
    // Stored as "closed" for Inbox so it starts open; the rest start closed.
    const isInbox = view.kind === "system" && view.label === "inbox";
    const open = isInbox ? !isOpen(`${key}:closed`) : isOpen(key);
    const flip = () => toggle(isInbox ? `${key}:closed` : key);
    const children = accounts.map((a) => viewSelection(view, a.id));
    return (
      <div key={key}>
        <ViewItem
          icon={viewIcon(view)}
          title={viewTitle(view)}
          depth={depth}
          count={viewUnread(counts, view, s.accounts)}
          selected={sameSelection(selection, s)}
          hint={!open && children.some((c) => sameSelection(selection, c))}
          onClick={() => onSelect(s)}
          trailing={multi ? <FoldToggle open={open} onToggle={flip} label="accounts" /> : undefined}
        />
        {multi && (
          <Fold open={open}>
            {accounts.map((account, i) => (
              <Row
                key={account.id}
                icon={<AccountRing account={account} />}
                title={accountShortName(account, accounts)}
                depth={depth + 1}
                count={viewUnread(counts, view, children[i]!.accounts)}
                selected={sameSelection(selection, children[i]!)}
                onClick={() => onSelect(children[i]!)}
              />
            ))}
          </Fold>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="mt-2">
        {VIEWS.map((view) => viewRow(view, 0))}
        <Row
          title="More"
          icon={<Chevron open={moreOpen} />}
          expanded={moreOpen}
          selected={false}
          hint={
            !moreOpen &&
            MORE_VIEWS.some((v) =>
              [viewSelection(v), ...accounts.map((a) => viewSelection(v, a.id))].some((s) =>
                sameSelection(selection, s),
              ),
            )
          }
          onClick={() => toggle("nested:more")}
        />
        <Fold open={moreOpen}>{MORE_VIEWS.map((view) => viewRow(view, 1))}</Fold>
      </div>
      {accounts.map((account) => {
        const tree = labelTree(labels.filter((l) => l.accountId === account.id));
        const state = syncStates.find((s) => s.accountId === account.id);
        const key = `nested:labels:${account.id}`;
        const open = isOpen(key);
        return (
          <div key={account.id} className="mt-3">
            <Row
              strong
              title={<span className="text-[11px] font-medium tracking-wide">{account.email}</span>}
              icon={<AccountRing account={account} />}
              expanded={tree.length > 0 ? open : undefined}
              selected={false}
              hint={
                !open &&
                selection.view.kind === "userLabel" &&
                selection.accounts.kind === "only" &&
                selection.accounts.ids[0] === account.id
              }
              onClick={() => tree.length > 0 && toggle(key)}
              trailing={
                <span className="flex items-center gap-1.5 pr-1">
                  <AccountAvatar account={account} state={state} />
                  {tree.length > 0 && <Chevron open={open} />}
                </span>
              }
            />
            <AccountProblem state={state} onReauth={() => onReauth(account)} />
            {tree.length > 0 && (
              <Fold open={open}>
                <LabelRows
                  tree={tree}
                  depth={1}
                  foldPrefix={String(account.id)}
                  counts={counts}
                  selection={selection}
                  onSelect={onSelect}
                  isOpen={isOpen}
                  toggle={toggle}
                />
              </Fold>
            )}
          </div>
        );
      })}
    </>
  );
}
