import { describe, expect, it } from "vitest";
import {
  BEHIND_SECONDS,
  DRAIN_MIN_RATE,
  DRAIN_SECONDS,
  drainRate,
  MIN_RATE,
  nextShown,
  sharedStart,
  streamRate,
  wordCut,
  words,
} from "./pace";

describe("pacing", () => {
  it("lets text out at least at the slowest pace", () => {
    expect(streamRate(5)).toBe(MIN_RATE);
    expect(nextShown(0, 10, streamRate(10), 0.1)).toBeCloseTo(MIN_RATE * 0.1);
  });

  it("never shows more than has arrived", () => {
    expect(nextShown(8, 10, MIN_RATE, 1)).toBe(10);
    expect(nextShown(12, 10, MIN_RATE, 0.1)).toBe(10);
  });

  it("catches up with a big piece within the time it may fall behind", () => {
    // 600 characters at once while more is coming, at the pace set when
    // they arrived: shown in about half a second, not ten.
    const rate = streamRate(600);
    let shown = 0;
    let t = 0;
    while (shown < 600 && t < 5) {
      shown = nextShown(shown, 600, rate, 1 / 60);
      t += 1 / 60;
    }
    expect(t).toBeLessThanOrEqual(BEHIND_SECONDS + 1 / 30);
  });

  it("shows the rest of a whole answer within the drain time, at an even pace", () => {
    // ChatGPT's whole answer at once: 2,000 characters.
    const rate = drainRate(2000);
    let shown = 0;
    let t = 0;
    while (shown < 2000 && t < 5) {
      shown = nextShown(shown, 2000, rate, 1 / 60);
      t += 1 / 60;
    }
    expect(shown).toBe(2000);
    expect(t).toBeLessThanOrEqual(DRAIN_SECONDS + 1 / 30);
    // A few words left go at the slowest drain pace, not in a blink.
    expect(drainRate(20)).toBe(DRAIN_MIN_RATE);
  });
});

describe("wordCut", () => {
  const text = "Hi Maya, thanks";
  it("cuts back to the end of the last whole word", () => {
    expect(text.slice(0, wordCut(text, 5, false))).toBe("Hi");
    expect(text.slice(0, wordCut(text, 8, false))).toBe("Hi Maya,");
  });

  it("holds back the last word until more arrives or the answer is in", () => {
    expect(text.slice(0, wordCut(text, text.length, false))).toBe("Hi Maya,");
    expect(wordCut(text, text.length, true)).toBe(text.length);
  });

  it("breaks at new lines too", () => {
    expect("Hi\nMaya".slice(0, wordCut("Hi\nMaya", 4, false))).toBe("Hi");
  });
});

describe("sharedStart", () => {
  it("counts the characters two texts begin with", () => {
    expect(sharedStart("Hi Maya", "Hi Mayra")).toBe(6);
    expect(sharedStart("", "Hi")).toBe(0);
    expect(sharedStart("Hi", "Hi there")).toBe(2);
  });
});

describe("words", () => {
  it("keeps the spaces and line breaks between words", () => {
    expect(words("Hi  Maya,\nthanks")).toEqual(["Hi", "  ", "Maya,", "\n", "thanks"]);
    expect(words("").join("")).toBe("");
  });
});
