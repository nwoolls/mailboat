import { describe, expect, it } from "vitest";
import { DEFAULT_LIST_PREFS, parseListPrefs, rowStep } from "./listPrefs";

describe("parseListPrefs", () => {
  it("defaults when nothing or nonsense was saved", () => {
    expect(parseListPrefs(null)).toEqual(DEFAULT_LIST_PREFS);
    expect(parseListPrefs("{oops")).toEqual(DEFAULT_LIST_PREFS);
    expect(parseListPrefs('{"swipeLeft":"explode"}')).toEqual(DEFAULT_LIST_PREFS);
  });
  it("keeps saved choices", () => {
    expect(parseListPrefs('{"swipeLeft":"none","swipeRight":"star"}')).toEqual({
      ...DEFAULT_LIST_PREFS,
      swipeLeft: "none",
      swipeRight: "star",
    });
    expect(parseListPrefs('{"density":"roomy","previewLines":2}')).toMatchObject({
      density: "roomy",
      previewLines: 2,
    });
    expect(parseListPrefs('{"density":"huge","previewLines":7}')).toEqual(DEFAULT_LIST_PREFS);
  });
});

describe("rowStep", () => {
  it("keeps today's rows by default and grows with room and preview lines", () => {
    expect(rowStep(DEFAULT_LIST_PREFS)).toBe(72);
    expect(rowStep({ density: "compact", previewLines: 0 })).toBe(48);
    expect(rowStep({ density: "roomy", previewLines: 2 })).toBe(102);
  });
});
