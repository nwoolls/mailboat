import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BEHIND_SECONDS, DRAIN_SECONDS } from "../model/pace";
import { usePacedText, WORD_FADE_MS } from "./paced";

// Frames and timers on a clock the test moves (one frame every ~16 ms).
beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "setTimeout",
      "clearTimeout",
      "performance",
    ],
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

function paced(text: string, done: boolean, onCaughtUp?: () => void) {
  return renderHook(
    (p: { text: string; done: boolean }) => usePacedText(p.text, p.done, onCaughtUp),
    {
      initialProps: { text, done },
    },
  );
}

describe("usePacedText", () => {
  it("catches up with a big piece within the time it may fall behind", () => {
    const { result, rerender } = paced("", false);
    const text = "word ".repeat(120) + "more";
    rerender({ text, done: false });
    advance(BEHIND_SECONDS * 1000 + 50);
    // All of it but the last word, held until more arrives.
    expect(result.current.text).toBe("word ".repeat(119) + "word");
  });

  it("shows the rest of a whole answer within the drain time", () => {
    const text = "word ".repeat(400).trim();
    const { result, rerender } = paced("", false);
    rerender({ text, done: true });
    advance(DRAIN_SECONDS * 1000 + 50);
    expect(result.current.text).toBe(text);
  });

  it("calls back only once the whole text is shown and its last word has faded in", () => {
    const seen: string[] = [];
    let current = "";
    const { result, rerender } = paced("", false, () => seen.push(current));
    const text = "A finished sentence";
    rerender({ text, done: true });
    for (let i = 0; i < 200 && seen.length === 0; i++) {
      current = result.current.text;
      advance(16);
    }
    expect(seen).toEqual([text]);
    // And not before the fade had time to finish.
    const { result: r2, rerender: re2 } = paced("", false, () => seen.push("again"));
    re2({ text, done: true });
    let fullAt = -1;
    let calledAt = -1;
    for (let t = 0; t < 3000 && calledAt < 0; t += 16) {
      if (fullAt < 0 && r2.current.text === text) fullAt = t;
      advance(16);
      if (seen.includes("again")) calledAt = t;
    }
    expect(calledAt - fullAt).toBeGreaterThanOrEqual(WORD_FADE_MS - 32);
  });

  it("never trims a word already shown while the same text is asked for again", () => {
    const { result, rerender } = paced("Tickets booked", true);
    rerender({ text: "Tickets booked", done: false });
    expect(result.current.text).toBe("Tickets booked");
    advance(500);
    expect(result.current.text).toBe("Tickets booked");
  });

  it("shows only whole words of a replaced text, from its first render", () => {
    const { result, rerender } = paced("Plans confirmed", true);
    rerender({ text: "Plans canceled tomorrow", done: false });
    expect(result.current.text).toBe("Plans");
    advance(1000);
    expect(result.current.text).toBe("Plans canceled");
  });

  it("shows text complete on first render at once, without fading", () => {
    const { result } = paced("From the cache", true);
    expect(result.current).toEqual({ text: "From the cache", fade: false });
  });

  it("fades text that arrives after the first render, then settles", () => {
    const { result, rerender } = paced("", false);
    rerender({ text: "Fresh words", done: true });
    advance(100);
    expect(result.current.fade).toBe(true);
    // All shown and faded in: shown again (a summary hidden and shown
    // again), it doesn't fade a second time.
    advance(1000);
    expect(result.current).toEqual({ text: "Fresh words", fade: false });
  });

  it("drops a shown word the new text turns into a longer one, in render and frames alike", () => {
    const { result, rerender } = paced("", false);
    rerender({ text: "Plan accepted", done: false });
    for (let i = 0; i < 60 && result.current.text !== "Plan"; i++) advance(16);
    expect(result.current.text).toBe("Plan");
    rerender({ text: "Plans changed", done: false });
    expect(result.current.text).toBe("");
    advance(16);
    expect("Plans changed".startsWith(result.current.text)).toBe(true);
    expect(["", "Plans"]).toContain(result.current.text);
  });

  it("lets out text written without spaces a word at a time", () => {
    // Made-up Japanese: "I'll reply about tomorrow's meeting. Thanks."
    const text = "明日の会議について返信します。よろしくお願いします。";
    const { result, rerender } = paced("", false);
    rerender({ text, done: false });
    advance(BEHIND_SECONDS * 1000 + 50);
    expect(result.current.text.length).toBeGreaterThan(text.length / 2);
  });

  it("shows everything at once with reduced motion", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce") }));
    const { result, rerender } = paced("", false);
    rerender({ text: "word ".repeat(300).trim(), done: true });
    advance(16);
    expect(result.current.text).toBe("word ".repeat(300).trim());
  });
});
