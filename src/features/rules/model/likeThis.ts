import type {
  AccountId,
  RuleActions,
  RuleCriteria,
  ThreadSummary,
} from "../../../platform/tauri/bindings";

/**
 * What "Filter messages like these" starts from, as Gmail's does: the
 * conversations' senders (other than you) in From, joined with OR when
 * there are several. Null when the conversations span accounts, since a
 * rule belongs to one account.
 */
export function criteriaLikeThreads(
  threads: Pick<ThreadSummary, "accountId" | "senders">[],
  selfEmails: (account: AccountId) => string[],
): { accountId: AccountId; criteria: Partial<RuleCriteria> } | null {
  const accountId = threads[0]?.accountId;
  if (accountId === undefined || threads.some((t) => t.accountId !== accountId)) return null;
  const self = new Set(selfEmails(accountId).map((e) => e.toLowerCase()));
  const senders: string[] = [];
  for (const thread of threads) {
    // The first person other than you who wrote: who started it.
    const sender = thread.senders.find((s) => !self.has(s.email.toLowerCase()));
    const email = sender?.email.toLowerCase();
    if (email && !senders.includes(email)) senders.push(email);
  }
  return { accountId, criteria: senders.length ? { from: senders.join(" OR ") } : {} };
}

/**
 * Who "Block sender" would block: the one person (other than you) who
 * started the picked conversations, or null if there are several, none,
 * or the conversations span accounts.
 */
export function senderToBlock(
  threads: Pick<ThreadSummary, "accountId" | "senders">[],
  selfEmails: (account: AccountId) => string[],
): { accountId: AccountId; email: string } | null {
  const like = criteriaLikeThreads(threads, selfEmails);
  const from = like?.criteria.from;
  if (!like || !from || from.includes(" OR ")) return null;
  return { accountId: like.accountId, email: from };
}

/** The rule "Block sender" makes: their mail goes to the Trash. */
export function blockRule(email: string): { criteria: RuleCriteria; actions: RuleActions } {
  return {
    criteria: {
      from: email,
      to: "",
      subject: "",
      hasWords: "",
      doesntHave: "",
      hasAttachment: false,
      size: null,
    },
    actions: {
      skipInbox: false,
      markRead: false,
      star: false,
      labels: [],
      neverSpam: false,
      trash: true,
      importance: "leave",
      category: null,
      forwardTo: null,
    },
  };
}
