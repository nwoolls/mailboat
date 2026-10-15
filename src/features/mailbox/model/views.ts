import type {
  Account,
  AccountFilter,
  AccountId,
  Label,
  ListQuery,
  MailView,
  SystemLabel,
} from "../../../platform/tauri/bindings";

/** What the thread list is showing: a view over one, some or all accounts. */
export type Selection = { accounts: AccountFilter; view: MailView };

export const ALL_INBOXES: Selection = {
  accounts: { kind: "all" },
  view: { kind: "system", label: "inbox" },
};

export const SYSTEM_VIEW_TITLES: Record<SystemLabel, string> = {
  inbox: "Inbox",
  unread: "Unread",
  starred: "Starred",
  important: "Important",
  sent: "Sent",
  draft: "Drafts",
  spam: "Spam",
  trash: "Trash",
};

/** Views listed under "All accounts" (they unify across accounts). */
export const UNIFIED_VIEWS: SystemLabel[] = ["inbox", "unread", "starred", "sent"];
/** Views listed under each account. */
export const ACCOUNT_VIEWS: SystemLabel[] = ["inbox", "starred", "sent"];

export const PAGE_SIZE = 100;

export function systemSelection(label: SystemLabel, account?: AccountId): Selection {
  return {
    accounts: account === undefined ? { kind: "all" } : { kind: "only", ids: [account] },
    view: { kind: "system", label },
  };
}

/** A user label always belongs to one account, so its view is scoped to it. */
export function labelSelection(label: Label): Selection {
  return {
    accounts: { kind: "only", ids: [label.accountId] },
    view: { kind: "userLabel", labelId: label.id },
  };
}

export function toListQuery(selection: Selection, cursor: ListQuery["cursor"] = null): ListQuery {
  return { accounts: selection.accounts, view: selection.view, cursor, limit: PAGE_SIZE };
}

/** Stable key for caching and comparing selections. */
export function selectionKey(s: Selection): string {
  const accounts =
    s.accounts.kind === "all" ? "all" : s.accounts.ids.toSorted((a, b) => a - b).join(",");
  const v = s.view;
  const view =
    v.kind === "system"
      ? `system:${v.label}`
      : v.kind === "userLabel"
        ? `label:${v.labelId}`
        : `search:${v.text}`;
  return `${accounts}|${view}`;
}

export function sameSelection(a: Selection, b: Selection): boolean {
  return selectionKey(a) === selectionKey(b);
}

/** True when rows may come from more than one account, so each row needs an account marker. */
export function spansAccounts(s: Selection, accountCount: number): boolean {
  if (s.accounts.kind === "all") return accountCount > 1;
  return s.accounts.ids.length > 1;
}

export function selectionTitle(s: Selection, accounts: Account[], labels: Label[]): string {
  const v = s.view;
  if (v.kind === "search") return `Search: ${v.text}`;
  if (v.kind === "userLabel") return labels.find((l) => l.id === v.labelId)?.name ?? "Label";
  const base = SYSTEM_VIEW_TITLES[v.label];
  if (s.accounts.kind === "all") return v.label === "inbox" ? "All Inboxes" : base;
  const [only, ...others] = s.accounts.ids;
  if (only !== undefined && others.length === 0) {
    const account = accounts.find((a) => a.id === only);
    return account ? `${base} — ${account.email}` : base;
  }
  return base;
}
