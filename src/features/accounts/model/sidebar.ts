import type { AccountFilter, LabelUnread, MailView } from "../../../platform/tauri/bindings";

/** Unread conversations under a Gmail label, summed over the given accounts. */
export function unreadIn(counts: LabelUnread[], gmailLabelId: string, accounts: AccountFilter) {
  return counts
    .filter(
      (c) =>
        c.gmailLabelId === gmailLabelId &&
        (accounts.kind === "all" || accounts.ids.includes(c.accountId)),
    )
    .reduce((sum, c) => sum + c.unread, 0);
}

/**
 * The count a sidebar row shows: unread conversations for Inbox, Unread and
 * user labels; nothing for the rest (a count on Sent or Archive is noise).
 */
export function viewUnread(counts: LabelUnread[], view: MailView, accounts: AccountFilter): number {
  switch (view.kind) {
    case "system":
      if (view.label === "inbox") return unreadIn(counts, "INBOX", accounts);
      if (view.label === "unread") return unreadIn(counts, "UNREAD", accounts);
      return 0;
    case "userLabel":
      return counts.find((c) => c.labelId === view.labelId)?.unread ?? 0;
    default:
      return 0;
  }
}

/** A count as shown: nothing for zero, and "999+" past that. */
export function countText(n: number): string | null {
  if (n <= 0) return null;
  return n > 999 ? "999+" : String(n);
}
