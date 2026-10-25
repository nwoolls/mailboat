import type { MailView } from "../../../platform/tauri/bindings";
import { IS_MAC } from "../../../shared/lib/platform";
import {
  accelLabel,
  appCommands,
  conversationCommands,
  NO_CONVERSATION,
} from "../../commands/model/commands";

/**
 * Gmail's "go to" keys: `g` then a letter, within a moment. They keep the
 * accounts being viewed (one account, or all).
 */
const GO_TO: Record<string, MailView> = {
  i: { kind: "system", label: "inbox" },
  // Not Gmail's (it has no Unread view): `g then u`, as Todoist and others.
  u: { kind: "system", label: "unread" },
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
      // Previewed if a preview shows; otherwise only selected.
      ["j / k", "Next / previous conversation"],
      ["↓ / ↑", "The same"],
      ["PgDn / PgUp", "A page down / up the list"],
      ["Home / End", "First / last conversation"],
      ["↩ or o", "Preview the selected one"],
      ["Esc", "Clear picks, then hide the reader"],
      ["/", "Search"],
      [accelLabel("Cmd+K"), "Command palette"],
      ["g then i", "Go to Inbox"],
      ["g then u", "Go to Unread"],
      ["g then s", "Go to Starred"],
      ["g then t", "Go to Sent"],
      ["g then d", "Go to Drafts"],
      ["g then a", "Go to All Mail"],
      ["g then e", "Go to Archive"],
    ],
  },
  {
    group: "Reading",
    keys: [
      ["Space", "Scroll down"],
      [accelLabel("Shift+Space"), "Scroll up"],
      ["n / p", "Next / previous email"],
    ],
  },
  {
    group: "Conversations",
    keys: [
      ["e", "Archive / Move to Inbox"],
      ["#", "Move to Trash / Restore"],
      [IS_MAC ? "⌫" : "Delete", "Move to Trash (or Archive, in Settings)"],
      ["u", "Mark as read / unread"],
      ["s", "Star / Unstar"],
      ["!", "Report spam / Not spam"],
      ["l", "Labels"],
      ["x", "Pick the selected conversation"],
      [IS_MAC ? "⇧↓ / ⇧↑" : "Shift+↓ / Shift+↑", "Pick a range"],
      [`z or ${accelLabel("Cmd+Z")}`, "Undo"],
    ],
  },
  {
    group: "Writing",
    keys: [
      ["c", "New message"],
      ["r", "Reply"],
      ["a", "Reply all"],
      ["f", "Forward"],
      [accelLabel("Cmd+Enter"), "Send"],
      ["Esc", "Minimise the message"],
      [accelLabel("Cmd+K"), "Link (in the message)"],
    ],
  },
  {
    group: "Window",
    keys: [
      [accelLabel("Ctrl+Cmd+S"), "Show / hide the sidebar"],
      [accelLabel("Ctrl+Cmd+R"), "Show / hide the reader"],
      ["?", "These shortcuts"],
      [accelLabel("Cmd+,"), "Settings"],
    ],
  },
  {
    // As in Mail, from the menu bar (`features/commands`); they work while
    // typing too, so the ones that change a conversation are off then.
    // Windows has no menu bar, but the same keys (with Ctrl) work there.
    group: IS_MAC ? "Menu bar" : "With Ctrl",
    keys: [
      ...conversationCommands([], NO_CONVERSATION),
      ...appCommands({ sidebarOpen: true, readerOpen: true, hasConversation: true }),
    ]
      .filter((c) => c.accel && c.key !== accelLabel(c.accel))
      .map((c): [string, string] => [accelLabel(c.accel!), c.title]),
  },
];
