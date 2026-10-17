import type { MailView } from "../../../platform/tauri/bindings";

/**
 * Gmail's "go to" keys: `g` then a letter, within a moment. They keep the
 * accounts being viewed (one account, or all).
 */
const GO_TO: Record<string, MailView> = {
  i: { kind: "system", label: "inbox" },
  s: { kind: "system", label: "starred" },
  t: { kind: "system", label: "sent" },
  d: { kind: "system", label: "draft" },
  a: { kind: "allMail" },
  e: { kind: "archive" },
};

/** How long after `g` the second key still counts. */
export const GO_TO_MS = 1500;

export function goToView(key: string): MailView | null {
  return GO_TO[key] ?? null;
}

/** Every key, grouped, for the `?` sheet. */
export const SHORTCUTS: { group: string; keys: [string, string][] }[] = [
  {
    group: "Move around",
    keys: [
      ["j / k", "Next / previous conversation"],
      ["Esc", "Clear picks, then close the conversation"],
      ["/", "Search"],
      ["⌘K", "Command palette"],
      ["g then i", "Go to Inbox"],
      ["g then s", "Go to Starred"],
      ["g then t", "Go to Sent"],
      ["g then d", "Go to Drafts"],
      ["g then a", "Go to All Mail"],
      ["g then e", "Go to Archive"],
    ],
  },
  {
    group: "Conversations",
    keys: [
      ["e", "Archive / Move to Inbox"],
      ["#", "Move to Trash / Restore"],
      ["u", "Mark as read / unread"],
      ["s", "Star / Unstar"],
      ["!", "Report spam / Not spam"],
      ["l", "Labels"],
      ["x", "Pick the open conversation"],
      ["z or ⌘Z", "Undo"],
    ],
  },
  {
    group: "Writing",
    keys: [
      ["c", "New message"],
      ["r", "Reply"],
      ["a", "Reply all"],
      ["f", "Forward"],
      ["⌘↩", "Send"],
      ["Esc", "Minimise the message"],
      ["⌘K", "Link (in the message)"],
    ],
  },
  {
    group: "Window",
    keys: [
      ["⌃⌘S", "Show / hide the sidebar"],
      ["⌃⌘R", "Show / hide the reader"],
      ["?", "These shortcuts"],
      ["⌘,", "Settings"],
    ],
  },
];
