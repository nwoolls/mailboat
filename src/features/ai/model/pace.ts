/**
 * Pacing an AI answer onto the screen. Providers deliver text unevenly:
 * Claude in small pieces, Apple Intelligence a sentence at a time, ChatGPT
 * (Codex) all at once when it's finished. The answer is let out at an even
 * pace instead, which speeds up when it falls behind, so every provider
 * reads the same way and none lags far behind what has arrived.
 */

/** The slowest pace, in characters a second (about as fast as reading). */
export const MIN_RATE = 60;
/** While more is coming, how far behind the arrived text it may fall. */
export const BEHIND_SECONDS = 0.55;
/** Once the answer is in, the most time the rest takes to show. */
export const DRAIN_SECONDS = 0.9;
/** The pace once the answer is in, whatever is left. */
export const DRAIN_MIN_RATE = 110;

/**
 * The pace while more is coming, in characters a second: fast enough that
 * the screen is never more than `BEHIND_SECONDS` behind what has arrived.
 */
export function streamRate(behind: number): number {
  return Math.max(MIN_RATE, behind / BEHIND_SECONDS);
}

/**
 * The pace once the whole answer is in, set once from what's left then
 * (worked out again each frame, it kept slowing down near the end).
 */
export function drainRate(behind: number): number {
  return Math.max(DRAIN_MIN_RATE, behind / DRAIN_SECONDS);
}

/**
 * How many characters are shown after `seconds` more at `rate`, given how
 * many were (a fraction is kept between frames) and how many have arrived.
 */
export function nextShown(shown: number, arrived: number, rate: number, seconds: number): number {
  if (shown >= arrived) return arrived;
  return Math.min(arrived, shown + rate * seconds);
}

/**
 * Where to cut the text for showing `shown` characters: back to the end of
 * the last whole word, so a word never appears in halves. The whole text
 * once it has all been shown and nothing more is coming.
 */
export function wordCut(text: string, shown: number, done: boolean): number {
  const n = Math.min(Math.floor(shown), text.length);
  if (n >= text.length) return done ? text.length : lastBreak(text, n);
  // A word ends where whitespace starts.
  return /\s/.test(text[n] ?? "") ? n : lastBreak(text, n);
}

function lastBreak(text: string, n: number): number {
  for (let i = n - 1; i >= 0; i--) if (/\s/.test(text[i]!)) return i;
  return 0;
}

/** How much of `next` repeats the start of `prev`: kept as shown when the text is replaced. */
export function sharedStart(prev: string, next: string): number {
  let i = 0;
  while (i < prev.length && i < next.length && prev[i] === next[i]) i++;
  return i;
}

/** Words and the spaces between them, in order (for fading words in one at a time). */
export function words(text: string): string[] {
  return text.match(/\s+|\S+/g) ?? [];
}
