/**
 * `n` / `p` in an open conversation: the email to bring to the top of the
 * reader. `tops` are each email card's top relative to the reader's top
 * (negative: scrolled past), in the order shown. Next is the first card
 * below the top; previous the last one above it. Null at either end.
 *
 * `held`: the card a step just brought to the top and is still settling
 * (index), which steps from it instead: while it settles its top wobbles
 * by a pixel or so, enough to count as below the top, so `n` straight
 * after `p` picked it again and went nowhere.
 */
export function emailStep(
  tops: number[],
  dir: "next" | "prev",
  held: number | null = null,
): number | null {
  if (held !== null) {
    const i = dir === "next" ? held + 1 : held - 1;
    return i >= 0 && i < tops.length ? i : null;
  }
  // A pixel either way still counts as at the top (rounding).
  if (dir === "next") {
    const i = tops.findIndex((t) => t > 1);
    return i < 0 ? null : i;
  }
  const i = tops.findLastIndex((t) => t < -1);
  return i < 0 ? null : i;
}
