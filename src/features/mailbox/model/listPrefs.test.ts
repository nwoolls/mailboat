import { describe, expect, it } from "vitest";
import { DEFAULT_LIST_PREFS, parseListPrefs } from "./listPrefs";

describe("parseListPrefs", () => {
  it("defaults when nothing or nonsense was saved", () => {
    expect(parseListPrefs(null)).toEqual(DEFAULT_LIST_PREFS);
    expect(parseListPrefs("{oops")).toEqual(DEFAULT_LIST_PREFS);
    expect(parseListPrefs('{"swipeLeft":"explode"}')).toEqual(DEFAULT_LIST_PREFS);
  });
  it("keeps saved choices", () => {
    expect(parseListPrefs('{"swipeLeft":"none","swipeRight":"star"}')).toEqual({
      swipeLeft: "none",
      swipeRight: "star",
    });
  });
});
