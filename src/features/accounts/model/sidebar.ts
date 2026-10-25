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
 * The count a sidebar row shows, only where unread means something is
 * waiting: Inbox, Starred (flagged conversations with new replies) and
 * labels (the only signal for mail a filter keeps out of the Inbox).
 * Unread, Archive and All Mail are always full of old unread mail, so a
 * count there is noise; Sent, Spam and Trash never need one. Drafts shows
 * how many are saved, as Gmail does (owner request, 2026-10-25): Rust
 * counts drafts, not unread, for its row.
 */
export function viewUnread(counts: LabelUnread[], view: MailView, accounts: AccountFilter): number {
  switch (view.kind) {
    case "system":
      if (view.label === "inbox") return unreadIn(counts, "INBOX", accounts);
      if (view.label === "starred") return unreadIn(counts, "STARRED", accounts);
      if (view.label === "draft") return unreadIn(counts, "DRAFT", accounts);
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
