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
  text: string;
  /** The text it opened with (the quote); still equal means nothing was written. */
  initialText: string;
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

export function newDraft(
  identities: Identity[],
  accountId: AccountId,
  accountEmail: string,
): Draft {
  return {
    id: nextId++,
    kind: "new",
    accountId,
    from: fromFor(identities, accountId, accountEmail),
    to: [],
    cc: [],
    bcc: [],
    subject: "",
    text: "",
    initialText: "",
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

/** "On <date>, <sender> wrote:" and the original, each line behind "> ". */
export function quoteText(
  source: Pick<ReplySource, "from" | "date" | "text">,
  formatDate = defaultFormatDate,
): string {
  const quoted = source.text
    .replace(/\r\n/g, "\n")
    .trimEnd()
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
  return `On ${formatDate(source.date)}, ${formatAddress(source.from)} wrote:\n${quoted}`;
}

/** Gmail's "Forwarded message" block: the original's headers, then its text. */
export function forwardText(
  source: Pick<ReplySource, "from" | "to" | "cc" | "date" | "subject" | "text">,
  formatDate = defaultFormatDate,
): string {
  const lines = [
    "---------- Forwarded message ---------",
    `From: ${formatAddress(source.from)}`,
    `Date: ${formatDate(source.date)}`,
    `Subject: ${source.subject}`,
    `To: ${source.to.map(formatAddress).join(", ")}`,
  ];
  if (source.cc.length > 0) lines.push(`Cc: ${source.cc.map(formatAddress).join(", ")}`);
  return `${lines.join("\n")}\n\n${source.text.replace(/\r\n/g, "\n").trimEnd()}`;
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
  const body = kind === "forward" ? forwardText(source, formatDate) : quoteText(source, formatDate);
  // Room to write above the quote.
  const text = `\n\n${body}`;
  return {
    id: nextId++,
    kind,
    accountId: source.accountId,
    from: fromFor(identities, source.accountId, accountEmail, source),
    to,
    cc,
    bcc: [],
    subject: kind === "forward" ? forwardSubject(source.subject) : replySubject(source.subject),
    text,
    initialText: text,
    replyingTo: source.messageId,
    threadId: source.threadId,
    showCc: cc.length > 0,
    showBcc: false,
  };
}

/** Changing From can change account; the new account owns the message. */
export function withIdentity(draft: Draft, identity: Identity): Draft {
  return { ...draft, accountId: identity.accountId, from: identityAddress(identity) };
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
  if (draft.text.trim() !== draft.initialText.trim()) return true;
  if (draft.kind !== "new") return false;
  return draft.to.length + draft.cc.length + draft.bcc.length > 0 || draft.subject.trim() !== "";
}

export function toOutgoing(draft: Draft): OutgoingMessage {
  return {
    accountId: draft.accountId,
    from: draft.from,
    to: draft.to,
    cc: draft.cc,
    bcc: draft.bcc,
    subject: draft.subject,
    text: draft.text,
    html: null,
    replyingTo: draft.replyingTo,
  };
}
