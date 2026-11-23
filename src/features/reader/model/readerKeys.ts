/**
 * The keys of an open conversation once it has the keyboard (→ or Enter
 * from the list, or a click in it; owner, 2026-11-23): ↑ / ↓ go through
 * its emails, reading down a long one first; → or Enter opens the
 * outlined email, ← closes it, and ← on a closed one or Esc goes back to
 * the list. A reply being written is the last stop, after the emails:
 * → or Enter on it goes back into its text.
 */
export type ReaderKey = "down" | "up" | "open" | "close" | "leave";

const KEYS: Record<string, ReaderKey> = {
  ArrowDown: "down",
  ArrowUp: "up",
  ArrowRight: "open",
  Enter: "open",
  ArrowLeft: "close",
  Escape: "leave",
};

/** Maps a keydown in the conversation to what it does, ignoring typing and modifiers. */
export function readerKeyFor(
  e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
  inEditable: boolean,
): ReaderKey | null {
  if (inEditable || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return null;
  return KEYS[e.key] ?? null;
}

/** An email card, measured from the top of the reader's view, in pixels. */
export type CardBox = {
  top: number;
  bottom: number;
  open: boolean;
  /** The reply being written, the last stop after the emails. */
  reply?: boolean;
};

/** What a key does: scroll the reader, outline another email, or the rest. */
export type ReaderStep =
  | { kind: "scroll"; by: number }
  | { kind: "move"; to: number; by: number }
  | { kind: "open" | "close" | "leave" }
  /** Back into the reply's text, where the cursor was. */
  | { kind: "write" };

/** Room kept above or below an email brought into view, in pixels. */
export const EDGE_PX = 8;

/** How far ↑ / ↓ scroll through a long email: a quarter of the view, 40px at least. */
export function readerLineStep(viewHeight: number): number {
  return Math.max(40, Math.round(viewHeight * 0.25));
}

/**
 * How far to scroll so a card shows: not at all when it does, the least
 * movement when it fits, and when it doesn't, its top going down (`start`)
 * or its end going up (`end`), so reading carries on in the same direction.
 */
export function revealBy(card: CardBox, viewHeight: number, from: "start" | "end"): number {
  const fits = card.bottom - card.top <= viewHeight - 2 * EDGE_PX;
  if (card.top >= 0 && card.bottom <= viewHeight) return 0;
  if (fits) return card.top < 0 ? card.top - EDGE_PX : card.bottom - viewHeight + EDGE_PX;
  return from === "start" ? card.top - EDGE_PX : card.bottom - viewHeight + EDGE_PX;
}

/**
 * The step a key takes from the outlined email (`at`, an index into
 * `cards`, in the order shown). ↓ scrolls through the outlined email until
 * its end shows, then outlines the next; ↑ the same, upward. Past the last
 * email ↓ keeps scrolling (to the reply under it), and before the first
 * ↑ does (to the subject and summary).
 */
export function readerStep(
  key: ReaderKey,
  cards: CardBox[],
  at: number,
  viewHeight: number,
): ReaderStep | null {
  const card = cards[at];
  if (!card) return null;
  const step = readerLineStep(viewHeight);
  switch (key) {
    case "down": {
      if (card.bottom > viewHeight + 1)
        return { kind: "scroll", by: Math.min(step, card.bottom - viewHeight + EDGE_PX) };
      const next = cards[at + 1];
      if (!next) return { kind: "scroll", by: step };
      return { kind: "move", to: at + 1, by: revealBy(next, viewHeight, "start") };
    }
    case "up": {
      if (card.top < -1) return { kind: "scroll", by: Math.max(-step, card.top - EDGE_PX) };
      const previous = cards[at - 1];
      if (!previous) return { kind: "scroll", by: -step };
      return { kind: "move", to: at - 1, by: revealBy(previous, viewHeight, "end") };
    }
    case "open":
      if (card.reply) return { kind: "write" };
      return card.open ? null : { kind: "open" };
    case "close":
      return card.open && !card.reply ? { kind: "close" } : { kind: "leave" };
    case "leave":
      return { kind: "leave" };
  }
}

/**
 * The email to outline when the conversation takes the keyboard: the one
 * it landed on (the first unread), else the first one showing in the view.
 */
export function firstOutlined(cards: CardBox[], viewHeight: number, landed: number): number {
  if (landed >= 0) return landed;
  const showing = cards.findIndex((c) => c.bottom > 0 && c.top < viewHeight);
  return showing < 0 ? 0 : showing;
}
