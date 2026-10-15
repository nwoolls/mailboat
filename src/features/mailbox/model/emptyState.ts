import type { MailView } from "../../../platform/tauri/bindings";

/** What an empty list says, and which icon sits above it. */
export type EmptyState = {
  icon: EmptyIcon;
  title: string;
  detail: string;
};

export type EmptyIcon =
  | "caughtUp"
  | "search"
  | "star"
  | "important"
  | "sent"
  | "draft"
  | "spam"
  | "trash"
  | "archive"
  | "label";

/** Inbox zero gets a different line each day, so it stays a small treat. */
export const CAUGHT_UP_LINES = [
  "Inbox zero. Go do something nice.",
  "Not a single thing. Enjoy the quiet.",
  "Clear skies, all the way down.",
  "Nothing new. Put the kettle on.",
  "That's everything. Nicely done.",
  "All quiet. The mail can wait for you.",
];

/** Days since the Unix epoch in local time; picks the day's line. */
export function dayNumber(now: Date): number {
  const local = now.getTime() - now.getTimezoneOffset() * 60_000;
  return Math.floor(local / 86_400_000);
}

export function emptyStateFor(view: MailView, day: number): EmptyState {
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
          return {
            icon: "caughtUp",
            title: "All caught up",
            detail: CAUGHT_UP_LINES[day % CAUGHT_UP_LINES.length]!,
          };
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
