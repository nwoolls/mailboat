import type React from "react";
import { type RefObject, useEffect, useRef, useState } from "react";
import type { MessageId } from "../../../platform/tauri/bindings";
import { isEditable } from "../../../shared/lib/editable";
import { REPLY_FOLLOW_EVENT } from "../../../shared/lib/replyFollow";
import { type CardBox, firstOutlined, readerKeyFor, readerStep } from "../model/readerKeys";
import { leaveReader } from "./readerKeys";

/**
 * The reply being written, as an outlined stop: after the emails, it isn't
 * a message, so it takes an ID no message has (they're positive).
 */
export const REPLY_STOP = -1 as MessageId;

/** Keys that scroll the reader other than ↑ / ↓ (Space, n / p: `Shell.tsx`). */
const OTHER_SCROLL_KEYS = new Set([" ", "PageUp", "PageDown", "Home", "End", "n", "p"]);

/** Longer than a smooth scroll takes. */
const HEADING_MS = 600;

/**
 * Frames the reader must also stand still, after HEADING_MS, before the
 * last key's scroll counts as over. The clock alone isn't enough: while
 * the page is busy (a stall on a slow machine) no frame runs and the scroll
 * doesn't move, but the time still passes. Generous, because WebKit's
 * smooth scroll stands still for a few frames before it starts, and again
 * after a stall.
 */
const STILL_FRAMES = 30;

/** Inside the reply being written, which handles its own keys. */
function inReply(el: EventTarget | null): boolean {
  return el instanceof Element && el.closest("[data-inline-reply]") !== null;
}

function isReply(card: HTMLElement): boolean {
  return card.hasAttribute("data-inline-reply");
}

/** Where the last key's smooth scroll is heading (see `useReaderKeyboard`). */
type Aim = {
  top: number;
  until: number;
  away: number;
  reader: HTMLElement;
  /** The frame that watches for the scroll to stop. */
  frame: number;
  /** Stops listening for something else taking the reader over. */
  off: () => void;
};

/** Forgets the aim: its watcher stops, and scroll anchoring is back on. */
function release(heading: RefObject<Aim | null>): null {
  const to = heading.current;
  if (to) {
    cancelAnimationFrame(to.frame);
    to.off();
    to.reader.style.overflowAnchor = "";
  }
  heading.current = null;
  return null;
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
  // In the order shown: the emails, then the reply, if one is being written.
  const cards = [
    ...reader.querySelectorAll<HTMLElement>("section[data-message-id], section[data-inline-reply]"),
  ];
  return {
    ids: cards.map((c) => (isReply(c) ? REPLY_STOP : (Number(c.dataset.messageId) as MessageId))),
    boxes: cards.map((c) => {
      const box = c.getBoundingClientRect();
      return {
        top: box.top - top,
        bottom: box.bottom - top,
        open: isReply(c) || c.querySelector(':scope > button[aria-expanded="true"]') !== null,
        reply: isReply(c),
      };
    }),
  };
}

/**
 * The open conversation with the keyboard (owner, 2026-11-23): it takes
 * it on → or Enter from the list (`focusReader`) or a click in it, and
 * outlines an email (or the reply being written, the last stop).
 * ↑ / ↓, → / ← and Esc then work here (see
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
  // Forgotten once there; or once HEADING_MS has gone by and the reader
  // has stood still for STILL_FRAMES frames (the scroll stopped short);
  // the clock alone forgot it during a stall, before the scroll had moved,
  // and the next ↑ took the email just outlined for scrolled away and
  // outlined the one showing below it instead (found in CI). Also
  // forgotten at once when something else takes the reader over: a wheel,
  // a touch, a click, another scrolling key, the reply being written
  // starting to stick to the bottom (REPLY_FOLLOW_EVENT), or the keyboard
  // coming back from outside (Space or n / p on the list scroll the reader
  // from there). Moving toward the aim, such a scroll looked like the
  // key's own, and kept the aim alive. And forgotten when the reader is
  // further from it than when the key was pressed:
  // a smooth scroll only ever gets closer, so something else moved it (the
  // layout: an email above growing, which the browser makes up for by
  // moving the reader down). Measured from the old aim then, ↓ jumped back
  // to where the last ↑ was heading (found in CI).
  //
  // While it's on its way, the browser's scroll anchoring is off for the
  // reader: opening the outlined email above the view (→ straight after ↑)
  // made the browser move the reader to keep the view in place, which
  // stopped the scroll there, and the outlined email never came into view.
  const heading = useRef<Aim | null>(null);
  const forget = () => release(heading);
  // A conversation switched mid-scroll unmounts the reader (it's keyed by
  // conversation): its watcher stops with it.
  useEffect(
    () => () => {
      release(heading);
    },
    [],
  );
  const aimed = (reader: HTMLElement) => {
    const to = heading.current;
    const away = to ? Math.abs(reader.scrollTop - to.top) : 0;
    if (!to || away <= 1 || away > to.away + 2) return forget();
    return to.top;
  };
  const scrollTo = (reader: HTMLElement, from: number, by: number) => {
    const max = reader.scrollHeight - reader.clientHeight;
    const to = Math.max(0, Math.min(max, from + by));
    forget();
    let last = reader.scrollTop;
    let still = 0;
    // Anchoring back on once the scroll has had its time and stopped.
    const watch = () => {
      if (heading.current !== aim) return;
      still = reader.scrollTop === last ? still + 1 : 0;
      last = reader.scrollTop;
      if (performance.now() > aim.until && still >= STILL_FRAMES) forget();
      else aim.frame = requestAnimationFrame(watch);
    };
    const takenOver = () => {
      if (heading.current === aim) forget();
    };
    const aim: Aim = {
      top: to,
      until: performance.now() + HEADING_MS,
      away: Math.abs(reader.scrollTop - to),
      reader,
      frame: requestAnimationFrame(watch),
      off: () => reader.removeEventListener(REPLY_FOLLOW_EVENT, takenOver),
    };
    reader.addEventListener(REPLY_FOLLOW_EVENT, takenOver);
    heading.current = aim;
    reader.style.overflowAnchor = "none";
    reader.scrollTo({ top: to, behavior: "smooth" });
  };

  /**
   * The outlined stop's index, picked afresh (`picked`) if it's gone or
   * scrolled out of view.
   */
  const current = (reader: HTMLElement) => {
    const from = aimed(reader) ?? reader.scrollTop;
    const { ids, boxes } = measure(reader, from);
    const view = reader.clientHeight;
    let at = outlined === null ? -1 : ids.indexOf(outlined);
    const box = boxes[at];
    let picked = false;
    // Scrolled out of view (Space, the scroll bar): the first one showing.
    if (box && (box.bottom <= 0 || box.top >= view)) {
      at = firstOutlined(boxes, view, -1);
      picked = true;
    }
    if (!box) {
      at = firstOutlined(boxes, view, landed === null ? -1 : ids.indexOf(landed));
      picked = true;
    }
    return { ids, boxes, at, view, from, picked };
  };

  const onFocus = (e: React.FocusEvent<HTMLElement>) => {
    const keys = !isEditable(e.target) && !inReply(e.target);
    setFocused(keys);
    const reader = e.currentTarget;
    // Back from outside (the list): the reader may have been scrolled from
    // there, so the last key's aim no longer says where it is.
    if (!(e.relatedTarget instanceof Node && reader.contains(e.relatedTarget))) forget();
    // Focus inside an email (its header, or back from a click in its body,
    // which hands focus to the email's holder): that email.
    const card = e.target instanceof Element ? e.target.closest("section[data-message-id]") : null;
    if (keys && card instanceof HTMLElement) {
      delete reader.dataset.focusAt;
      setOutlined(Number(card.dataset.messageId) as MessageId);
      return;
    }
    if (keys && reader.dataset.focusAt === "reply") {
      delete reader.dataset.focusAt;
      setOutlined(REPLY_STOP);
      return;
    }
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
  // Any other scrolling takes over from where the last key's scroll was
  // heading.
  const forgetHeading = () => {
    forget();
  };

  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    forgetHeading();
    if (inReply(e.target) || isEditable(e.target)) return;
    const card = e.target instanceof Element ? e.target.closest("section[data-message-id]") : null;
    if (card instanceof HTMLElement) setOutlined(Number(card.dataset.messageId) as MessageId);
    const reader = e.currentTarget;
    requestAnimationFrame(() => {
      if (!reader.contains(document.activeElement)) reader.focus({ preventScroll: true });
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    // Keys that scroll some other way take over (→ / ← / Enter don't
    // scroll, and still go on from where the last arrow was heading).
    if (OTHER_SCROLL_KEYS.has(e.key)) forgetHeading();
    // A key something inside already handled (a menu over an email moving
    // its own focus), or one in a menu or dialog: not the conversation's.
    if (
      e.defaultPrevented ||
      inReply(e.target) ||
      (e.target instanceof Element &&
        e.target.closest('[role="menu"], [role="menuitem"], [role="dialog"], dialog'))
    )
      return;
    // Esc goes to the app's own Esc rules (Shell.tsx): a floating sidebar
    // or picked conversations go first, then back to the list.
    if (e.key === "Escape") return;
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
    const { ids, boxes, at, view, from, picked } = current(reader);
    e.preventDefault();
    e.stopPropagation();
    if (ids[at] !== outlined) setOutlined(ids[at] ?? null);
    // Picked afresh (the outline had scrolled away): ↑ / ↓ stop on the one
    // picked, rather than moving on past it at once. It's showing already
    // (that's how it was picked), so the reader stays where the person
    // scrolled it: bringing a tall email's top or end into view moved it
    // the other way from the key (found in review).
    if (picked && (key === "up" || key === "down")) return;
    const step = readerStep(key, boxes, at, view);
    if (!step) return;
    const id = ids[at];
    switch (step.kind) {
      case "scroll":
        scrollTo(reader, from, step.by);
        return;
      case "move":
        setOutlined(ids[step.to] ?? null);
        // Focus on a control in the email left behind (its header, after
        // Tab or a click) would take Enter there, not to the outlined one.
        if (document.activeElement !== reader && reader.contains(document.activeElement))
          reader.focus({ preventScroll: true });
        if (step.by !== 0) scrollTo(reader, from, step.by);
        return;
      case "open":
      case "close":
        if (id !== undefined) setOpen(id, step.kind === "open");
        return;
      case "write":
        // The editor keeps where its cursor was.
        reader
          .querySelector<HTMLElement>('[data-inline-reply] [role="textbox"][aria-label="Message"]')
          ?.focus();
        return;
      case "leave":
        // Back to the list (← on a closed email or the reply): the app's
        // keys move it again, and the next Esc hides the reader.
        leaveReader();
        back?.();
        return;
    }
  };

  return {
    /** The email outlined for the keyboard, when the conversation has it. */
    outlined: focused ? outlined : null,
    handlers: {
      onFocus,
      onBlur,
      onPointerDown,
      onKeyDown,
      onWheel: forgetHeading,
      onTouchStart: forgetHeading,
    },
  };
}
