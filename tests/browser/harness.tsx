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
 *                                 called in is in `window.__order`;
 *                                 `&link=fail` makes opening a link fail
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
 *   &toy=…                        (any mode) the Toybox toy, as above
 *   &hour=…                       the Sky toy's hour of day (0–24)
 *   &strict=0                     (any mode) without React's StrictMode,
 *                                 as in a release build
 *   ?mode=palette                 ⌘K over a search box, with "Search mail"
 *   &ai=none                      (card, inline) no AI set up
 *   &outside=work                 (card) the account is a Workspace account
 *                                 at its own domain, with sam@okafor.example
 *                                 in its contacts, so other addresses are
 *                                 marked as outside; `&settings=accounts`
 *                                 shows Settings → Accounts beside the card;
 *                                 `window.__outsideRuleAsked` is set once
 *                                 the rule is asked for
 *   &ideas=held                   (inline) the reply ideas wait until the
 *                                 test calls `window.__releaseIdeas()`,
 *                                 not 800 ms
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
 *   &bcc=unknown                  (shell) Send again couldn't read Bcc
 *                                 (Send again needs `&conversation=all`,
 *                                 whose emails include yours)
 *   ?mode=search                  the title bar's search, with three recent
 *                                 searches saved
 *   ?mode=sizes                   the reader with an email of images sized by
 *                                 only a height, only a width, both or neither
 *   ?mode=trackers&images=1|0     the reader with an email full of trackers,
 *                                 as the Rust sanitizer gave it (images
 *                                 loading or held back), `fixtures/`
 */
import "./slowMachine";
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
// `&labels=1` (with `?mode=shell&rows=1`): the account has user labels, one
// hidden and one set not to show on conversations, and the first rows carry
// some of them.
const withLabels = new URLSearchParams(location.search).get("labels") === "1";
const userLabel = (id: number, name: string, over: Record<string, unknown> = {}) => ({
  id,
  accountId: 1,
  gmailLabelId: `Label_${id}`,
  name,
  kind: "user" as const,
  colorBg: null as string | null,
  colorFg: null as string | null,
  sidebar: "show" as "show" | "showIfUnread" | "hide",
  onConversations: true,
  ...over,
});
const harnessLabels = [
  userLabel(101, "Clients", { colorBg: "#16a766", colorFg: "#ffffff" }),
  userLabel(102, "Receipts"),
  userLabel(103, "Travel", { colorBg: "#fad165", colorFg: "#000000" }),
  userLabel(104, "Archive box", { sidebar: "hide" }),
  userLabel(105, "Quiet", { onConversations: false }),
];
// Row 1: three labels to show (two chips and "+1"); row 2: one shown and
// one that isn't shown on conversations.
const rowLabelIds = [
  [101, 102, 103],
  [103, 105],
];
/** `&contacts=demo`: who compose suggests, and those taken out (newest first). */
const demoContacts = [
  { name: "Priya Raman", email: "priya@x.example", wrote: true },
  { name: "Priya R.", email: "priya.r@y.example", wrote: false },
  { name: "Jordan Park", email: "jordan@x.example", wrote: true },
];
let hiddenContacts: string[] = [];
/** `?mode=shell`: stars and read states changed by the app, by conversation. */
const shellChanges = new Map<number, { starred?: boolean; unread?: boolean; inInbox?: boolean }>();
// `&conversation=all` (with `?mode=shell`): the conversation has all five emails.
const unreadMode =
  harnessMode === "unread" ||
  harnessMode === "original" ||
  new URLSearchParams(location.search).get("conversation") === "all";
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

/** The fake Rust side's answer to each command. */
const answer = (cmd: string, args: unknown): unknown => {
  switch (cmd) {
    case "oauth_setup":
      return {
        configured: onboardingParams.has("configured"),
        clientFilePath: "/Users/you/Library/Application Support/app/google-oauth-client.json",
        problem: null,
      };
    case "oauth_client_save":
      record("oauth_client_save");
      // As Rust's check: a Web client is refused, with the reason.
      if (String((args as { text: string }).text).includes('"web"'))
        throw { kind: "invalid", message: 'invalid input: This is a "Web application" client.' };
      return { clientId: "1234-abc.apps.googleusercontent.com", projectId: "mail-k3x9qa" };
    case "sync_status_list": {
      // `window.__synced = true`: the first sync finishes mid-test (then
      // `window.__invalidateAll()`).
      const synced =
        onboardingParams.has("synced") || !!(window as unknown as { __synced?: boolean }).__synced;
      return [
        {
          accountId: account.id,
          // `?mode=signedout`: Google ended this account's sign-in.
          // `&synced=1`: its first sync is done, so empty views say what
          // they are ("All caught up"), not "Getting your mail…".
          status: harnessMode === "signedout" ? "authError" : synced ? "idle" : "syncing",
          errorKind: harnessMode === "signedout" ? "auth" : null,
          errorMessage: null,
          lastSyncAt: synced ? Date.now() : null,
        },
      ];
    }
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
    case "link_open":
      // `&link=fail`: the system couldn't open it.
      if (new URLSearchParams(location.search).get("link") === "fail")
        throw { kind: "other", message: "could not open the link" };
      // Opened in the browser in the app; here only noted, in order.
      record(`link_open ${(args as { url: string }).url}`);
      return null;
    case "update_install":
      record("update_install");
      if (new URLSearchParams(location.search).get("install") === "fail")
        throw { kind: "other", message: "The update failed." };
      // The real app restarts here, so this never answers.
      return new Promise(() => {});
    case "identities_list":
      return [identity];
    case "contacts_list":
      // `&contacts=demo`: the demo's people, less those taken out.
      if (new URLSearchParams(location.search).get("contacts") === "demo")
        return demoContacts.filter((c) => !hiddenContacts.includes(c.email.toLowerCase()));
      return [];
    case "contacts_hide":
    case "contacts_unhide": {
      // `&contacts-save=fail`: the database refuses the change.
      if (new URLSearchParams(location.search).get("contacts-save") === "fail")
        throw { kind: "db", message: "database is full" };
      // By address in lower case, as Rust keeps them.
      const email = (args as { email: string }).email.trim().toLowerCase();
      hiddenContacts = hiddenContacts.filter((e) => e !== email);
      if (cmd === "contacts_hide") hiddenContacts.unshift(email);
      return null;
    }
    case "contacts_hidden":
      return hiddenContacts;
    case "compose_outside_rule": {
      // So a test can tell the rule was asked for (and has an answer).
      (window as unknown as { __outsideRuleAsked?: boolean }).__outsideRuleAsked = true;
      const work = new URLSearchParams(location.search).get("outside") === "work";
      return {
        workspace: work,
        domains: [account.email.split("@")[1]!.toLowerCase()],
        known: work ? ["sam@okafor.example"] : [],
      };
    }
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
      // `window.__rows = true` turns them on mid-test, as if mail arrived;
      // `window.__rowsIn = ["archive", …]` only in those views (a system
      // label, or the view's kind).
      if (
        harnessMode === "shell" &&
        (onboardingParams.has("rows") ||
          (window as unknown as { __rows?: boolean }).__rows ||
          inRowsView(args))
      )
        return {
          threads: inbox().map((t, i) => ({
            ...t,
            ...(withLabels ? { labelIds: rowLabelIds[i] ?? [] } : {}),
            ...shellChanges.get(t.id),
          })),
          nextCursor: null,
        };
      return { threads: [], nextCursor: null };
    case "threads_set_starred":
    case "threads_set_archived":
    case "threads_set_read": {
      // Kept, so the list asked for again shows the change, as Rust's would.
      const a = args as {
        threadIds: number[];
        starred?: boolean;
        read?: boolean;
        archived?: boolean;
      };
      for (const id of a.threadIds) {
        const now = shellChanges.get(id) ?? {};
        if (a.starred !== undefined) now.starred = a.starred;
        if (a.read !== undefined) now.unread = !a.read;
        if (a.archived !== undefined) now.inInbox = !a.archived;
        shellChanges.set(id, now);
      }
      return null;
    }
    case "threads_load_older": {
      // As Rust with no account to ask: nothing older, and not an error.
      // `window.__olderFailsIn = ["draft", …]`: in those views Gmail fails,
      // and the list shows "Try again".
      const fails = (window as unknown as { __olderFailsIn?: string[] }).__olderFailsIn;
      const view = (args as { view?: { kind: string; label?: string } }).view;
      if (fails && view && fails.includes(view.label ?? view.kind))
        return { added: 0, exhausted: false, failed: 1 };
      return { added: 0, exhausted: true, failed: 0 };
    }
    case "mailto_take":
      return [];
    case "labels_list":
      return withLabels ? harnessLabels : [];
    case "label_palette":
      return ["#000000", "#4a86e8", "#16a766", "#fad165"];
    case "label_set_color":
    case "label_set_sidebar":
    case "label_set_on_conversations": {
      // Recorded with what it changed; the label changes as Rust's would.
      const a = args as {
        labelId: number;
        color?: string | null;
        sidebar?: string;
        show?: boolean;
      };
      record(`${cmd} ${a.labelId} ${JSON.stringify(a.color ?? a.sidebar ?? a.show ?? null)}`);
      const l = harnessLabels.find((x) => x.id === a.labelId)!;
      if (cmd === "label_set_color") {
        l.colorBg = a.color ?? null;
        l.colorFg = a.color ? "#ffffff" : null;
      }
      if (cmd === "label_set_sidebar") l.sidebar = a.sidebar as typeof l.sidebar;
      if (cmd === "label_set_on_conversations") l.onConversations = a.show!;
      return null;
    }
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
    case "ai_reply_ideas": {
      // A moment later, as from a model, so the stand-ins show first.
      const ideas = ["Say yes", "Ask for details"];
      // `&ideas=held`: when the test says, however long it takes to look.
      if (new URLSearchParams(location.search).get("ideas") === "held")
        return new Promise((done) => {
          (window as unknown as { __releaseIdeas?: () => void }).__releaseIdeas = () => done(ideas);
        });
      return new Promise((done) => setTimeout(() => done(ideas), 800));
    }
    case "thread_get":
      // `&threads=distinct`: answered as the conversation asked for, so
      // moving to another one (j/k) shows a different conversation, as in
      // the app. Not by default: the fake reply belongs to conversation 7.
      // Read or unread as its row is, so opening an unread one marks it
      // read (Settings → Viewing), as in the app.
      if (new URLSearchParams(location.search).get("threads") === "distinct") {
        const id = (args as { threadId: number }).threadId;
        const row = inbox().find((t) => t.id === id);
        const unread = shellChanges.get(id)?.unread ?? row?.unread ?? detail.thread.unread;
        return { ...detail, thread: { ...detail.thread, id, unread } };
      }
      return detail;
    case "send_again_source": {
      // Send again on one of your emails in the conversation: as sent,
      // with one file. `&bcc=unknown`: Gmail couldn't be asked for Bcc.
      // The first of your emails, as Rust picks it (Gmail's SENT label).
      const m =
        detail.messages.find((x: { from: { email: string } }) => x.from.email === account.email) ??
        detail.messages[0]!;
      const unknown = new URLSearchParams(location.search).get("bcc") === "unknown";
      return {
        accountId: account.id,
        from: m.from,
        fromStillYours: true,
        to: m.to,
        cc: m.cc,
        bcc: unknown ? [] : [{ name: null, email: "books@rivera.example" }],
        bccUnknown: unknown,
        subject: m.subject,
        html: "<p>Sent once already.</p>",
        text: "Sent once already.",
        attachments: [
          {
            id: 501,
            messageId: m.id,
            filename: "Lisbon itinerary.pdf",
            mimeType: "application/pdf",
            size: 48_000,
          },
        ],
        imagesLeftOut: 0,
      };
    }
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
    case "message_print": {
      // As Rust gives it for paper: the email's text on white.
      const id = (args as { messageId: number }).messageId;
      record(`message_print ${id}`);
      const text = lisbon.messages[id - 10]?.text ?? "";
      const printed = {
        messageId: id,
        accountId: 1,
        senderEmail: maya.email,
        imagesAllowed: true,
        imagePolicy: "loadedByDefault",
        attachments: [],
        originalColors: false,
        // Email 13 has an image the print test serves late, so its frame
        // finishes loading well after its body arrives.
        document: `<!doctype html><html><body style="margin:0;padding:20px 24px;background:#fff;color:#1f1f1f;font:14px/1.5 sans-serif">${id === 13 ? '<img src="/print-slow-image.png" width="40" height="40">' : ""}${longBody(text)}</body></html>`,
        blockedImages: 0,
        loadedImages: 0,
        trackersRemoved: 0,
        adaptive: false,
        recolorable: false,
      };
      // One email answers late, so the dialog has something to wait for.
      if (id === 12) return new Promise((done) => setTimeout(() => done(printed), 400));
      return printed;
    }
    case "window_print": {
      // How many of the printout's frames had grown to their email when
      // the dialog was asked for.
      const frames = [...document.querySelectorAll<HTMLIFrameElement>(".print-root iframe")];
      const tall = frames.filter((f) => f.getBoundingClientRect().height > 100).length;
      record(`window_print ${tall}/${frames.length}`);
      return null;
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
};

mockIPC(
  (cmd, args) => {
    // `window.__listDelay = ms`: the next list answers late, as the real
    // app's query takes a moment (the instant mock never painted a stale
    // list in between).
    const w = window as unknown as { __listDelay?: number };
    if (cmd === "threads_list" && w.__listDelay) {
      const delay = w.__listDelay;
      w.__listDelay = 0;
      return new Promise((done) => setTimeout(() => done(answer(cmd, args)), delay));
    }
    return answer(cmd, args);
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
// `&toy=…` works in other modes too (the shell, to switch views over it).
if (harnessMode === "empty" || new URLSearchParams(location.search).has("toy")) {
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

// `&hour=…`: the Sky toy's time of day, so its look doesn't follow the clock.
const skyHour = new URLSearchParams(location.search).get("hour");
if (skyHour !== null) {
  const { setSkyHourOverride } = await import("../../src/features/emptyToys/model/sky");
  setSkyHourOverride(Number(skyHour));
}

/** Whether the list asked for is one of `window.__rowsIn`'s views. */
function inRowsView(args: unknown): boolean {
  const views = (window as unknown as { __rowsIn?: string[] }).__rowsIn;
  const view = (args as { query?: { view?: { kind: string; label?: string } } }).query?.view;
  return !!views && !!view && views.includes(view.label ?? view.kind);
}

// Imported after the mock, so the app sees a Tauri window (IS_TAURI).
const { Harness } = await import("./HarnessApp");
// `&staleTime=app`: data stays fresh 30 s, as in the app (src/app/App.tsx);
// a view opened again within that isn't read again. Not the default here,
// where every view is read again.
const client = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      ...(new URLSearchParams(location.search).get("staleTime") === "app"
        ? { staleTime: 30_000, refetchOnWindowFocus: false }
        : {}),
    },
  },
});
// Marks every list out of date, as the app does after an action moves mail.
(window as unknown as { __invalidateLists: () => Promise<void> }).__invalidateLists = () =>
  client.invalidateQueries({ queryKey: ["threads"] });
// Marks everything out of date (after `window.__synced`, say).
(window as unknown as { __invalidateAll: () => Promise<void> }).__invalidateAll = () =>
  client.invalidateQueries();
const app = (
  <QueryClientProvider client={client}>
    <Harness account={account as never} identity={identity as never} detail={detail as never} />
  </QueryClientProvider>
);
createRoot(document.getElementById("root")!).render(
  // As in the app (src/main.tsx), so effects run twice on mount here too.
  // `&strict=0`: as in a release build, where they run once; StrictMode's
  // second run can hide an effect that runs too late.
  new URLSearchParams(location.search).get("strict") === "0" ? app : <StrictMode>{app}</StrictMode>,
);
