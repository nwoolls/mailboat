import { emailStep } from "../model/emailSteps";

/** How long `n` / `p` keep the email at the top: past the 200ms fold animation. */
const HOLD_MS = 350;

/** The email the last `n` / `p` is holding at the top, and until when. */
let holding: { card: HTMLElement; until: number } | null = null;

/** The reader that's showing (a closing one is inert), if any. */
function shownReader(): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(".reader-scroll"))
    if (!el.closest("[inert]")) return el;
  return null;
}

/** Space / ⇧Space: the open conversation a screenful down or up. */
export function pageReader(dir: 1 | -1): boolean {
  const reader = shownReader();
  if (!reader) return false;
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
    align();
    if (performance.now() < hold.until) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  return true;
}
