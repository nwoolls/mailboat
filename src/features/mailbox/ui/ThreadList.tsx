import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef } from "react";
import type { ThreadId, ThreadSummary } from "../../../platform/tauri/bindings";
import { AttachmentIcon, StarIcon } from "../../../shared/ui/icons";
import type { AccountIndex } from "../../accounts/model/accounts";
import { formatListDate, sendersLabel } from "../model/format";
import type { OlderStatus } from "./useOlderMail";

const ROW_HEIGHT = 72;
/** The line under the last row while older mail loads (or failed to). */
const FOOTER_HEIGHT = 40;

type Props = {
  threads: ThreadSummary[];
  accounts: AccountIndex;
  /** Show each row's account marker (views that mix accounts). */
  showAccount: boolean;
  selectedId: ThreadId | null;
  /** Conversations picked with ⌘/⇧-click or `x`. */
  checked: ReadonlySet<ThreadId>;
  /** A click: open it, or with ⌘ toggle it, or with ⇧ pick a range. */
  onSelect: (id: ThreadId, how: "open" | "toggle" | "range") => void;
  /** A click on the empty area below the rows, as in Mail and Mimestream. */
  onClearSelection: () => void;
  hasMore: boolean;
  loadMore: () => void;
  /** The first page, or the next cached page, is loading. */
  loading: boolean;
  /** Fetching older mail from Gmail past the end of the cache. */
  older: { status: OlderStatus; busy: boolean; retry: () => void };
  /** Shown when the view has no conversations. */
  empty: React.ReactNode;
};

export function ThreadList({
  threads,
  accounts,
  showAccount,
  selectedId,
  checked,
  onSelect,
  onClearSelection,
  hasMore,
  loadMore,
  loading,
  older,
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
  const busy = loading || older.busy;
  useEffect(() => {
    if (hasMore && !busy && lastIndex >= threads.length - 20) loadMore();
  }, [hasMore, busy, lastIndex, threads.length, loadMore]);
  const footer = older.status !== "idle";

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
      <div
        style={{
          height: virtualizer.getTotalSize() + (footer ? FOOTER_HEIGHT : 0),
          position: "relative",
        }}
      >
        {items.map((item) => {
          const t = threads[item.index]!;
          const selected = t.id === selectedId;
          const picked = checked.has(t.id);
          const account = showAccount ? accounts.get(t.accountId) : undefined;
          return (
            <div
              key={t.id}
              role="option"
              aria-selected={selected || picked}
              onClick={(e) =>
                onSelect(t.id, e.metaKey || e.ctrlKey ? "toggle" : e.shiftKey ? "range" : "open")
              }
              // ⇧-click shouldn't also select the rows' text.
              onMouseDown={(e) => {
                if (e.shiftKey) e.preventDefault();
              }}
              // pl-6 leaves a fixed gutter for the unread dot, so senders,
              // subjects and snippets line up whether a row is read or not.
              className={`absolute inset-x-0 mx-2 flex flex-col justify-center gap-0.5 rounded-lg pr-3 pl-6 ${
                picked
                  ? "bg-accent/18 ring-1 ring-accent/35 ring-inset"
                  : selected
                    ? "bg-selection-strong"
                    : "hover:bg-selection-subtle"
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
                // Not `truncate` here: its clipping would hide the paperclip
                // in the gutter; the subject truncates itself.
                className={`relative flex min-w-0 items-center gap-1.5 ${t.unread ? "font-semibold text-content" : "font-medium text-content/70"}`}
              >
                {t.hasAttachments && (
                  // In the gutter under the unread dot, centred on the same
                  // line, so it never pushes the subject around.
                  <AttachmentIcon
                    size={11}
                    strokeWidth={2}
                    className="absolute top-1/2 -left-4 -translate-y-1/2 text-content/35"
                    aria-label="Has attachments"
                  />
                )}
                {t.starred && (
                  <StarIcon
                    size={12}
                    strokeWidth={2}
                    className="shrink-0 text-warn"
                    aria-label="Starred"
                  />
                )}
                <span className="truncate">{t.subject || "(no subject)"}</span>
              </div>
              <div className="truncate text-xs font-medium text-content/40">{t.snippet}</div>
            </div>
          );
        })}
        {footer && (
          <div
            className="absolute inset-x-0 flex items-center justify-center gap-1.5 text-xs text-content/45"
            style={{ top: virtualizer.getTotalSize(), height: FOOTER_HEIGHT }}
          >
            {older.status === "loading" ? (
              "Loading older mail…"
            ) : (
              <>
                Couldn’t load older mail.
                <button
                  type="button"
                  className="underline hover:text-content"
                  onClick={older.retry}
                >
                  Try again
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
