import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef } from "react";
import type { ThreadId, ThreadSummary } from "../../../platform/tauri/bindings";
import { AccountDot } from "../../../shared/ui/AccountDot";
import type { AccountIndex } from "../../accounts/model/accounts";
import { formatListDate, sendersLabel } from "../model/format";

const ROW_HEIGHT = 72;

type Props = {
  threads: ThreadSummary[];
  accounts: AccountIndex;
  /** Show each row's account marker (views that mix accounts). */
  showAccount: boolean;
  selectedId: ThreadId | null;
  onSelect: (id: ThreadId) => void;
  hasMore: boolean;
  loadMore: () => void;
  loading: boolean;
  /** Shown when the view has no conversations. */
  empty: React.ReactNode;
};

export function ThreadList({
  threads,
  accounts,
  showAccount,
  selectedId,
  onSelect,
  hasMore,
  loadMore,
  loading,
  empty,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: threads.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });
  const items = virtualizer.getVirtualItems();
  const selfEmails = useMemo(() => [...accounts.values()].map((a) => a.email), [accounts]);

  // Fetch the next page when the user nears the end.
  const lastIndex = items.at(-1)?.index ?? 0;
  useEffect(() => {
    if (hasMore && !loading && lastIndex >= threads.length - 20) loadMore();
  }, [hasMore, loading, lastIndex, threads.length, loadMore]);

  // Keep the keyboard selection visible.
  useEffect(() => {
    const index = threads.findIndex((t) => t.id === selectedId);
    if (index >= 0) virtualizer.scrollToIndex(index, { align: "auto" });
  }, [selectedId, threads, virtualizer]);

  if (!loading && threads.length === 0) return empty;

  return (
    <div
      ref={scrollRef}
      role="listbox"
      aria-label="Conversations"
      className="flex-1 overflow-y-auto"
    >
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {items.map((item) => {
          const t = threads[item.index]!;
          const selected = t.id === selectedId;
          return (
            <div
              key={t.id}
              role="option"
              aria-selected={selected}
              onClick={() => onSelect(t.id)}
              className={`absolute inset-x-0 mx-2 flex flex-col justify-center gap-0.5 rounded-lg px-3 ${
                selected ? "bg-selection-strong" : "hover:bg-selection-subtle"
              }`}
              style={{ top: item.start, height: ROW_HEIGHT - 4 }}
            >
              <div className="flex items-center gap-2">
                {t.unread && (
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                    aria-label="Unread"
                  />
                )}
                {showAccount && <AccountDot account={accounts.get(t.accountId)} size={7} />}
                <span className={`truncate ${t.unread ? "font-semibold" : "text-content/80"}`}>
                  {sendersLabel(t.senders, t.messageCount, selfEmails)}
                </span>
                <span className="ml-auto shrink-0 text-xs text-content/40">
                  {formatListDate(t.lastMessageAt)}
                </span>
              </div>
              <div
                className={`flex items-center gap-1.5 truncate ${t.unread ? "text-content" : "text-content/70"}`}
              >
                {t.starred && <span className="text-warn">★</span>}
                <span className="truncate">{t.subject || "(no subject)"}</span>
                {t.hasAttachments && <span className="shrink-0 text-content/40">📎</span>}
              </div>
              <div className="truncate text-xs text-content/40">{t.snippet}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
