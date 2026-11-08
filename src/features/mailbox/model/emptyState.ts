import type { AccountSyncState, MailView } from "../../../platform/tauri/bindings";

/** What an empty list says, and which icon sits above it. */
export type EmptyState = {
  icon: EmptyIcon;
  title: string;
  /** Optional second line; the empty Inbox goes without. */
  detail?: string;
};

export type EmptyIcon =
  | "caughtUp"
  | "inbox"
  | "search"
  | "star"
  | "important"
  | "sent"
  | "draft"
  | "spam"
  | "trash"
  | "archive"
  | "label";

/**
 * Whether the account's very first sync is still going (or waiting to
 * retry). Later syncs don't count: at inbox zero the list should still say
 * "All caught up" through every once-a-minute check. A failed account needs
 * the person, not time, so it isn't "getting" anything.
 */
export function isFirstSync(state: AccountSyncState): boolean {
  if (state.status === "error" || state.status === "authError") return false;
  return state.lastSyncAt == null;
}

/**
 * `syncing`: some account is on its first sync, so an empty list may only
 * mean the mail hasn't arrived yet, and "all caught up" would be wrong. A
 * search keeps its own words. `noAccounts`: every account was removed, so
 * the list is empty for want of one, whatever the view.
 */
export function emptyStateFor(view: MailView, syncing = false, noAccounts = false): EmptyState {
  if (noAccounts) {
    return {
      icon: "inbox",
      title: "No accounts yet",
      detail: "Add one in Settings → Accounts.",
    };
  }
  if (syncing && view.kind !== "search") {
    return {
      icon: "inbox",
      title: "Getting your mail…",
      detail: "It shows up here as it arrives.",
    };
  }
  switch (view.kind) {
    case "search":
      return {
        icon: "search",
        title: `No matches for “${view.text}”`,
        detail: "Search covers mail synced so far. Try fewer or different words.",
      };
    case "allMail":
    case "archive":
      return {
        icon: "archive",
        title: "Nothing here yet",
        detail: "Mail shows up here as it syncs.",
      };
    case "userLabel":
      return {
        icon: "label",
        title: "Nothing with this label",
        detail: "Conversations you label show up here.",
      };
    case "system":
      switch (view.label) {
        case "inbox":
          return { icon: "caughtUp", title: "All caught up" };
        case "unread":
          return { icon: "caughtUp", title: "No unread mail", detail: "You've read it all." };
        case "starred":
          return {
            icon: "star",
            title: "Nothing starred",
            detail: "Star a conversation to keep it close.",
          };
        case "important":
          return {
            icon: "important",
            title: "Nothing marked important",
            detail: "Gmail hasn't flagged anything right now.",
          };
        case "sent":
          return { icon: "sent", title: "Nothing sent yet", detail: "Mail you send lands here." };
        case "draft":
          return {
            icon: "draft",
            title: "No drafts",
            detail: "Half-written mail will wait for you here.",
          };
        case "spam":
          return {
            icon: "spam",
            title: "No spam",
            detail: "Gmail's filters are holding the line.",
          };
        case "trash":
          return { icon: "trash", title: "Trash is empty", detail: "Nothing to take out." };
      }
  }
}

/**
 * Identifies what an empty list shows, so its entrance animation replays
 * only when that changes. Moving between empty labels (same icon and
 * words) keeps it still instead of re-rising each click; searches keep one
 * key so typing doesn't replay it on every keystroke.
 */
export function emptyStateKey(view: MailView, syncing = false, noAccounts = false): string {
  if (view.kind === "search" && !noAccounts) return "search";
  const { icon, title, detail } = emptyStateFor(view, syncing, noAccounts);
  return `${icon}|${title}|${detail ?? ""}`;
}
