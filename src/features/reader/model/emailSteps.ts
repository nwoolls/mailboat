/**
 * `n` / `p` in an open conversation: the email to bring to the top of the
 * reader. `tops` are each email card's top relative to the reader's top
 * (negative: scrolled past), in the order shown. Next is the first card
 * below the top; previous the last one above it. Null at either end.
 */
export function emailStep(tops: number[], dir: "next" | "prev"): number | null {
  // A pixel either way still counts as at the top (rounding).
  if (dir === "next") {
    const i = tops.findIndex((t) => t > 1);
    return i < 0 ? null : i;
  }
  const i = tops.findLastIndex((t) => t < -1);
  return i < 0 ? null : i;
}
