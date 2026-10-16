import type {
  AccountFilter,
  AccountId,
  Address,
  Identity,
  MessageId,
  OutgoingMessage,
  ReplySource,
  ThreadId,
} from "../../../platform/tauri/bindings";
import { formatAddress, isValidEmail, sameEmail, uniqueAddresses } from "./addresses";

export type ComposeKind = "new" | "reply" | "replyAll" | "forward";

/** A message being written. Lives in the UI until it's sent. */
export type Draft = {
  /** Local only, for keys. */
  id: number;
  kind: ComposeKind;
  accountId: AccountId;
  from: Address;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  /** The editor's content (what's sent as the formatted version). */
  html: string;
  /** The same as plain text, sent alongside for text-only readers. */
  text: string;
  /** The user has typed in the editor (the opening quote doesn't count). */
  edited: boolean;
  /**
   * The original, quoted (replies) or forwarded, as HTML with its own
   * formatting. Kept out of the editor (its tables and styles wouldn't
   * survive it), shown folded behind "…", and added when sending.
   */
  quote: string;
  /** The same as plain text, for the text copy. */
  quoteText: string;
  /**
   * The From address's Gmail signature, exactly as Gmail has it. Kept out
   * of the editor (which dropped its fonts and colours and split its
   * lines), shown read-only under the text, and added when sending.
   */
  signature: string;
  /** The message replied to or forwarded. */
  replyingTo: MessageId | null;
  /** The conversation a reply or forward was started from. */
  threadId: ThreadId | null;
  showCc: boolean;
  showBcc: boolean;
};

let nextId = 1;

function identityAddress(i: Identity): Address {
  return { name: i.name, email: i.email };
}

/**
 * The From a draft starts with. For a reply, the account's address the
 * mail was sent to (an alias, say); otherwise the account's Gmail default.
 */
export function defaultIdentity(
  identities: Identity[],
  accountId: AccountId,
  source?: Pick<ReplySource, "from" | "to" | "cc">,
): Identity | undefined {
  const mine = identities.filter((i) => i.accountId === accountId);
  if (source) {
    const addressed = [...source.to, ...source.cc, source.from];
    const hit = addressed
      .map((a) => mine.find((i) => sameEmail(i.email, a.email)))
      .find((i) => i !== undefined);
    if (hit) return hit;
  }
  return mine.find((i) => i.isDefault) ?? mine[0];
}

function fromFor(
  identities: Identity[],
  accountId: AccountId,
  fallback: string,
  source?: ReplySource,
): Address {
  const identity = defaultIdentity(identities, accountId, source);
  return identity ? identityAddress(identity) : { name: null, email: fallback };
}

/**
 * Which account a new message starts from: the one being viewed, or the
 * first account in unified views (From can be changed in the card).
 */
export function accountForNew(
  filter: AccountFilter,
  accountIds: AccountId[],
): AccountId | undefined {
  if (filter.kind === "only" && filter.ids.length === 1) return filter.ids[0];
  return accountIds[0];
}

/**
 * Drops empty lines from the end of a signature: Gmail signatures often
 * end with several.
 */
export function trimSignature(html: string): string {
  const emptyTail = /(\s|<br\s*\/?>|<(p|div)[^>]*>(\s|<br\s*\/?>|&nbsp;)*<\/\2>)+$/i;
  return html.trim().replace(emptyTail, "");
}

/** Rough plain text of an HTML fragment, for the text copy: one line per block or break. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function signatureOf(identities: Identity[], accountId: AccountId, from: Address): string {
  const found = identities.find((i) => i.accountId === accountId && sameEmail(i.email, from.email));
  return trimSignature(found?.signature ?? "");
}

export function newDraft(
  identities: Identity[],
  accountId: AccountId,
  accountEmail: string,
): Draft {
  const from = fromFor(identities, accountId, accountEmail);
  return {
    id: nextId++,
    kind: "new",
    accountId,
    from,
    to: [],
    cc: [],
    bcc: [],
    subject: "",
    html: "",
    text: "",
    edited: false,
    quote: "",
    quoteText: "",
    signature: signatureOf(identities, accountId, from),
    replyingTo: null,
    threadId: null,
    showCc: false,
    showBcc: false,
  };
}

export function replySubject(subject: string): string {
  const s = subject.trim();
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}

export function forwardSubject(subject: string): string {
  const s = subject.trim();
  return /^(fwd?|fw):/i.test(s) ? s : `Fwd: ${s}`;
}

/**
 * Who a reply goes to, as Gmail does it. Replying to someone else's mail
 * goes to its Reply-To (or From); reply-all adds the other To and Cc
 * people. Replying to your own sent mail goes to the same people again.
 * Your own addresses are left out of reply-all.
 */
export function replyRecipients(
  source: Pick<ReplySource, "from" | "to" | "cc" | "replyTo">,
  all: boolean,
  myEmails: string[],
): { to: Address[]; cc: Address[] } {
  const fromMe = myEmails.some((e) => sameEmail(e, source.from.email));
  const sender = source.replyTo.length > 0 ? source.replyTo : [source.from];
  if (!all) return { to: fromMe ? source.to : sender, cc: [] };
  let to = uniqueAddresses(fromMe ? source.to : [...sender, ...source.to], myEmails);
  let cc = uniqueAddresses(source.cc, [...myEmails, ...to.map((a) => a.email)]);
  // Only Cc'd people left: they become the To.
  if (to.length === 0) [to, cc] = [cc, []];
  return { to, cc };
}

function defaultFormatDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Plain text as paragraphs: blank lines split them, single breaks stay. */
export function textToHtml(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .trim()
    .split(/\n{2,}/)
    .filter(Boolean)
    .map((p) => `<p>${p.split("\n").map(escapeHtml).join("<br>")}</p>`)
    .join("");
}

/** Gmail's quote style, so the quote looks the same as Gmail's own. */
const QUOTE_STYLE = "margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex";

type Original = Pick<ReplySource, "from" | "to" | "cc" | "date" | "subject" | "text" | "html">;

function originalHtml(source: Original): string {
  return source.html?.trim() ? source.html : textToHtml(source.text);
}

function attribution(source: Original, formatDate: (ms: number) => string): string {
  return `On ${formatDate(source.date)}, ${formatAddress(source.from)} wrote:`;
}

/** "On <date>, <sender> wrote:" and the original, with its formatting, in a quote block. */
export function quoteHtml(source: Original, formatDate = defaultFormatDate): string {
  return (
    `<div class="gmail_quote"><p>${escapeHtml(attribution(source, formatDate))}</p>` +
    `<blockquote style="${QUOTE_STYLE}">${originalHtml(source)}</blockquote></div>`
  );
}

/** The plain-text copy of the quote: each line behind "> ". */
export function quoteText(source: Original, formatDate = defaultFormatDate): string {
  const quoted = source.text
    .replace(/\r\n/g, "\n")
    .trimEnd()
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
  return `${attribution(source, formatDate)}\n${quoted}`;
}

function forwardHeader(source: Original, formatDate: (ms: number) => string): string[] {
  const lines = [
    "---------- Forwarded message ---------",
    `From: ${formatAddress(source.from)}`,
    `Date: ${formatDate(source.date)}`,
    `Subject: ${source.subject}`,
    `To: ${source.to.map(formatAddress).join(", ")}`,
  ];
  if (source.cc.length > 0) lines.push(`Cc: ${source.cc.map(formatAddress).join(", ")}`);
  return lines;
}

/** Gmail's "Forwarded message" block: the original's headers, then the original. */
export function forwardHtml(source: Original, formatDate = defaultFormatDate): string {
  const header = forwardHeader(source, formatDate).map(escapeHtml).join("<br>");
  return `<div class="gmail_quote"><p>${header}</p>${originalHtml(source)}</div>`;
}

export function forwardText(source: Original, formatDate = defaultFormatDate): string {
  const header = forwardHeader(source, formatDate).join("\n");
  return `${header}\n\n${source.text.replace(/\r\n/g, "\n").trimEnd()}`;
}

/** A reply, reply-all or forward of `source`, from the account it's in. */
export function replyDraft(
  kind: Exclude<ComposeKind, "new">,
  source: ReplySource,
  identities: Identity[],
  accountEmail: string,
  formatDate = defaultFormatDate,
): Draft {
  const myEmails = [
    accountEmail,
    ...identities.filter((i) => i.accountId === source.accountId).map((i) => i.email),
  ];
  const { to, cc } =
    kind === "forward"
      ? { to: [], cc: [] }
      : replyRecipients(source, kind === "replyAll", myEmails);
  const forward = kind === "forward";
  const quote = forward ? forwardHtml(source, formatDate) : quoteHtml(source, formatDate);
  const quoteCopy = forward ? forwardText(source, formatDate) : quoteText(source, formatDate);
  const from = fromFor(identities, source.accountId, accountEmail, source);
  return {
    id: nextId++,
    kind,
    accountId: source.accountId,
    from,
    to,
    cc,
    bcc: [],
    subject: kind === "forward" ? forwardSubject(source.subject) : replySubject(source.subject),
    // Starts empty; one blank line separates it from the signature and
    // quote, as in Gmail and other mail apps.
    html: "",
    signature: signatureOf(identities, source.accountId, from),
    quote,
    quoteText: quoteCopy,
    // Filled in by the editor as soon as it loads the HTML.
    text: "",
    edited: false,
    replyingTo: source.messageId,
    threadId: source.threadId,
    showCc: cc.length > 0,
    showBcc: false,
  };
}

/**
 * Changing From can change account; the new account owns the message,
 * and the new address's signature replaces the old one (it's not part of
 * the text, so this works after typing too).
 */
export function withIdentity(draft: Draft, identity: Identity): Draft {
  const from = identityAddress(identity);
  return {
    ...draft,
    accountId: identity.accountId,
    from,
    signature: trimSignature(identity.signature ?? ""),
  };
}

/** The editor reloads only for a different draft. */
export function editorKey(draft: Draft): string {
  return `${draft.id}`;
}

/** Why it can't be sent yet, or null. */
export function sendProblem(draft: Draft): string | null {
  const everyone = [...draft.to, ...draft.cc, ...draft.bcc];
  if (everyone.length === 0) return "Add at least one recipient.";
  const bad = everyone.find((a) => !isValidEmail(a.email));
  if (bad) return `“${bad.email}” isn’t a valid email address.`;
  return null;
}

/** Something was written that closing would lose. */
export function hasChanges(draft: Draft): boolean {
  if (draft.edited) return true;
  if (draft.kind !== "new") return false;
  return draft.to.length + draft.cc.length + draft.bcc.length > 0 || draft.subject.trim() !== "";
}

/**
 * The editor's HTML as mail apps should show it: paragraphs without the
 * gaps browsers add between them (the editor shows none), and empty
 * lines kept as lines (an empty paragraph would collapse to nothing).
 */
export function emailHtml(html: string): string {
  return html
    .replace(/<p><\/p>/g, "<p><br></p>")
    .replace(/<p style="/g, '<p style="margin:0;')
    .replace(/<p>/g, '<p style="margin:0">');
}

/**
 * The message as sent: what was written, a blank line, the signature (in
 * Gmail's wrapper), then the quote, in both copies.
 */
export function toOutgoing(draft: Draft): OutgoingMessage {
  const signature = draft.signature ? `<div class="gmail_signature">${draft.signature}</div>` : "";
  const after = [signature, draft.quote].filter(Boolean);
  const html =
    draft.html.trim() || after.length > 0
      ? emailHtml(draft.html) + after.map((part) => `<div><br></div>${part}`).join("")
      : null;
  const text = [draft.text.trimEnd(), htmlToText(draft.signature), draft.quoteText]
    .filter(Boolean)
    .join("\n\n");
  return {
    accountId: draft.accountId,
    from: draft.from,
    to: draft.to,
    cc: draft.cc,
    bcc: draft.bcc,
    subject: draft.subject,
    text,
    html,
    replyingTo: draft.replyingTo,
  };
}
