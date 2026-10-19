import type { AccountId, RuleCriteria, ThreadSummary } from "../../../platform/tauri/bindings";

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
