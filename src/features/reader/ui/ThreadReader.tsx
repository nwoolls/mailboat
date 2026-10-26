import { useEffect, useRef, useState } from "react";
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
import { useThreadAction } from "../../mailbox/ui/useThreadAction";
import { MARK_READ_DELAY_MS, inOrder } from "../../mailbox/model/viewingPrefs";
import { viewingPrefs } from "../../mailbox/ui/viewingPrefs";
import { wholePixelSlack } from "../model/pixelSnap";
import { useTextZoom } from "../../settings/ui/textSize";
import { EmailContextMenu } from "./EmailContextMenu";
import { ThreadSummaryCard } from "../../ai/ui/ThreadSummaryCard";
import { MessageFrame } from "./MessageFrame";

/**
 * Messages expanded when a thread opens: unread ones plus the newest.
 * A draft reply doesn't count as the newest (it shows as the reply being
 * written instead), so the last real message opens whether or not the
 * draft has been cached yet.
 */
export function initiallyExpanded(
  messages: Pick<MessageMeta, "id" | "unread" | "draft">[],
): Set<MessageId> {
  const real = messages.filter((m) => !m.draft);
  const shown = real.length > 0 ? real : messages;
  const open = new Set(shown.filter((m) => m.unread).map((m) => m.id));
  const last = shown.at(-1);
  if (last) open.add(last.id);
  return open;
}

/**
 * Unread messages that weren't in the conversation when last looked at:
 * a reply that arrived while it was open. Pressing `u` changes no message
 * IDs, so it never counts as an arrival.
 */
export function unreadArrivals(
  seen: ReadonlySet<MessageId>,
  messages: Pick<MessageMeta, "id" | "unread" | "draft">[],
): MessageId[] {
  return messages.filter((m) => m.unread && !m.draft && !seen.has(m.id)).map((m) => m.id);
}

/**
 * The email a conversation opens scrolled to: the first unread one, when
 * read ones come before it (it's at the top already otherwise). In the
 * order shown, so "newest first" lands on the newest unread.
 */
export function landingMessage(
  shown: Pick<MessageMeta, "id" | "unread" | "draft">[],
): MessageId | null {
  const index = shown.findIndex((m) => m.unread && !m.draft);
  return index > 0 ? shown[index]!.id : null;
}

/** How long the landing email is kept at the top while the emails above settle. */
const LANDING_SETTLE_MS = 1500;

export function ThreadReader({
  threadId,
  accounts,
  renderFooter,
}: {
  threadId: ThreadId;
  accounts: AccountIndex;
  /** Under the last message: the reply buttons, or a reply being written. */
  renderFooter?: (detail: ThreadDetail) => React.ReactNode;
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
      renderFooter={renderFooter}
    />
  );
}

function ThreadBody({
  detail: data,
  accounts,
  leaving,
  renderFooter,
}: {
  detail: ThreadDetail;
  accounts: AccountIndex;
  leaving: boolean;
  renderFooter?: (detail: ThreadDetail) => React.ReactNode;
}) {
  const contentRef = useWholePixelHeight();
  // Settings → Appearance → Text size. Zoomed piece by piece, never around
  // an email: WebKit misreports a frame's size inside a zoomed parent, so
  // each email zooms itself (`MessageFrame`).
  const zoom = useTextZoom();
  const [expanded, setExpanded] = useState<Set<MessageId>>(() => initiallyExpanded(data.messages));
  // Every message opened so far; its body stays mounted when closed.
  const [opened, setOpened] = useState<Set<MessageId>>(expanded);
  if ([...expanded].some((id) => !opened.has(id))) setOpened(new Set([...opened, ...expanded]));
  // Opening a conversation marks it read, once (pressing `u` afterwards
  // leaves it unread), and so does each unread reply that arrives while
  // it's open, which also opens that reply. Counted rather than read from
  // the thread's unread flag, so a later `u` doesn't re-trigger it.
  // Settings → Viewing: at once, after a few seconds (moving on sooner
  // leaves it unread), or never. Also the order of the messages.
  const [seen, setSeen] = useState<ReadonlySet<MessageId>>(
    () => new Set(data.messages.map((m) => m.id)),
  );
  const [readRequests, setReadRequests] = useState(data.thread.unread ? 1 : 0);
  if (data.messages.some((m) => !seen.has(m.id))) {
    const arrived = unreadArrivals(seen, data.messages);
    setSeen(new Set(data.messages.map((m) => m.id)));
    if (arrived.length > 0) {
      setReadRequests(readRequests + 1);
      setExpanded(new Set([...expanded, ...arrived]));
    }
  }
  const { markRead, order } = viewingPrefs.use();
  const threadId = data.thread.id;
  const { mutate: act } = useThreadAction();
  useEffect(() => {
    if (readRequests === 0 || markRead === "never") return;
    const read = () => act({ ids: [threadId], action: { kind: "read", read: true } });
    if (markRead === "open") return read();
    const timer = window.setTimeout(read, MARK_READ_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [threadId, readRequests, markRead, act]);
  // A draft reply opens as the reply being written at the foot (as in
  // Gmail), so it isn't listed as a message too. A conversation that's
  // only a draft still shows it.
  const real = data.messages.filter((m) => !m.draft);
  const shown = inOrder(real.length > 0 ? real : data.messages, order);
  const account = accounts.get(data.thread.accountId);
  const selfEmails = account ? [account.email] : [];
  // Which account it's in matters only when there's more than one.
  const showAccount = accounts.size > 1;
  const articleRef = useLandOn(useState(() => landingMessage(shown))[0]);

  return (
    <article
      ref={articleRef}
      // macOS overlay scrollbars take no width, so a long email appearing
      // doesn't narrow the reader or reflow it. No padding of its own: the
      // window's 8px edge and the splitter frame the cards, so the last
      // card's bottom lines up with the list panel's at the end.
      // Bottom corners round like the list panel's, so whatever reaches
      // the bottom edge is clipped to the same curve, scrolled or not.
      // `reader-scroll`: the frame the reply foot pins itself to (index.css).
      className={`reader-enter reader-scroll flex-1 overflow-y-auto rounded-b-[10px] transition-opacity duration-150 ${
        leaving ? "opacity-50" : ""
      }`}
    >
      <div ref={contentRef}>
        <header className="px-4 pt-5 pb-3" style={{ zoom }}>
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
        <ThreadSummaryCard detail={data} zoom={zoom} />
        {/* Each message is a card on the glass, edged and rounded like the
          list panel; collapsed ones are a shade lighter. Avatar, notice and
          body share one left edge (16px), as does the subject above. */}
        <div className="flex flex-col gap-2">
          {shown.map((m) => {
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
                data-message-id={m.id}
                className={`rounded-[10px] ring-1 ring-stroke ring-inset transition-colors duration-[120ms] ${
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
                  style={{ zoom }}
                >
                  <div className="flex h-7 items-center gap-3">
                    <SenderInitial name={name} />
                    <span
                      className={`max-w-[60%] min-w-0 shrink-0 truncate ${m.unread ? "font-semibold" : "font-medium"}`}
                    >
                      {name}
                    </span>
                    {m.draft && (
                      // As in Gmail: an unsent draft in the conversation.
                      <span className="shrink-0 text-xs font-medium text-danger">Draft</span>
                    )}
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
        {renderFooter?.(data)}
      </div>
      <EmailContextMenu />
    </article>
  );
}

/**
 * Scrolls the reader so the given email's card is at the top, and keeps it
 * there while what's above it finishes laying out (the summary arriving,
 * an expanded email measured), or it would land short. Stops as soon as
 * the reader is scrolled by hand.
 */
function useLandOn(messageId: MessageId | null) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const scroller = ref.current;
    const card = scroller?.querySelector(`[data-message-id="${messageId}"]`);
    if (messageId === null || !scroller || !card) return;
    const land = () => {
      scroller.scrollTop += card.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    };
    land();
    const growing = new ResizeObserver(land);
    if (scroller.firstElementChild) growing.observe(scroller.firstElementChild);
    const stop = () => growing.disconnect();
    const settled = window.setTimeout(stop, LANDING_SETTLE_MS);
    const byHand = ["wheel", "pointerdown", "keydown", "touchstart"] as const;
    for (const type of byHand) window.addEventListener(type, stop, { capture: true, once: true });
    return () => {
      stop();
      window.clearTimeout(settled);
      for (const type of byHand) window.removeEventListener(type, stop, { capture: true });
    };
  }, [messageId]);
  return ref;
}

/**
 * Keeps the element's height a whole number of pixels by adding the
 * missing fraction as padding at its top (where it can't be seen). Text
 * line heights make the reader's content end part-way through a pixel;
 * scrolled to the end, that sliver of the last card (its bottom edge) was
 * cut off, leaving it half a point off the list panel's bottom.
 */
function useWholePixelHeight() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // The content box excludes the padding set here, so this never loops.
    const observer = new ResizeObserver(([entry]) => {
      const height = entry?.contentRect.height ?? 0;
      el.style.paddingTop = `${wholePixelSlack(height)}px`;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return ref;
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
