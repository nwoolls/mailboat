import type {
  AccountFilter,
  LabelUnread,
  MailView,
  UnreadCounts,
} from "../../../platform/tauri/bindings";

/**
 * Which sidebar rows show an unread count. Temporary: the owner is trying
 * these side by side; the others go once one is picked.
 * - `actionable`: only where unread means something is waiting: Inbox,
 *   Starred and labels
 * - `everything`: every view but Sent, Drafts, Spam and Trash
 * - `off`: no counts
 */
export type CountMode = "actionable" | "everything" | "off";

export const COUNT_MODE_OPTIONS: { value: CountMode; label: string }[] = [
  { value: "actionable", label: "Actionable" },
  { value: "everything", label: "Everything" },
  { value: "off", label: "Off" },
];

export const COUNT_MODE_STORAGE_KEY = "mailboat.countMode";

/** The saved choice, or `actionable` if nothing (or something unknown) is saved. */
export function parseCountMode(saved: string | null): CountMode {
  return COUNT_MODE_OPTIONS.some((o) => o.value === saved) ? (saved as CountMode) : "actionable";
}

export const NO_COUNTS: UnreadCounts = { labels: [], accounts: [] };

const covers = (accounts: AccountFilter, id: number) =>
  accounts.kind === "all" || accounts.ids.includes(id);

/** Unread conversations under a Gmail label, summed over the given accounts. */
export function unreadIn(counts: LabelUnread[], gmailLabelId: string, accounts: AccountFilter) {
  return counts
    .filter((c) => c.gmailLabelId === gmailLabelId && covers(accounts, c.accountId))
    .reduce((sum, c) => sum + c.unread, 0);
}

/** Every view's unread count, before deciding whether to show it. */
function unreadForView(counts: UnreadCounts, view: MailView, accounts: AccountFilter): number {
  const perAccount = (pick: "allMail" | "archive") =>
    counts.accounts
      .filter((a) => covers(accounts, a.accountId))
      .reduce((sum, a) => sum + a[pick], 0);
  switch (view.kind) {
    case "system":
      // Gmail's system label IDs are the names in capitals (INBOX, STARRED).
      return unreadIn(counts.labels, view.label.toUpperCase(), accounts);
    case "userLabel":
      return counts.labels.find((c) => c.labelId === view.labelId)?.unread ?? 0;
    case "allMail":
      return perAccount("allMail");
    case "archive":
      return perAccount("archive");
    case "search":
      return 0;
  }
}

/** Whether a view's row shows a count under the given mode. */
export function showsCount(view: MailView, mode: CountMode): boolean {
  if (mode === "off") return false;
  if (view.kind === "userLabel") return true;
  if (view.kind === "system") {
    const actionable = view.label === "inbox" || view.label === "starred";
    if (mode === "actionable") return actionable;
    return actionable || view.label === "unread" || view.label === "important";
  }
  return mode === "everything" && (view.kind === "archive" || view.kind === "allMail");
}

/** The count a sidebar row shows (zero shows nothing). */
export function viewUnread(
  counts: UnreadCounts,
  view: MailView,
  accounts: AccountFilter,
  mode: CountMode,
): number {
  return showsCount(view, mode) ? unreadForView(counts, view, accounts) : 0;
}

/** A count as shown: nothing for zero, and "999+" past that. */
export function countText(n: number): string | null {
  if (n <= 0) return null;
  return n > 999 ? "999+" : String(n);
}
