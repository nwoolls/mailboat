import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef } from "react";
import type { ThreadId, ThreadSummary } from "../../../platform/tauri/bindings";
import { AttachmentIcon, StarIcon } from "../../../shared/ui/icons";
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
  /** A click on the empty area below the rows, as in Mail and Mimestream. */
  onClearSelection: () => void;
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
  onClearSelection,
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
      // Only a click on the list's own background (below the last row)
      // clears the selection; the gaps between rows belong to the rows'
      // container, so a slightly-off click there doesn't close the reader.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClearSelection();
      }}
      aria-label="Conversations"
      className="flex-1 overflow-y-auto"
    >
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {items.map((item) => {
          const t = threads[item.index]!;
          const selected = t.id === selectedId;
          const account = showAccount ? accounts.get(t.accountId) : undefined;
          return (
            <div
              key={t.id}
              role="option"
              aria-selected={selected}
              onClick={() => onSelect(t.id)}
              // pl-6 leaves a fixed gutter for the unread dot, so senders,
              // subjects and snippets line up whether a row is read or not.
              className={`absolute inset-x-0 mx-2 flex flex-col justify-center gap-0.5 rounded-lg pr-3 pl-6 ${
                selected ? "bg-selection-strong" : "hover:bg-selection-subtle"
              }`}
              style={{ top: item.start, height: ROW_HEIGHT - 4 }}
            >
              <div className="relative flex items-center gap-2">
                {t.unread && (
                  <span
                    className="absolute top-1/2 -left-3.5 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-accent"
                    aria-label="Unread"
                  />
                )}
                {account && (
                  // The account as a hollow ring in a softened account
                  // colour: hollow, so it can't be mistaken for the solid
                  // unread dot beside it, whatever the account's colour.
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{
                      border: `1.5px solid color-mix(in srgb, ${account.color} 75%, transparent)`,
                    }}
                    title={account.email}
                    aria-label={account.email}
                  />
                )}
                <span
                  className={`truncate ${t.unread ? "font-semibold text-content" : "font-medium text-content/85"}`}
                >
                  {sendersLabel(t.senders, t.messageCount, selfEmails)}
                </span>
                <span className="ml-auto shrink-0 text-xs text-content/40">
                  {formatListDate(t.lastMessageAt)}
                </span>
              </div>
              <div
                className={`flex items-center gap-1.5 truncate ${t.unread ? "font-semibold text-content" : "font-medium text-content/70"}`}
              >
                {t.starred && (
                  <StarIcon
                    size={12}
                    strokeWidth={2}
                    className="shrink-0 text-warn"
                    aria-label="Starred"
                  />
                )}
                <span className="truncate">{t.subject || "(no subject)"}</span>
                {t.hasAttachments && (
                  <AttachmentIcon
                    size={12}
                    className="shrink-0 text-content/45"
                    aria-label="Has attachments"
                  />
                )}
              </div>
              <div className="truncate text-xs font-medium text-content/40">{t.snippet}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
