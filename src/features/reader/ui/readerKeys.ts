import { emailStep } from "../model/emailSteps";
import { isEditable } from "../../../shared/lib/editable";

/** How long `n` / `p` keep the email at the top: past the 200ms fold animation. */
const HOLD_MS = 350;

/** The email the last `n` / `p` is holding at the top, and until when. */
let holding: { card: HTMLElement; until: number } | null = null;

/**
 * Lets go of the email the last `n` / `p` holds at the top: another key's
 * scroll (↑ / ↓, Space) takes the reader over, or the hold would pull that
 * scroll back every frame until it ran out.
 */
export function endHold(): void {
  holding = null;
}

/** The reader that's showing (a closing one is inert), if any. */
function shownReader(): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(".reader-scroll"))
    if (!el.closest("[inert]")) return el;
  return null;
}

/**
 * → or Enter on the list with a conversation previewed: the conversation
 * takes the keyboard (useReaderKeyboard outlines an email). False if none
 * is showing.
 */
export function focusReader(at?: "reply"): boolean {
  const reader = shownReader();
  if (!reader) return false;
  // From the reply's text (Esc), the reply is outlined, so ↑ goes on to
  // the email above it and → or Enter goes back in (useReaderKeyboard).
  if (at) reader.dataset.focusAt = at;
  reader.focus({ preventScroll: true });
  return true;
}

/**
 * Whether a key's target is the conversation holding the keyboard: inside
 * the reader, not a field and not the reply being written (useReaderKeyboard).
 */
export function inConversation(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(".reader-scroll") !== null &&
    target.closest("[data-inline-reply]") === null &&
    !isEditable(target)
  );
}

/**
 * Back to the list from the conversation (Esc, or ← on a closed email or
 * the reply): the list takes the keyboard, so screen readers and the next
 * keys follow. Blurs instead when the list isn't showing.
 */
export function leaveReader(): void {
  const list = document.querySelector<HTMLElement>('[role="listbox"][aria-label="Conversations"]');
  if (list && list.getClientRects().length > 0 && !list.closest("[inert]")) {
    list.focus({ preventScroll: true });
    return;
  }
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

/** Space / ⇧Space: the open conversation a screenful down or up. */
export function pageReader(dir: 1 | -1): boolean {
  const reader = shownReader();
  if (!reader) return false;
  endHold();
  reader.scrollBy({ top: dir * reader.clientHeight * 0.85, behavior: "smooth" });
  return true;
}

/**
 * `n` / `p`: the next or previous email in the open conversation, at the
 * top of the reader, opened if it was folded.
 */
export function stepEmail(dir: "next" | "prev"): boolean {
  const reader = shownReader();
  if (!reader) return false;
  const top = reader.getBoundingClientRect().top;
  const cards = [...reader.querySelectorAll<HTMLElement>("section[data-message-id]")];
  const settling = holding && performance.now() < holding.until ? cards.indexOf(holding.card) : -1;
  const i = emailStep(
    cards.map((c) => c.getBoundingClientRect().top - top),
    dir,
    settling < 0 ? null : settling,
  );
  const card = i === null ? undefined : cards[i];
  if (!card) return true;
  // Jumped to, then opened if folded, so it grows down from the top.
  // (Opened while still above, WebKit kept the email on screen in place
  // as it grew, and the reader never got there.) Then held at the top
  // while emails above finish folding or opening (they animate), which
  // would otherwise leave it short. A newer step takes over the hold.
  const align = () => {
    reader.scrollTop += card.getBoundingClientRect().top - reader.getBoundingClientRect().top;
  };
  align();
  card.querySelector<HTMLButtonElement>(':scope > button[aria-expanded="false"]')?.click();
  const hold = { card, until: performance.now() + HOLD_MS };
  holding = hold;
  const step = () => {
    if (holding !== hold) return;
    // Gone from this reader (removed by a sync, the conversation changed)
    // or the reader closing: a removed email measures as 0, so holding on
    // scrolled the reader away (code review R4-06).
    const held = card.isConnected && reader.contains(card) && !reader.closest("[inert]");
    if (held) align();
    if (held && performance.now() < hold.until) requestAnimationFrame(step);
    else holding = null;
  };
  requestAnimationFrame(step);
  return true;
}
