/**
 * Mounts real Mailboat components in a browser for Playwright (tests/browser),
 * with the Rust side faked by Tauri's own `mockIPC`. Picked by the URL:
 *
 *   ?mode=card&spot=bottom-left   a new message in the floating card
 *   ?mode=unread                  a conversation of five emails, the last
 *                                 two unread, in the reader
 *   &colors=1                     (reader modes) the email's colors can be
 *                                 switched, and its images were shown
 *   &colors=2                     the same, with no images
 *   ?mode=menu                    a pop-up menu with a very long item
 *   ?mode=inline                  a conversation's inline reply, in a
 *                                 scrolled reader with mail above it
 */
import { mockIPC } from "@tauri-apps/api/mocks";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../../src/styles/index.css";

const account = {
  id: 1,
  email: "me@example.com",
  displayName: "Me",
  avatarUrl: null,
  color: "#3b82f6",
  oauthClient: "default",
  missingPermissions: [],
};
const me = { name: "Me", email: "me@example.com" };
const sam = { name: "Sam", email: "sam@example.com" };
const identity = {
  accountId: 1,
  email: "me@example.com",
  name: "Me",
  replyTo: null,
  isPrimary: true,
  isDefault: true,
  signature: null,
};
const message = {
  id: 10,
  accountId: 1,
  threadId: 7,
  from: sam,
  to: [me],
  cc: [],
  subject: "Quarterly review",
  snippet: "Can you bring the budget numbers?",
  internalDate: 1_792_000_000_000,
  unread: false,
  starred: false,
  hasAttachments: false,
  draft: false,
};
const thread = {
  id: 7,
  accountId: 1,
  subject: "Quarterly review",
  snippet: message.snippet,
  senders: [{ ...sam, unread: false }],
  lastMessageAt: message.internalDate,
  messageCount: 1,
  unread: false,
  starred: false,
  hasAttachments: false,
  inInbox: true,
  inTrash: false,
  labelIds: [],
  onlyDraft: false,
  inSpam: false,
  signInCode: null,
};
const unreadMode = new URLSearchParams(location.search).get("mode") === "unread";
const colorsMode = new URLSearchParams(location.search).get("colors");
const detail = unreadMode
  ? {
      thread: { ...thread, unread: true, messageCount: 5 },
      messages: [10, 11, 12, 13, 14].map((id, i) =>
        Object.assign(structuredClone(message), {
          id,
          internalDate: message.internalDate + i * 60_000,
          unread: i >= 3,
        }),
      ),
      labels: [],
    }
  : { thread, messages: [message], labels: [] };

mockIPC((cmd) => {
  switch (cmd) {
    case "identities_list":
      return [identity];
    case "contacts_list":
      return [];
    case "accounts_list":
      return [account];
    case "settings_get":
      return { ai: { writingProvider: "apple" } };
    case "ai_status":
      return [{ provider: "apple", state: "ready", account: null }];
    case "ai_reply_ideas":
      return ["Say yes", "Ask for details"];
    case "thread_get":
      return detail;
    case "reply_source":
      return {
        messageId: 10,
        accountId: 1,
        threadId: 7,
        from: sam,
        to: [me],
        cc: [],
        replyTo: [],
        subject: "Quarterly review",
        date: message.internalDate,
        text: "Can you bring the budget numbers?",
        html: null,
        attachments: [],
        inlineImages: [],
      };
    case "html_preview":
      return {
        document: "<p>quoted</p>",
        blockedImages: 0,
        loadedImages: 0,
        trackersRemoved: 0,
        adaptive: true,
        recolorable: false,
      };
    case "draft_save":
      return 1;
    case "message_open":
      // A long plain email, so the reader scrolls as with real mail.
      return {
        messageId: 10,
        accountId: 1,
        senderEmail: sam.email,
        imagesAllowed: true,
        imagePolicy: "loadedByDefault",
        attachments: [],
        originalColors: false,
        document: `<!doctype html><html><body style="margin:0;font:14px/1.5 sans-serif">${"<p>Can you bring the budget numbers to the quarterly review?</p>".repeat(60)}</body></html>`,
        blockedImages: 0,
        loadedImages: colorsMode === "1" ? 2 : 0,
        trackersRemoved: 0,
        adaptive: true,
        recolorable: colorsMode !== null,
      };
    default:
      return null;
  }
});

// Imported after the mock, so the app sees a Tauri window (IS_TAURI).
const { Harness } = await import("./HarnessApp");
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById("root")!).render(
  // As in the app (src/main.tsx), so effects run twice on mount here too.
  <StrictMode>
    <QueryClientProvider client={client}>
      <Harness account={account as never} identity={identity as never} detail={detail as never} />
    </QueryClientProvider>
  </StrictMode>,
);
