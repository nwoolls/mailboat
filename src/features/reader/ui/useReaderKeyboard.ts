import type React from "react";
import { useRef, useState } from "react";
import type { MessageId } from "../../../platform/tauri/bindings";
import { type CardBox, firstOutlined, readerKeyFor, readerStep } from "../model/readerKeys";

/** Longer than a smooth scroll takes. */
const HEADING_MS = 600;

function isEditable(el: EventTarget | null): boolean {
  return (
    el instanceof HTMLElement &&
    (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))
  );
}

/** Inside the reply being written, which handles its own keys. */
function inReply(el: EventTarget | null): boolean {
  return el instanceof Element && el.closest("[data-inline-reply]") !== null;
}

/**
 * Each email card in the reader, measured from the top of its view as it
 * will be once the reader is at `scrollTop` (where a smooth scroll is
 * heading), else as it is.
 */
function measure(
  reader: HTMLElement,
  scrollTop = reader.scrollTop,
): { ids: MessageId[]; boxes: CardBox[] } {
  const top = reader.getBoundingClientRect().top + (scrollTop - reader.scrollTop);
  const cards = [...reader.querySelectorAll<HTMLElement>("section[data-message-id]")];
  return {
    ids: cards.map((c) => Number(c.dataset.messageId) as MessageId),
    boxes: cards.map((c) => {
      const box = c.getBoundingClientRect();
      return {
        top: box.top - top,
        bottom: box.bottom - top,
        open: c.querySelector(':scope > button[aria-expanded="true"]') !== null,
      };
    }),
  };
}

/**
 * The open conversation with the keyboard (owner, 2026-11-23): it takes
 * it on → or Enter from the list (`focusReader`) or a click in it, and
 * outlines an email. ↑ / ↓, → / ← and Esc then work here (see
 * `model/readerKeys`); every other key (j / k, r, e…) still reaches the
 * app's shortcuts. The outline shows only while the conversation has the
 * keyboard.
 */
export function useReaderKeyboard({
  landed,
  setOpen,
  back,
}: {
  /** The email the reader landed on (the first unread), if any. */
  landed: MessageId | null;
  setOpen: (id: MessageId, open: boolean) => void;
  /** While the list and reader take turns (a narrow window): going back shows the list. */
  back?: () => void;
}) {
  const [outlined, setOutlined] = useState<MessageId | null>(null);
  const [focused, setFocused] = useState(false);
  // Where the last key's smooth scroll is heading. Measured from there, a
  // key pressed before it arrives (or held down) goes on from where the
  // last one went, not from part way: mid-scroll, the email just outlined
  // still looked cut off at the top, and ↑ scrolled instead of moving on.
  // Forgotten once there, or after HEADING_MS (a wheel took over, say).
  const heading = useRef<{ top: number; until: number } | null>(null);
  const aimed = (reader: HTMLElement) => {
    const to = heading.current;
    if (!to || performance.now() > to.until || Math.abs(reader.scrollTop - to.top) <= 1)
      return (heading.current = null);
    return to.top;
  };
  const scrollTo = (reader: HTMLElement, from: number, by: number) => {
    const max = reader.scrollHeight - reader.clientHeight;
    const to = Math.max(0, Math.min(max, from + by));
    heading.current = { top: to, until: performance.now() + HEADING_MS };
    reader.scrollTo({ top: to, behavior: "smooth" });
  };

  /** The outlined email's index, picked afresh if it's gone or scrolled out of view. */
  const current = (reader: HTMLElement) => {
    const from = aimed(reader) ?? reader.scrollTop;
    const { ids, boxes } = measure(reader, from);
    const view = reader.clientHeight;
    let at = outlined === null ? -1 : ids.indexOf(outlined);
    const box = boxes[at];
    // Scrolled out of view (Space, the scroll bar): the first one showing.
    if (box && (box.bottom <= 0 || box.top >= view)) at = firstOutlined(boxes, view, -1);
    if (!box) at = firstOutlined(boxes, view, landed === null ? -1 : ids.indexOf(landed));
    return { ids, boxes, at, view, from };
  };

  const onFocus = (e: React.FocusEvent<HTMLElement>) => {
    const keys = !isEditable(e.target) && !inReply(e.target);
    setFocused(keys);
    if (keys && outlined === null) {
      const { ids, boxes } = measure(e.currentTarget);
      const at = firstOutlined(
        boxes,
        e.currentTarget.clientHeight,
        landed === null ? -1 : ids.indexOf(landed),
      );
      setOutlined(ids[at] ?? null);
    }
  };

  const onBlur = (e: React.FocusEvent<HTMLElement>) => {
    const to = e.relatedTarget;
    setFocused(
      to instanceof Node && e.currentTarget.contains(to) && !isEditable(to) && !inReply(to),
    );
  };

  // A click on an email outlines it; a click anywhere else in the
  // conversation (not the reply) gives it the keyboard too, as a click on
  // a header button doesn't focus anything in WebKit.
  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (inReply(e.target) || isEditable(e.target)) return;
    const card = e.target instanceof Element ? e.target.closest("section[data-message-id]") : null;
    if (card instanceof HTMLElement) setOutlined(Number(card.dataset.messageId) as MessageId);
    const reader = e.currentTarget;
    requestAnimationFrame(() => {
      if (!reader.contains(document.activeElement)) reader.focus({ preventScroll: true });
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (inReply(e.target)) return;
    const reader = e.currentTarget;
    // The reader scrolls itself, rather than the list moving.
    if (["PageUp", "PageDown", "Home", "End"].includes(e.key)) {
      e.stopPropagation();
      return;
    }
    const key = readerKeyFor(e, isEditable(e.target));
    if (!key) return;
    // Enter on a focused button presses it.
    if (
      key === "open" &&
      e.key === "Enter" &&
      e.target instanceof Element &&
      e.target.closest("button, a")
    )
      return;
    const { ids, boxes, at, view, from } = current(reader);
    const step = readerStep(key, boxes, at, view);
    e.preventDefault();
    e.stopPropagation();
    if (ids[at] !== outlined) setOutlined(ids[at] ?? null);
    if (!step) return;
    const id = ids[at];
    switch (step.kind) {
      case "scroll":
        scrollTo(reader, from, step.by);
        return;
      case "move":
        setOutlined(ids[step.to] ?? null);
        if (step.by !== 0) scrollTo(reader, from, step.by);
        return;
      case "open":
      case "close":
        if (id !== undefined) setOpen(id, step.kind === "open");
        return;
      case "leave":
        // Back to the list: the app's keys move it again, and the next Esc
        // hides the reader.
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        back?.();
        return;
    }
  };

  return {
    /** The email outlined for the keyboard, when the conversation has it. */
    outlined: focused ? outlined : null,
    handlers: { onFocus, onBlur, onPointerDown, onKeyDown },
  };
}
