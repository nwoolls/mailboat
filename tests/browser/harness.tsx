/**
 * Mounts real the app components in a browser for Playwright (tests/browser),
 * with the Rust side faked by Tauri's own `mockIPC`, answering with demo
 * mode's made-up mail (`demo/mail.json`, through `demoMail.ts`). Picked by
 * the URL:
 *
 *   ?mode=card&spot=bottom-left   a new message in the floating card
 *   ?mode=unread                  Maya's "Lisbon in May?", five emails,
 *                                 the last two unread, in the reader
 *   &colors=1                     (reader modes) the email's colors can be
 *                                 switched, and its images were shown
 *   &colors=2                     the same, with no images
 *   ?mode=shortcuts               the `?` keyboard shortcuts sheet
 *   ?mode=menu                    a pop-up menu with a very long item
 *   ?mode=inline                  a conversation's inline reply, in a
 *                                 scrolled reader with mail above it
 *   ?mode=original                Show original for a conversation of
 *                                 five emails, each with a long source
 *   ?mode=list&density=…&lines=…  the demo's Inbox, with Settings →
 *                                 List's density and preview lines
 *   ?mode=empty&toy=…             an empty Inbox with a Toybox toy
 *   ?mode=palette                 ⌘K over a search box, with "Search mail"
 *   ?mode=search                  the title bar's search, with three recent
 *                                 searches saved
 */
import { mockIPC } from "@tauri-apps/api/mocks";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../../src/styles/index.css";

import {
  account,
  conversation,
  identity as demoIdentity,
  me,
  messagesOf,
  threadOf,
} from "./demoMail";

// Demo mode's made-up mail (`demo/mail.json`): Maya's "Lisbon in May?",
// five emails, as conversation 7 with emails 10 to 14.
const lisbon = conversation("Lisbon in May?");
const emails = messagesOf(lisbon, 7, 10);
if (emails.length !== 5) throw new Error("the harness expects five emails in Lisbon in May?");
const newest = emails.at(-1)!;
const maya = newest.from;
// No signature: tests check the editors' exact text.
const identity = { ...demoIdentity, signature: null };
const thread = { ...threadOf(lisbon, 7), unread: false, messageCount: 1 };
const message = { ...newest, unread: false };
/** An email's text as paragraphs, repeated so the reader scrolls as with long mail. */
const longBody = (text: string) => {
  const paragraphs = text.split(/\n\s*\n/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`);
  return Array.from({ length: 60 }, (_, i) => paragraphs[i % paragraphs.length]).join("");
};
const harnessMode = new URLSearchParams(location.search).get("mode");
const unreadMode = harnessMode === "unread" || harnessMode === "original";
const colorsMode = new URLSearchParams(location.search).get("colors");
const detail = unreadMode
  ? {
      thread: { ...thread, unread: true, messageCount: 5 },
      // The first three read (and folded), the last two not.
      messages: emails.map((m, i) => ({ ...m, unread: i >= 3 })),
      labels: [],
    }
  : { thread, messages: [message], labels: [] };

mockIPC((cmd, args) => {
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
    case "ai_rewrite": {
      // Shouts the selection back, so a test can see what was sent.
      const text = (args as { text: string }).text.toUpperCase();
      return new Promise((done) => setTimeout(() => done({ text, html: `<p>${text}</p>` }), 300));
    }
    case "ai_translate": {
      // Marks the text with the language asked for.
      const { text, target } = args as { text: string; target: string };
      const out = `[${target}] ${text}`;
      return { text: out, html: `<p>${out}</p>`, source: "en", by: "Apple Translation" };
    }
    case "ai_translation_languages":
      return ["de", "fr", "fr-CA"];
    case "ai_reply_ideas":
      // A moment later, as from a model, so the stand-ins show first.
      return new Promise((done) => setTimeout(() => done(["Say yes", "Ask for details"]), 800));
    case "thread_get":
      return detail;
    case "reply_source":
      return {
        messageId: message.id,
        accountId: 1,
        threadId: 7,
        from: maya,
        to: [me],
        cc: [],
        replyTo: [],
        subject: message.subject,
        date: message.internalDate,
        text: lisbon.messages.at(-1)!.text ?? "",
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
    case "message_original": {
      // Which email was asked for shows in its subject.
      const id = (args as { messageId: number }).messageId;
      return {
        messageId: `<m${id}@example.com>`,
        date: message.internalDate,
        from: `${maya.name} <${maya.email}>`,
        to: me.email,
        cc: null,
        subject: `Email ${id}`,
        checks: [
          { method: "SPF", result: "pass", detail: "example.com" },
          { method: "DMARC", result: "fail", detail: "example.com" },
        ],
        source: `Subject: Email ${id}\r\n\r\n${"A long line of the email's source. ".repeat(4000)}`,
        truncated: false,
        size: 140_000,
      };
    }
    case "message_open": {
      // The email's own text, made long, so the reader scrolls as with real mail.
      const id = (args as { messageId: number }).messageId;
      const text = lisbon.messages[id - 10]?.text ?? "";
      return {
        messageId: id,
        accountId: 1,
        senderEmail: emails[id - 10]?.from.email ?? maya.email,
        imagesAllowed: true,
        imagePolicy: "loadedByDefault",
        attachments: [],
        originalColors: false,
        document: `<!doctype html><html><body style="margin:0;font:14px/1.5 sans-serif">${longBody(text)}</body></html>`,
        blockedImages: 0,
        loadedImages: colorsMode === "1" ? 2 : 0,
        trackersRemoved: 0,
        adaptive: true,
        recolorable: colorsMode !== null,
      };
    }
    default:
      return null;
  }
});

// Settings → List for the list mode, saved before the app first reads it.
if (harnessMode === "list") {
  const params = new URLSearchParams(location.search);
  localStorage.setItem(
    "prefs.list",
    JSON.stringify({
      density: params.get("density") ?? "default",
      previewLines: Number(params.get("lines") ?? 1),
    }),
  );
}

if (harnessMode === "search")
  localStorage.setItem(
    "prefs.searchHistory",
    JSON.stringify(["invoice march", "from:sam", "Invoice"]),
  );
if (harnessMode === "empty") {
  const toy = new URLSearchParams(location.search).get("toy") ?? "none";
  localStorage.setItem("prefs.emptyToy", JSON.stringify(toy));
  // No glow or screensaver: only the toy is under test.
  localStorage.setItem(
    "prefs.featureFlags",
    JSON.stringify({ emptyGlow: false, screensavers: false }),
  );
}

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
