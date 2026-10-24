import { emailStep } from "../model/emailSteps";

/** How long `n` / `p` keep the email at the top: past the 200ms fold animation. */
const HOLD_MS = 350;

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
  const i = emailStep(
    cards.map((c) => c.getBoundingClientRect().top - top),
    dir,
  );
  const card = i === null ? undefined : cards[i];
  if (!card) return true;
  // Jumped to, then opened if folded, so it grows down from the top.
  // (Opened while still above, WebKit kept the email on screen in place
  // as it grew, and the reader never got there.) Then held at the top
  // while emails above finish folding or opening (they animate), which
  // would otherwise leave it short.
  const align = () => {
    reader.scrollTop += card.getBoundingClientRect().top - reader.getBoundingClientRect().top;
  };
  align();
  card.querySelector<HTMLButtonElement>(':scope > button[aria-expanded="false"]')?.click();
  const until = performance.now() + HOLD_MS;
  const hold = () => {
    align();
    if (performance.now() < until) requestAnimationFrame(hold);
  };
  requestAnimationFrame(hold);
  return true;
}
