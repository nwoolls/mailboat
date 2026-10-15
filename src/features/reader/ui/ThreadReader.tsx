import { useEffect, useState } from "react";
import type {
  MessageId,
  MessageMeta,
  ThreadDetail,
  ThreadId,
} from "../../../platform/tauri/bindings";
import { useThread } from "../../../shared/lib/queries";
import { AccountDot } from "../../../shared/ui/AccountDot";
import type { AccountIndex } from "../../accounts/model/accounts";
import { displayName, formatFullDate } from "../../mailbox/model/format";
import { useSetRead } from "../../mailbox/ui/useSetRead";
import { MessageFrame } from "./MessageFrame";

/** Messages expanded when a thread opens: unread ones plus the newest. */
export function initiallyExpanded(messages: Pick<MessageMeta, "id" | "unread">[]): Set<MessageId> {
  const open = new Set(messages.filter((m) => m.unread).map((m) => m.id));
  const last = messages.at(-1);
  if (last) open.add(last.id);
  return open;
}

export function ThreadReader({
  threadId,
  accounts,
}: {
  threadId: ThreadId | null;
  accounts: AccountIndex;
}) {
  const thread = useThread(threadId);
  if (threadId === null) {
    return (
      <div className="flex flex-1 items-center justify-center text-content/50">
        No conversation selected
      </div>
    );
  }
  if (thread.error) return <div className="selectable p-8 text-danger">{thread.error.message}</div>;
  if (!thread.data) return <div className="flex-1" />;
  // Keyed by thread so expansion state starts fresh for each conversation.
  return <ThreadBody key={thread.data.thread.id} detail={thread.data} accounts={accounts} />;
}

function ThreadBody({ detail: data, accounts }: { detail: ThreadDetail; accounts: AccountIndex }) {
  const [expanded, setExpanded] = useState<Set<MessageId>>(() => initiallyExpanded(data.messages));
  // Opening a conversation marks it read, once (pressing `u` afterwards
  // leaves it unread). Remembered at open so later updates don't re-trigger.
  const [unreadWhenOpened] = useState(data.thread.unread);
  const threadId = data.thread.id;
  const { mutate: setRead } = useSetRead();
  useEffect(() => {
    if (unreadWhenOpened) setRead({ ids: [threadId], read: true });
  }, [threadId, unreadWhenOpened, setRead]);
  const account = accounts.get(data.thread.accountId);
  const selfEmails = account ? [account.email] : [];

  return (
    <article className="flex-1 overflow-y-auto pb-16">
      <header className="px-8 pt-6 pb-4">
        <h1 className="selectable text-xl font-semibold leading-snug">
          {data.thread.subject || "(no subject)"}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-content/50">
          <AccountDot account={account} />
          <span>{account?.email}</span>
          {data.labels.map((l) => (
            <span
              key={l.id}
              className="rounded px-1.5 py-0.5"
              style={{
                background: l.colorBg ?? "var(--color-selection)",
                color: l.colorFg ?? undefined,
              }}
            >
              {l.name}
            </span>
          ))}
        </div>
      </header>
      <div className="flex flex-col gap-3">
        {data.messages.map((m) => {
          const isOpen = expanded.has(m.id);
          return (
            <section key={m.id} className="border-t border-stroke pt-3">
              <button
                type="button"
                className="flex w-full items-baseline gap-3 px-8 pb-2 text-left"
                onClick={() =>
                  setExpanded((prev) => {
                    const next = new Set(prev);
                    if (next.has(m.id)) next.delete(m.id);
                    else next.add(m.id);
                    return next;
                  })
                }
              >
                <span className={m.unread ? "font-semibold" : "font-medium"}>
                  {displayName(m.from, selfEmails)}
                </span>
                {isOpen ? (
                  <span className="truncate text-xs text-content/40">
                    {m.from.email} → {m.to.map((a) => displayName(a, selfEmails)).join(", ")}
                    {m.cc.length > 0 &&
                      `, cc ${m.cc.map((a) => displayName(a, selfEmails)).join(", ")}`}
                  </span>
                ) : (
                  <span className="truncate text-content/50">{m.snippet}</span>
                )}
                <span className="ml-auto shrink-0 text-xs text-content/40">
                  {formatFullDate(m.internalDate)}
                </span>
              </button>
              {isOpen && <MessageFrame messageId={m.id} />}
            </section>
          );
        })}
      </div>
    </article>
  );
}
