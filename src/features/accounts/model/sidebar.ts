import type {
  Account,
  AccountFilter,
  LabelUnread,
  MailView,
} from "../../../platform/tauri/bindings";

/**
 * Which sidebar layout is shown. Temporary: the owner is trying these side
 * by side; the others go once one is picked.
 * - `switcher`: account chips at the top filter one set of views
 * - `nested`: one set of views; Inbox, Sent… unfold to a row per account
 *   (as Mimestream does), and each account keeps a folded labels section
 * - `tidy`: today's per-account sections, calmer, with folds and counts
 */
export type SidebarStyle = "switcher" | "nested" | "tidy";

export const SIDEBAR_STYLE_OPTIONS: { value: SidebarStyle; label: string }[] = [
  { value: "switcher", label: "Switcher" },
  { value: "nested", label: "Nested" },
  { value: "tidy", label: "Tidy" },
];

export const SIDEBAR_STYLE_STORAGE_KEY = "mailboat.sidebarStyle";

/** The saved choice, or `switcher` if nothing (or something unknown) is saved. */
export function parseSidebarStyle(saved: string | null): SidebarStyle {
  return SIDEBAR_STYLE_OPTIONS.some((o) => o.value === saved)
    ? (saved as SidebarStyle)
    : "switcher";
}

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

const domain = (email: string) => email.split("@")[1] ?? email;

/**
 * A short name for an account where the full address won't fit (chips,
 * nested rows): its domain ("gmail.com", "example.com"), or the part
 * before the @ when two accounts share a domain.
 */
export function accountShortName(account: Pick<Account, "email">, all: Pick<Account, "email">[]) {
  const own = domain(account.email);
  const shared = all.filter((a) => domain(a.email) === own).length > 1;
  return shared ? (account.email.split("@")[0] ?? account.email) : own;
}
