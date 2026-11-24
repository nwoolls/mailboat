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
 * Words as the browser's word segmenter finds them, so text in languages
 * written without spaces (Japanese, Chinese, Thai) also comes a word at a
 * time; missing, only whitespace ends a word.
 */
const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "word" })
    : null;
/** How far back to look for the end of a word (a longer run is cut at whitespace). */
const LOOK_BACK = 48;

/**
 * Where to cut the text for showing `shown` characters: back to the end of
 * the last whole word, so a word never appears in halves. The whole text
 * once it has all been shown and nothing more is coming.
 */
export function wordCut(text: string, shown: number, done: boolean): number {
  const n = Math.min(Math.floor(shown), text.length);
  if (n >= text.length) return done ? text.length : wordEnd(text, text.length, false);
  return wordEnd(text, n, true);
}

/**
 * What stays on screen of `prev` (the text shown) when the text becomes
 * `text`: all of it if `text` goes on from it at a word's end; otherwise the
 * whole words both begin with. The same rule while rendering and between
 * frames, so they never disagree.
 */
export function keptCut(prev: string, text: string): number {
  const n = text.startsWith(prev) ? prev.length : sharedStart(prev, text);
  if (n >= text.length) return text.length;
  return wordEnd(text, n, true);
}

/**
 * The last place a word ends at or before `n` (before it, when the text
 * past `n` isn't known yet: `known` false). A word ends where whitespace
 * starts, or between two words the segmenter tells apart.
 */
function wordEnd(text: string, n: number, known: boolean): number {
  if (known && /\s/.test(text[n] ?? "")) return n;
  if (segmenter) {
    const from = Math.max(0, n - LOOK_BACK);
    let best = from === 0 ? 0 : -1;
    for (const { index } of segmenter.segment(text.slice(from, known ? n + 1 : n))) {
      const at = from + index;
      // The window's own start isn't known to be a word's start.
      if (index === 0 || at > n || (!known && at >= n)) continue;
      if (!/\s/.test(text[at - 1]!)) best = at;
    }
    if (best >= 0) return best;
  }
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
  if (segmenter) return Array.from(segmenter.segment(text), (s) => s.segment);
  return text.match(/\s+|\S+/g) ?? [];
}
