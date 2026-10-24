import { useVirtualizer } from "@tanstack/react-virtual";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ThreadId, ThreadSummary } from "../../../platform/tauri/bindings";
import { AiIcon, AttachmentIcon, StarIcon } from "../../../shared/ui/icons";
import { useAiStatus, useAppSettings } from "../../../shared/lib/queries";
import { useLineSummaries } from "../../ai/ui/lineSummaries";
import { CodePill } from "../../codes/ui/CodePill";
import { aiChoices, isReady } from "../../ai/model/providers";
import type { AccountIndex } from "../../accounts/model/accounts";
import { formatListDate, senderParts } from "../model/format";
import { swipeActions, swipePose } from "../model/swipe";
import type { ThreadAction } from "../model/threadActions";
import { SwipeBack, SwipeButton } from "./SwipeLayers";
import type { OlderStatus } from "./useOlderMail";
import { useSwipe } from "./useSwipe";
import { useTextZoom } from "../../settings/ui/textSize";

const ROW_HEIGHT = 72;
/** Room before the row's text for the account ring and star (12px + gap). */
const ICON_COLUMN = 18;
/** The line under the last row while older mail loads (or failed to). */
const FOOTER_HEIGHT = 40;

/**
 * How far down each view was scrolled, by `selectionKey`, until the app
 * quits. Outside the component, which unmounts while a view is empty.
 */
const scrollPositions = new Map<string, number>();

type Props = {
  /**
   * Which view the list is for (`selectionKey`). Each view comes back
   * scrolled as far as it was left; one not seen yet starts at the top.
   */
  viewKey: string;
  /** `threads` are still the previous view's, until this one's arrive. */
  placeholder: boolean;
  threads: ThreadSummary[];
  accounts: AccountIndex;
  /** Show each row's account marker (views that mix accounts). */
  showAccount: boolean;
  selectedId: ThreadId | null;
  /** The row a conversation was just closed from (Esc): shaded, not open. */
  cursorId: ThreadId | null;
  /** Conversations picked with ⌘/⇧-click or `x`. */
  checked: ReadonlySet<ThreadId>;
  /** A click: open it, or with ⌘ toggle it, or with ⇧ pick a range. */
  onSelect: (id: ThreadId, how: "open" | "toggle" | "range") => void;
  /** A click on the empty area below the rows, as in Mail and Mimestream. */
  onClearSelection: () => void;
  /** Right-click on a row: its menu at the pointer. */
  onRowMenu: (id: ThreadId, at: { x: number; y: number }) => void;
  /** The row whose menu is open: outlined, as in Mail. */
  menuRowId: ThreadId | null;
  hasMore: boolean;
  loadMore: () => void;
  /** The first page, or the next cached page, is loading. */
  loading: boolean;
  /** Fetching older mail from Gmail past the end of the cache. */
  older: { status: OlderStatus; busy: boolean; retry: () => void; searching?: boolean };
  /** Shown when the view has no conversations. */
  empty: React.ReactNode;
  /** A two-finger swipe on a row did this (archive, trash, read…). */
  onSwipe: (id: ThreadId, action: ThreadAction) => void;
};

export function ThreadList({
  viewKey,
  placeholder,
  threads,
  accounts,
  showAccount,
  selectedId,
  cursorId,
  checked,
  onSelect,
  onClearSelection,
  onRowMenu,
  menuRowId,
  hasMore,
  loadMore,
  loading,
  older,
  empty,
  onSwipe,
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // The list element as state too, so the swipe's listeners attach once
  // it exists (it doesn't while the view is empty).
  const [listEl, setListEl] = useState<HTMLDivElement | null>(null);
  const [rowWidth, setRowWidth] = useState(0);
  useEffect(() => {
    if (!listEl) return;
    // Rows sit 8px in from each side (mx-2).
    const observer = new ResizeObserver(() => setRowWidth(listEl.clientWidth - 16));
    observer.observe(listEl);
    return () => observer.disconnect();
  }, [listEl]);
  const { swipe, commit } = useSwipe(listEl, threads, onSwipe);
  // Settings → Appearance → Text size: rows grow with their text, which
  // zooms inside them, so positions and swipes stay in whole rows.
  const zoom = useTextZoom();
  const rowStep = Math.round(ROW_HEIGHT * zoom);
  const virtualizer = useVirtualizer({
    count: threads.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowStep,
    overscan: 12,
  });
  useEffect(() => {
    virtualizer.measure();
  }, [rowStep, virtualizer]);
  const items = virtualizer.getVirtualItems();
  // Settings → AI: a one-line summary in place of the email's first words,
  // for the rows on screen (written in the background as they come into view).
  const listProvider = aiChoices(useAppSettings().data).listSummaries;
  const aiStatus = useAiStatus().data;
  const summarize = listProvider !== null && isReady(aiStatus, listProvider);
  const onScreen = items.flatMap((i) => (threads[i.index] ? [threads[i.index]!.id] : []));
  const lines = useLineSummaries(onScreen, summarize && !placeholder);
  const selfEmails = useMemo(() => [...accounts.values()].map((a) => a.email), [accounts]);

  // Fetch the next page when the user nears the end.
  const lastIndex = items.at(-1)?.index ?? 0;
  const busy = loading || older.busy;
  useEffect(() => {
    if (hasMore && !busy && lastIndex >= threads.length - 20) loadMore();
  }, [hasMore, busy, lastIndex, threads.length, loadMore]);
  const footer = older.status !== "idle";

  // Every view's list is drawn in this one scroll area, so without this a
  // new view opened scrolled down as far as the last one was. Once the new
  // view's own rows are in (not the previous view's, standing in), it goes
  // to where that view was left; before paint, so nothing jumps.
  const shownKey = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (placeholder || shownKey.current === viewKey) return;
    shownKey.current = viewKey;
    virtualizer.scrollToOffset(scrollPositions.get(viewKey) ?? 0);
  }, [viewKey, placeholder, virtualizer]);

  // Keep the keyboard selection visible.
  useEffect(() => {
    const index = threads.findIndex((t) => t.id === selectedId);
    if (index >= 0) virtualizer.scrollToIndex(index, { align: "auto" });
  }, [selectedId, threads, virtualizer]);

  // Nothing yet, but Gmail is being asked (or failed): show that line
  // rather than "nothing here".
  if (!loading && threads.length === 0 && !footer) return empty;

  return (
    <div
      ref={(el) => {
        scrollRef.current = el;
        setListEl(el);
      }}
      role="listbox"
      // Only a click on the list's own background (below the last row)
      // clears the selection; the gaps between rows belong to the rows'
      // container, so a slightly-off click there doesn't close the reader.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClearSelection();
      }}
      aria-label="Conversations"
      onScroll={(e) => {
        if (shownKey.current !== null)
          scrollPositions.set(shownKey.current, e.currentTarget.scrollTop);
      }}
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
          const swiped = swipe?.id === t.id ? swipe : null;
          const raw = swiped ? swipePose(swiped.d) : null;
          // Settling open (the spring overshoots a little) or resting
          // there, the ring stays empty: it only fills under the fingers.
          const pose =
            raw && swiped && (swiped.mode === "settle" || swiped.mode === "open")
              ? { ...raw, ring: 0, armed: false }
              : raw;
          // Pulled the other way past closed: the row moves, no button.
          const bare = swiped?.bare === true;
          const swipeAction = swiped && !bare ? swipeActions(t)[swiped.side] : null;
          const rowHeight = rowStep - 4;
          // Sliding out, or out and waiting for the list to drop it.
          const out = swiped?.mode === "out" || swiped?.mode === "gone";
          const back = swiped?.mode === "back";
          return (
            <Fragment key={t.id}>
              {swiped && pose && !bare && !back && (
                <div
                  className="pointer-events-none absolute inset-x-0 mx-2"
                  style={{
                    top: item.start,
                    height: rowHeight,
                    opacity: out ? 0 : 1,
                    transition: out ? "opacity 140ms ease-in" : undefined,
                  }}
                >
                  <SwipeBack
                    pose={out ? { ...pose, shift: pose.shift + rowWidth } : pose}
                    side={swiped.side}
                    width={rowWidth}
                    height={rowHeight}
                    selected={selected || picked}
                  />
                </div>
              )}
              <div
                data-thread-id={t.id}
                role="option"
                aria-selected={selected || picked}
                onClick={(e) =>
                  onSelect(t.id, e.metaKey || e.ctrlKey ? "toggle" : e.shiftKey ? "range" : "open")
                }
                onContextMenu={(e) => {
                  e.preventDefault();
                  onRowMenu(t.id, { x: e.clientX, y: e.clientY });
                }}
                // ⇧-click shouldn't also select the rows' text.
                onMouseDown={(e) => {
                  if (e.shiftKey) e.preventDefault();
                }}
                // pl-6 leaves a fixed gutter for the unread dot, so senders,
                // subjects and snippets line up whether a row is read or not.
                // thread-row: rows glide into place when one leaves or
                // arrives (index.css); swipe-out / swipe-back animate a swipe.
                className={`thread-row absolute inset-x-0 mx-2 flex flex-col justify-center gap-0.5 rounded-lg pr-3 pl-6 ${
                  out ? "swipe-out" : back ? "swipe-back" : ""
                } ${
                  // While swiped, the plate behind is drawn by SwipeBack.
                  swiped && !bare
                    ? ""
                    : picked
                      ? "bg-accent/18 ring-1 ring-accent/35 ring-inset"
                      : selected || t.id === cursorId
                        ? "bg-selection-strong"
                        : "hover:bg-selection-subtle"
                } ${
                  // The row a right-click menu is open for, without opening it.
                  t.id === menuRowId ? "outline-2 -outline-offset-2 outline-accent/60" : ""
                }`}
                style={{
                  top: item.start,
                  height: rowHeight,
                  transform: pose
                    ? `translateX(${(swiped?.side === "left" ? -1 : 1) * (pose.shift + (out ? rowWidth : 0))}px)`
                    : undefined,
                  opacity: out ? 0 : undefined,
                }}
              >
                {/* Sender, subject and snippet all start after a fixed icon
                  column (ICON_COLUMN): the account ring sits in it on the
                  first line and the star under it on the second, so icons
                  line up with icons and text with text on every row. */}
                <div className="flex min-w-0 flex-col gap-0.5" style={{ zoom }}>
                  <div
                    className="relative flex items-center gap-2"
                    style={{ paddingLeft: ICON_COLUMN }}
                  >
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
                        className="absolute top-1/2 left-0.5 h-2 w-2 -translate-y-1/2 rounded-full"
                        style={{
                          border: `1.5px solid color-mix(in srgb, ${account.color} 75%, transparent)`,
                        }}
                        title={account.email}
                        aria-label={account.email}
                      />
                    )}
                    {/* As in Gmail: people with unread mail in bold, the rest
                    plain, then the message count in grey. */}
                    <span className="truncate">
                      {senderParts(t.senders, selfEmails).map((part, i) => (
                        <span key={part.key}>
                          {i > 0 && (
                            <span className="text-content/60">
                              {part.text === "…" ? " " : ", "}
                            </span>
                          )}
                          <span
                            className={
                              part.unread
                                ? "font-semibold text-content"
                                : "font-medium text-content/75"
                            }
                          >
                            {part.text}
                          </span>
                          {part.text === "…" && " "}
                        </span>
                      ))}
                      {t.messageCount > 1 && (
                        <span className="ml-1.5 text-xs font-normal text-content/45">
                          {t.messageCount}
                        </span>
                      )}
                    </span>
                    <span className="ml-auto shrink-0 text-xs text-content/40">
                      {formatListDate(t.lastMessageAt)}
                    </span>
                  </div>
                  <div
                    // Not `truncate` here: its clipping would hide the paperclip
                    // in the gutter; the subject truncates itself.
                    className={`relative flex min-w-0 items-center ${t.unread ? "font-semibold text-content" : "font-medium text-content/70"}`}
                    style={{ paddingLeft: ICON_COLUMN }}
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
                        className="absolute top-1/2 left-0 -translate-y-1/2 text-warn"
                        aria-label="Starred"
                      />
                    )}
                    <span className="truncate">{t.subject || "(no subject)"}</span>
                    {t.signInCode && <CodePill code={t.signInCode} />}
                  </div>
                  <div
                    className="relative truncate text-xs font-medium text-content/40"
                    style={{ paddingLeft: ICON_COLUMN }}
                  >
                    {summarize && lines.get(t.id) ? (
                      // Hovering shows the email's own first words. The
                      // sparkle sits in the icon column, under the star.
                      <span title={t.snippet}>
                        <AiIcon
                          size={10}
                          strokeWidth={2}
                          className="absolute top-1/2 left-px -translate-y-1/2 text-accent/70"
                          aria-label="Summary"
                        />
                        {lines.get(t.id)}
                      </span>
                    ) : (
                      t.snippet
                    )}
                  </div>
                </div>
              </div>
              {swiped && pose && swipeAction && !out && !back && (
                <div
                  className="pointer-events-none absolute inset-x-0 mx-2"
                  style={{ top: item.start, height: rowHeight }}
                >
                  <SwipeButton
                    pose={pose}
                    side={swiped.side}
                    height={rowHeight}
                    action={swipeAction}
                    open={swiped.mode === "open"}
                    onCommit={commit}
                  />
                </div>
              )}
            </Fragment>
          );
        })}
        {footer && (
          <div
            className="absolute inset-x-0 flex items-center justify-center gap-1.5 text-xs text-content/45"
            style={{ top: virtualizer.getTotalSize(), height: FOOTER_HEIGHT }}
          >
            {older.status === "loading" ? (
              older.searching ? (
                "Searching Gmail…"
              ) : (
                "Loading older mail…"
              )
            ) : (
              <>
                {older.searching ? "Couldn’t search Gmail." : "Couldn’t load older mail."}
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
