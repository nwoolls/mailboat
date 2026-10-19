import { useState } from "react";
import type { Account, AccountRules, LabelId, Rule } from "../../../platform/tauri/bindings";
import { useDeleteRule, useLabels, useRules } from "../../../shared/lib/queries";
import { showToast } from "../../../shared/lib/toast";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";
import { AccountAvatar } from "../../accounts/ui/AccountAvatar";
import { useSignIn } from "../../accounts/ui/useSignIn";
import { Button, Group, Row } from "../../settings/ui/controls";
import { pageOf } from "../model/paging";
import { describeActions, describeCriteria, ruleMatchesSearch } from "../model/summary";
import { RuleEditor, type RuleEditorTarget } from "./RuleEditor";

/**
 * Settings → Rules: each account's Gmail filters, to add, change and
 * delete. A search narrows long lists by what rules match or do.
 */
export function RulesSection({
  accounts,
  header,
}: {
  accounts: Account[];
  /** The page header, which holds the search. */
  header: (action: React.ReactNode) => React.ReactNode;
}) {
  const rules = useRules();
  const labels = useLabels({ kind: "all" }).data ?? [];
  const labelName = (id: LabelId) => labels.find((l) => l.id === id)?.name;
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<RuleEditorTarget | null>(null);
  const [deleting, setDeleting] = useState<Rule | null>(null);
  const remove = useDeleteRule();
  const signIn = useSignIn();

  return (
    <>
      {header(
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search rules"
          aria-label="Search rules"
          className="h-7 w-48 rounded-md bg-selection-subtle px-2 text-[12px] outline-none placeholder:text-content/40 focus:bg-selection"
        />,
      )}
      {rules.error && (
        <p className="selectable pb-4 text-[12px] text-danger">{rules.error.message}</p>
      )}
      {signIn.error && <p className="selectable pb-4 text-[12px] text-danger">{signIn.error}</p>}
      {accounts.map((account) => (
        <AccountRulesGroup
          key={account.id}
          account={account}
          listed={rules.data?.find((r) => r.accountId === account.id)}
          loading={rules.isPending}
          search={search}
          labelName={labelName}
          onNew={() => setEditing({ kind: "new", accountId: account.id })}
          onEdit={(rule) => setEditing({ kind: "edit", rule })}
          onDelete={setDeleting}
          onSignIn={() => signIn.start(account.email)}
          signingIn={signIn.pending}
        />
      ))}
      {editing && (
        <RuleEditor target={editing} accounts={accounts} onClose={() => setEditing(null)} />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete this rule?"
          confirmLabel="Delete"
          danger
          busy={remove.isPending}
          error={remove.error?.message}
          onCancel={() => {
            remove.reset();
            setDeleting(null);
          }}
          onConfirm={() =>
            remove.mutate(deleting, {
              onSuccess: () => {
                setDeleting(null);
                showToast({ message: "Rule deleted" });
              },
            })
          }
        >
          <p>{describeCriteria(deleting.criteria)}</p>
          <p>Mail it already sorted stays where it is.</p>
        </ConfirmDialog>
      )}
    </>
  );
}

function AccountRulesGroup({
  account,
  listed,
  loading,
  search,
  labelName,
  onNew,
  onEdit,
  onDelete,
  onSignIn,
  signingIn,
}: {
  account: Account;
  listed: AccountRules | undefined;
  loading: boolean;
  search: string;
  labelName: (id: LabelId) => string | undefined;
  onNew: () => void;
  onEdit: (rule: Rule) => void;
  onDelete: (rule: Rule) => void;
  onSignIn: () => void;
  signingIn: boolean;
}) {
  const state = listed?.state;
  const ready = state?.kind === "ready";
  const shown = ready ? state.rules.filter((r) => ruleMatchesSearch(r, search, labelName)) : [];
  // A new search starts at the first page (worked out here, not in an effect).
  const [paging, setPaging] = useState({ search, page: 0 });
  const page = pageOf(shown, paging.search === search ? paging.page : 0);
  const goTo = (n: number) => setPaging({ search, page: n });
  const name = account.displayName?.trim();
  return (
    <Group
      title={
        <>
          <AccountAvatar account={account} state={undefined} />
          <span className="truncate">{name || account.email}</span>
          {name && <span className="truncate font-normal text-content/45">{account.email}</span>}
        </>
      }
      action={ready ? <Button onClick={onNew}>New rule</Button> : undefined}
    >
      {loading || !state ? (
        <Row label="Loading rules…" />
      ) : state.kind === "needsSignIn" ? (
        <Row
          label="Sign in again"
          description={
            <span className="text-warn">
              Mailboat needs permission to see and change this account’s rules.
            </span>
          }
        >
          <Button onClick={onSignIn} disabled={signingIn}>
            Sign in again
          </Button>
        </Row>
      ) : state.kind === "unavailable" ? (
        <Row
          label="Couldn’t load rules"
          description={<span className="selectable text-danger">{state.message}</span>}
        />
      ) : state.rules.length === 0 ? (
        <Row
          label="No rules yet"
          description="Rules sort mail as it arrives, in Gmail, even when Mailboat is closed. Make one here, or from a message with “Filter messages like this”."
        />
      ) : shown.length === 0 ? (
        <Row label="No rules match the search" />
      ) : (
        <>
          {page.items.map((rule) => (
            <Row
              key={rule.filterId}
              label={<span className="selectable">{describeCriteria(rule.criteria)}</span>}
              description={describeActions(rule.actions, labelName)}
            >
              <Button onClick={() => onEdit(rule)}>Edit</Button>
              <Button danger onClick={() => onDelete(rule)}>
                Delete
              </Button>
            </Row>
          ))}
          {page.pages > 1 && (
            <div className="flex items-center gap-2 px-4 py-2.5 text-[12px] text-content/55">
              <span className="flex-1 tabular-nums">
                {page.from}–{page.to} of {page.total}
              </span>
              <Button onClick={() => goTo(page.page - 1)} disabled={page.page === 0}>
                Previous
              </Button>
              <Button onClick={() => goTo(page.page + 1)} disabled={page.page === page.pages - 1}>
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </Group>
  );
}
