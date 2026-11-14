/**
 * Mounts real the app components in a browser for Playwright (tests/browser),
 * with the Rust side faked by Tauri's own `mockIPC`, answering with demo
 * mode's made-up mail (`demo/mail.json`, through `demoMail.ts`). Picked by
 * the URL:
 *
 *   ?mode=card&spot=bottom-left   a new message in the floating card
 *   ?mode=unread                  Maya's "Lisbon in May?", five emails,
 *                                 the last two unread, in the reader
 *   &recipients=many              (the default reader) an email to nine people
 *                                 and four more in Cc
 *   &colors=1                     (reader modes) the email's colors can be
 *                                 switched, and its images were shown
 *   &colors=2                     the same, with no images
 *   ?mode=signedout               the sidebar and the top-right notice for an
 *                                account Google has signed out
 *   ?mode=updates&update=found    Settings → About and the update notice;
 *                                 `update=none` or `update=error` is what a
 *                                 check finds, `&install=fail` makes
 *                                 installing fail; `&draft=1` has a message
 *                                 being written, and `&draftsave=fail` makes
 *                                 saving it fail. The order the commands were
 *                                 called in is in `window.__order`
 *   ?mode=toybox                  Settings → Toybox
 *   ?mode=shortcuts               the `?` keyboard shortcuts sheet
 *   ?mode=menu                    a pop-up menu with a very long item
 *   ?mode=inline                  a conversation's inline reply, in a
 *                                 scrolled reader with mail above it
 *   ?mode=original                Show original for a conversation of
 *                                 five emails, each with a long source
 *   ?mode=list&density=…&lines=…  the demo's Inbox, with Settings →
 *                                 List's density and preview lines
 *   ?mode=empty&toy=…             an empty Inbox with a Toybox toy
 *     &glow=pixel|ascii            the glow (a toy), in that Toybox style
 *     &style=pixel|ascii           the Toybox style without the glow
 *   ?mode=palette                 ⌘K over a search box, with "Search mail"
 *   &ai=none                      (card, inline) no AI set up
 *   &summary=live                 (inline) the AI summary above the
 *                                 conversation, as in the app: it answers
 *                                 a moment after it's asked, and a draft
 *                                 save is a "mail changed" event (drafts
 *                                 only). `window.__mailChanged()` sends
 *                                 one for other mail, as a sync does. The
 *                                 summary requests are counted in
 *                                 `window.__summaries`
 *   ?mode=onboarding&stage=…     first-launch onboarding at a stage
 *     &path=…&done=a,b&accounts=0|1&configured=1
 *   ?mode=shell                   the whole window (`Shell`) with one account
 *                                 (`&rows=1`: the demo's Inbox listed in every
 *                                 view and search),
 *                                 `&accounts=0` for none; removing the
 *                                 account (`account_remove`) empties the list
 *   ?mode=search                  the title bar's search, with three recent
 *                                 searches saved
 *   ?mode=sizes                   the reader with an email of images sized by
 *                                 only a height, only a width, both or neither
 *   ?mode=trackers&images=1|0     the reader with an email full of trackers,
 *                                 as the Rust sanitizer gave it (images
 *                                 loading or held back), `fixtures/`
 */
import { emit } from "@tauri-apps/api/event";
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
  inbox,
} from "./demoMail";
import trackers from "./fixtures/trackers.json";
import imageSizes from "./fixtures/image-sizes.json";

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
// `&recipients=many`: an email you sent, to a long list (the reader's
// addressing line cuts it off; Details shows everyone).
const recipientsMode = new URLSearchParams(location.search).get("recipients");
const manyPeople = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => ({
    name: `${prefix} Person ${i + 1}`,
    email: `${prefix.toLowerCase()}${i + 1}@x.example`,
  }));
const detail = unreadMode
  ? {
      thread: { ...thread, unread: true, messageCount: 5 },
      // The first three read (and folded), the last two not.
      messages: emails.map((m, i) => ({ ...m, unread: i >= 3 })),
      labels: [],
    }
  : {
      thread,
      messages: [
        recipientsMode === "many"
          ? { ...message, to: manyPeople("To", 9), cc: manyPeople("Cc", 4) }
          : message,
      ],
      labels: [],
    };

const onboardingParams = new URLSearchParams(location.search);
/** `?mode=shell`: whether the account was removed (the fake list then answers empty). */
let shellAccountRemoved = false;
const onboardingAccounts =
  harnessMode === "onboarding" ? Number(onboardingParams.get("accounts") ?? 0) : 1;

/** The commands that matter to a test, in the order they were called. */
function record(name: string) {
  const w = window as unknown as { __order?: string[] };
  (w.__order ??= []).push(name);
}

/** `&summary=live`: the AI summary and mail events behave as in the app. */
const summaryLive = new URLSearchParams(location.search).get("summary") === "live";
/** Made up, about the demo's Lisbon conversation: several lines tall. */
const SUMMARY = [
  "- Maya suggests a long weekend in Lisbon in May and asks who can come.",
  "- Priya can join from the Thursday; Jordan is still checking flights.",
  "- They lean toward an apartment in Alfama over a hotel near the river.",
  "- Maya will book once everyone confirms their dates by Friday.",
].join("\n");

if (summaryLive)
  (window as unknown as { __mailChanged: () => Promise<void> }).__mailChanged = () =>
    emit("mail-changed-event", { accountId: 1, draftsOnly: false });

mockIPC(
  (cmd, args) => {
    switch (cmd) {
      case "oauth_setup":
        return {
          configured: onboardingParams.has("configured"),
          clientFilePath: "/Users/you/Library/Application Support/app/google-oauth-client.json",
          problem: null,
        };
      case "oauth_client_save":
        // As Rust's check: a Web client is refused, with the reason.
        if (String((args as { text: string }).text).includes('"web"'))
          throw { kind: "invalid", message: 'invalid input: This is a "Web application" client.' };
        return { clientId: "1234-abc.apps.googleusercontent.com", projectId: "mail-k3x9qa" };
      case "sync_status_list":
        return [
          {
            accountId: account.id,
            // `?mode=signedout`: Google ended this account's sign-in.
            status: harnessMode === "signedout" ? "authError" : "syncing",
            errorKind: harnessMode === "signedout" ? "auth" : null,
            errorMessage: null,
            lastSyncAt: null,
          },
        ];
      case "app_info":
        return { iconChoices: [], version: "0.1.0" };
      case "update_check": {
        const found = new URLSearchParams(location.search).get("update");
        if (found === "error")
          throw {
            kind: "other",
            message: "Couldn’t reach the update server. Check your connection and try again.",
          };
        if (found === "none") return null;
        return new Promise((done) => setTimeout(() => done({ version: "0.2.0" }), 150));
      }
      case "update_install":
        record("update_install");
        if (new URLSearchParams(location.search).get("install") === "fail")
          throw { kind: "other", message: "The update failed." };
        // The real app restarts here, so this never answers.
        return new Promise(() => {});
      case "identities_list":
        return [identity];
      case "contacts_list":
        return [];
      case "accounts_list":
        if (harnessMode === "shell")
          return shellAccountRemoved || onboardingParams.get("accounts") === "0" ? [] : [account];
        return onboardingAccounts ? [account] : [];
      case "account_remove":
        record("account_remove");
        shellAccountRemoved = true;
        return { revoked: true };
      case "threads_list":
        // `?mode=shell&rows=1`: the demo's Inbox, for every view and search.
        if (harnessMode === "shell" && onboardingParams.has("rows"))
          return { threads: inbox(), nextCursor: null };
        return { threads: [], nextCursor: null };
      case "threads_load_older":
        // As Rust with no account to ask: nothing older, and not an error.
        return { added: 0, exhausted: true, failed: 0 };
      case "mailto_take":
        return [];
      case "labels_list":
        return [];
      case "vacation_list":
        // A one-line reply, so most of the message box is empty.
        return [
          {
            accountId: account.id,
            state: {
              kind: "ready",
              settings: {
                enabled: false,
                subject: "Away",
                bodyHtml: "<p>Back Monday</p>",
                bodyText: "Back Monday",
                contactsOnly: false,
                domainOnly: false,
                start: null,
                end: null,
              },
              canLimitToDomain: false,
              active: false,
            },
          },
        ];
      case "settings_get":
        return { ai: { writingProvider: "apple" } };
      case "ai_status":
        // `&ai=none`: Windows with no AI set up (Apple Intelligence can't be there).
        return [
          {
            provider: "apple",
            state:
              new URLSearchParams(location.search).get("ai") === "none" ? "unsupported" : "ready",
            account: null,
          },
        ];
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
        record("draft_save");
        if (new URLSearchParams(location.search).get("draftsave") === "fail")
          throw { kind: "network", message: "offline" };
        // As Rust: the saved draft is cached, and lists are told to refresh.
        if (summaryLive)
          setTimeout(() => void emit("mail-changed-event", { accountId: 1, draftsOnly: true }), 50);
        return 1;
      case "ai_thread_summary": {
        if (!summaryLive) return null;
        const w = window as unknown as { __summaries?: number };
        w.__summaries = (w.__summaries ?? 0) + 1;
        // From Rust's cache (the conversation hasn't changed), still a
        // moment's round trip.
        return new Promise((done) =>
          setTimeout(
            () => done({ threadId: 7, text: SUMMARY, provider: "apple", createdAt: 0 }),
            250,
          ),
        );
      }
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
        // `?mode=sizes`: made-up images sized by only a height, only a width,
        // both and neither, as the Rust sanitizer gave them.
        if (harnessMode === "sizes") {
          return {
            messageId: (args as { messageId: number }).messageId,
            accountId: 1,
            senderEmail: maya.email,
            imagesAllowed: true,
            imagePolicy: "loadedByDefault",
            attachments: [],
            originalColors: false,
            ...imageSizes.loaded,
          };
        }
        if (harnessMode === "trackers") {
          const loading = new URLSearchParams(location.search).get("images") === "1";
          return {
            messageId: (args as { messageId: number }).messageId,
            accountId: 1,
            senderEmail: maya.email,
            imagesAllowed: loading,
            imagePolicy: "loadedByDefault",
            attachments: [],
            originalColors: false,
            ...(loading ? trackers.loaded : trackers.blocked),
          };
        }
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
  },
  { shouldMockEvents: summaryLive },
);

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

if (harnessMode === "onboarding") {
  const done = onboardingParams.get("done");
  localStorage.setItem(
    "onboarding",
    JSON.stringify({
      stage: onboardingParams.get("stage") ?? "welcome",
      path: onboardingParams.get("path"),
      done: done ? done.split(",") : [],
      projectId: "mail-k3x9qa",
    }),
  );
}

if (harnessMode === "search")
  localStorage.setItem(
    "prefs.searchHistory",
    JSON.stringify(["invoice march", "from:sam", "Invoice"]),
  );
if (harnessMode === "empty") {
  const params = new URLSearchParams(location.search);
  // The glow is a toy: `&glow=pixel|ascii` chooses it, in that Toybox
  // style. No toy otherwise unless asked for (`&toy=…`), and no
  // screensaver unless asked for (`&screensaver`): only what's under test.
  const glow = params.get("glow");
  const toy = params.get("toy") ?? (glow ? "glow" : "none");
  localStorage.setItem("prefs.emptyToy", JSON.stringify(toy));
  localStorage.setItem(
    "prefs.featureFlags",
    JSON.stringify({ screensavers: params.has("screensaver") }),
  );
  localStorage.setItem("prefs.toyboxStyle", JSON.stringify(glow ?? params.get("style") ?? "pixel"));
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
