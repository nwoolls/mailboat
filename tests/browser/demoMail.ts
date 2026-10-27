/**
 * Demo mode's made-up mail (`demo/mail.json`, the same file the app's demo
 * mode serves from Rust) in the shapes the window gets from Rust, for the
 * harness. Dates are relative to now, as in the demo.
 */
import mail from "../../demo/mail.json";

type Person = { name: string; email: string };
type DemoMessage = {
  from: string;
  to?: string[];
  cc?: string[];
  ago?: string;
  subject?: string;
  text?: string;
  unread?: boolean;
  draft?: boolean;
  attachments?: unknown[];
};
type DemoConversation = { labels?: string[]; messages: DemoMessage[] };
type DemoAccount = {
  email: string;
  name: string;
  color?: string;
  signature?: string;
  conversations: DemoConversation[];
};

const people = mail.people as Record<string, Person>;
const personal = mail.accounts[0] as DemoAccount;

export const account = {
  id: 1,
  email: personal.email,
  displayName: personal.name,
  avatarUrl: null,
  color: personal.color ?? "#5b8def",
  oauthClient: "demo",
  missingPermissions: [],
};
export const me: Person = { name: personal.name, email: personal.email };
export const identity = {
  accountId: 1,
  email: me.email,
  name: me.name,
  replyTo: null,
  isPrimary: true,
  isDefault: true,
  signature: personal.signature ?? null,
};

export function person(key: string): Person {
  if (key === "me") return me;
  const p = people[key];
  if (!p) throw new Error(`demo mail: nobody called "${key}"`);
  return p;
}

const UNIT: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

/** "25m" → when, in ms since 1970. */
function sentAt(ago = "0m"): number {
  return Date.now() - Number(ago.slice(0, -1)) * (UNIT[ago.slice(-1)] ?? 0);
}

/** Gmail's snippet: the start of the text, on one line. */
export function snippet(text = ""): string {
  return text.split(/\s+/).join(" ").trim().slice(0, 180);
}

/** A personal conversation, by its first subject. */
export function conversation(subject: string): DemoConversation {
  const found = personal.conversations.find((c) => c.messages[0]?.subject === subject);
  if (!found) throw new Error(`demo mail: no conversation "${subject}"`);
  return found;
}

/** Its emails as the reader lists them, numbered from `firstId`. */
export function messagesOf(c: DemoConversation, threadId: number, firstId: number) {
  const subject = c.messages[0]?.subject ?? "";
  // Whoever you're writing with, for mail you wrote without a To.
  const other = c.messages.find((m) => m.from !== "me")?.from ?? "me";
  return c.messages.map((m, i) => ({
    id: firstId + i,
    accountId: account.id,
    threadId,
    from: person(m.from),
    to: (m.to ?? [m.from === "me" ? other : "me"]).map(person),
    cc: (m.cc ?? []).map(person),
    subject: m.subject ?? `Re: ${subject}`,
    snippet: snippet(m.text),
    internalDate: sentAt(m.ago),
    unread: m.unread ?? false,
    starred: false,
    hasAttachments: (m.attachments?.length ?? 0) > 0,
    draft: m.draft ?? false,
  }));
}

/** A conversation as the list shows it. */
export function threadOf(c: DemoConversation, id: number) {
  const messages = messagesOf(c, id, 0);
  const newest = messages.at(-1)!;
  const senders: (Person & { unread: boolean })[] = [];
  for (const m of messages)
    if (!senders.some((s) => s.email === m.from.email))
      senders.push({ ...m.from, unread: m.unread });
  return {
    id,
    accountId: account.id,
    subject: messages[0]?.subject ?? "",
    snippet: newest.snippet,
    senders,
    lastMessageAt: newest.internalDate,
    messageCount: messages.length,
    unread: messages.some((m) => m.unread),
    starred: c.labels?.includes("STARRED") ?? false,
    hasAttachments: messages.some((m) => m.hasAttachments),
    inInbox: c.labels?.includes("INBOX") ?? false,
    inTrash: false,
    labelIds: [],
    onlyDraft: false,
    inSpam: false,
    signInCode: null,
  };
}

/** The personal Inbox, newest first. */
export function inbox() {
  return personal.conversations
    .filter((c) => c.labels?.includes("INBOX"))
    .map((c, i) => threadOf(c, i + 1))
    .toSorted((a, b) => b.lastMessageAt - a.lastMessageAt);
}
