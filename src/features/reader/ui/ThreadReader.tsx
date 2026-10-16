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
import { displayName, formatFullDate, formatListDate } from "../../mailbox/model/format";
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
  threadId: ThreadId;
  accounts: AccountIndex;
}) {
  const thread = useThread(threadId);
  if (thread.error) return <div className="selectable p-8 text-danger">{thread.error.message}</div>;
  if (!thread.data) return <div className="flex-1" />;
  // Keyed by thread so expansion state starts fresh for each conversation,
  // and so each new conversation plays the entrance animation. While the
  // next one loads, the previous stays up, dimmed.
  return (
    <ThreadBody
      key={thread.data.thread.id}
      detail={thread.data}
      accounts={accounts}
      leaving={thread.isPlaceholderData}
    />
  );
}

function ThreadBody({
  detail: data,
  accounts,
  leaving,
}: {
  detail: ThreadDetail;
  accounts: AccountIndex;
  leaving: boolean;
}) {
  const [expanded, setExpanded] = useState<Set<MessageId>>(() => initiallyExpanded(data.messages));
  // Every message opened so far; its body stays mounted when closed.
  const [opened, setOpened] = useState<Set<MessageId>>(expanded);
  if ([...expanded].some((id) => !opened.has(id))) setOpened(new Set([...opened, ...expanded]));
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
  // Which account it's in matters only when there's more than one.
  const showAccount = accounts.size > 1;

  return (
    <article
      // macOS overlay scrollbars take no width, so a long email appearing
      // doesn't narrow the reader or reflow it.
      className={`reader-enter flex-1 overflow-y-auto pb-4 transition-opacity duration-150 ${
        leaving ? "opacity-50" : ""
      }`}
    >
      <header className="px-8 pt-5 pb-3">
        <h1 className="selectable text-lg leading-snug font-semibold">
          {data.thread.subject || "(no subject)"}
        </h1>
        {(showAccount || data.labels.length > 0) && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-content/50">
            {showAccount && (
              <>
                <AccountDot account={account} />
                <span>{account?.email}</span>
              </>
            )}
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
        )}
      </header>
      {/* Each message is a card on the glass; collapsed ones are a shade
          lighter. Avatar, notice and body share one left edge (16px). */}
      <div className="flex flex-col gap-2 px-4">
        {data.messages.map((m) => {
          const isOpen = expanded.has(m.id);
          const name = displayName(m.from, selfEmails);
          const toggle = () =>
            setExpanded((prev) => {
              const next = new Set(prev);
              if (next.has(m.id)) next.delete(m.id);
              else next.add(m.id);
              return next;
            });
          return (
            <section
              key={m.id}
              className={`rounded-xl ring-1 ring-stroke transition-colors duration-[120ms] ${
                isOpen ? "message-card" : "message-card-collapsed"
              }`}
            >
              {/* The first line (avatar, name, date) is identical open or
                  closed, so nothing jumps; the snippet fades, and the
                  addresses and body slide in below. */}
              <button
                type="button"
                // Block, not the button default (inline), which left a
                // descender gap under collapsed cards. Collapsed cards are
                // tighter; the padding eases open with the message.
                className={`block w-full px-4 text-left transition-[padding] duration-200 ease-out motion-reduce:transition-none ${
                  isOpen ? "py-3" : "py-2"
                }`}
                onClick={toggle}
                aria-expanded={isOpen}
              >
                <div className="flex h-7 items-center gap-3">
                  <SenderInitial name={name} />
                  <span
                    className={`max-w-[60%] min-w-0 shrink-0 truncate ${m.unread ? "font-semibold" : "font-medium"}`}
                  >
                    {name}
                  </span>
                  <span
                    aria-hidden={isOpen}
                    className={`min-w-0 flex-1 truncate text-content/50 transition-opacity duration-150 ${
                      isOpen ? "opacity-0" : "opacity-100"
                    }`}
                  >
                    {m.snippet}
                  </span>
                  <span
                    className="shrink-0 pl-2 text-xs text-content/45"
                    title={formatFullDate(m.internalDate)}
                  >
                    {formatListDate(m.internalDate)}
                  </span>
                </div>
                <Fold open={isOpen}>
                  <div className="truncate pl-10 text-xs text-content/45">
                    {m.from.email} → {m.to.map((a) => displayName(a, selfEmails)).join(", ")}
                    {m.cc.length > 0 &&
                      `, cc ${m.cc.map((a) => displayName(a, selfEmails)).join(", ")}`}
                  </div>
                </Fold>
              </button>
              {/* Stays loaded after the first open, so closing animates too. */}
              <Fold open={isOpen}>
                {opened.has(m.id) && (
                  <div className="px-4 pb-4">
                    <MessageFrame messageId={m.id} />
                  </div>
                )}
              </Fold>
            </section>
          );
        })}
      </div>
    </article>
  );
}

/** A sender's initial in a soft circle, as in Gmail's message headers. */
function SenderInitial({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-selection-strong text-xs font-semibold text-content/80"
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

/** Animates its content's height open and closed. */
function Fold({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div
      className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${
        open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
      }`}
      inert={!open}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}
