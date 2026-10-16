import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef } from "react";
import type { ThreadId, ThreadSummary } from "../../../platform/tauri/bindings";
import { AttachmentIcon, StarIcon } from "../../../shared/ui/icons";
import type { AccountIndex } from "../../accounts/model/accounts";
import { formatListDate, sendersLabel } from "../model/format";
import { type RowMarkers, tint } from "../model/rowMarkers";

const ROW_HEIGHT = 72;

type Props = {
  threads: ThreadSummary[];
  accounts: AccountIndex;
  /** Show each row's account marker (views that mix accounts). */
  showAccount: boolean;
  /** How the account and unread state are drawn when `showAccount`. */
  markers: RowMarkers;
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
  markers,
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
          const account = showAccount ? accounts.get(t.accountId) : undefined;
          // Single-account views have no account mark, just the unread dot.
          const style = account ? markers : null;
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
              {account && style === "glassBar" && (
                // At the row's very edge, well clear of the unread dot;
                // faded at both ends with a faint glow, so it reads as a
                // tint rather than a stripe.
                <span
                  className="absolute top-3 bottom-3 left-0 w-[2px] rounded-full"
                  style={{
                    background: `linear-gradient(to bottom, transparent, ${tint(account.color, 70)} 30%, ${tint(account.color, 70)} 70%, transparent)`,
                    boxShadow: `0 0 6px ${tint(account.color, 35)}`,
                  }}
                  title={account.email}
                  aria-label={account.email}
                />
              )}
              <div className="relative flex items-center gap-2">
                {t.unread && style !== "glassDot" && (
                  <span
                    className="absolute top-1/2 -left-3.5 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-accent"
                    aria-label="Unread"
                  />
                )}
                {account && style === "ring" && (
                  // Hollow, so it can't be mistaken for the solid unread dot.
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ border: `1.5px solid ${tint(account.color, 75)}` }}
                    title={account.email}
                    aria-label={account.email}
                  />
                )}
                {account && style === "glassDot" && (
                  // A soft bead: the colour at half strength with a light
                  // highlight and a thin edge, like the glass panels.
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{
                      background: `radial-gradient(circle at 35% 30%, rgba(255,255,255,0.45), ${tint(account.color, 55)} 65%)`,
                      boxShadow: `inset 0 0 0 0.5px rgba(255,255,255,0.2)`,
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
