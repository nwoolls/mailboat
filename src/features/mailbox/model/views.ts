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

const system = (label: SystemLabel): MailView => ({ kind: "system", label });
const ALL_MAIL: MailView = { kind: "allMail" };
const ARCHIVE: MailView = { kind: "archive" };

/** Views listed under "All accounts" (they unify across accounts). */
export const UNIFIED_VIEWS: MailView[] = [
  system("inbox"),
  system("unread"),
  system("starred"),
  system("sent"),
  ARCHIVE,
  ALL_MAIL,
];
/** The everyday views under each account, always shown. */
export const PRIMARY_ACCOUNT_VIEWS: MailView[] = [
  system("inbox"),
  system("starred"),
  system("sent"),
  system("draft"),
  ARCHIVE,
];
/** Less-used views, folded under "More" in the sidebar. */
export const MORE_ACCOUNT_VIEWS: MailView[] = [
  ALL_MAIL,
  system("important"),
  system("spam"),
  system("trash"),
];
/** Every view listed under each account. */
export const ACCOUNT_VIEWS: MailView[] = [...PRIMARY_ACCOUNT_VIEWS, ...MORE_ACCOUNT_VIEWS];

/** Sidebar/heading name of a view (search and labels are named elsewhere). */
export function viewTitle(view: MailView): string {
  switch (view.kind) {
    case "system":
      return SYSTEM_VIEW_TITLES[view.label];
    case "allMail":
      return "All Mail";
    case "archive":
      return "Archive";
    case "userLabel":
      return "Label";
    case "search":
      return `Search: ${view.text}`;
  }
}

/** A view over all accounts (no `account`) or one account. */
export function viewSelection(view: MailView, account?: AccountId): Selection {
  return {
    accounts: account === undefined ? { kind: "all" } : { kind: "only", ids: [account] },
    view,
  };
}

export const PAGE_SIZE = 100;

export function systemSelection(label: SystemLabel, account?: AccountId): Selection {
  return viewSelection(system(label), account);
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
        : v.kind === "search"
          ? `search:${v.text}`
          : v.kind;
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

/**
 * The list's heading. The account is only named when there's more than one
 * to tell apart; with a single account the sidebar already says whose it is.
 */
export function selectionTitle(s: Selection, accounts: Account[], labels: Label[]): string {
  const v = s.view;
  if (v.kind === "search") return `Results for “${v.text}”`;
  if (v.kind === "userLabel") return labels.find((l) => l.id === v.labelId)?.name ?? "Label";
  const base = viewTitle(v);
  if (s.accounts.kind === "all")
    return v.kind === "system" && v.label === "inbox" ? "All Inboxes" : base;
  const [only, ...others] = s.accounts.ids;
  if (only !== undefined && others.length === 0 && accounts.length > 1) {
    const account = accounts.find((a) => a.id === only);
    return account ? `${base} · ${account.email}` : base;
  }
  return base;
}

/**
 * True if a selection shows any of this account's mail only through that
 * account (its own views and labels), so it has nowhere to go once the
 * account is removed. Unified views just lose that account's rows.
 */
export function selectionNeedsAccount(s: Selection, account: AccountId, labels: Label[]): boolean {
  if (s.view.kind === "userLabel") {
    const labelId = s.view.labelId;
    if (labels.some((l) => l.id === labelId && l.accountId === account)) return true;
  }
  return s.accounts.kind === "only" && s.accounts.ids.every((id) => id === account);
}

/**
 * Views whose older mail can be fetched from Gmail when the list reaches
 * the end of the cache. Search is local only until remote search arrives.
 */
export function loadsOlderMail(view: MailView): boolean {
  return view.kind !== "search";
}
