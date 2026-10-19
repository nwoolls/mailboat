import { describe, expect, it } from "vitest";
import { DEFAULT_COMPOSING_PREFS, parseComposingPrefs } from "./composingPrefs";

describe("parseComposingPrefs", () => {
  it("defaults to 5 seconds when nothing or nonsense was saved", () => {
    expect(parseComposingPrefs(null)).toEqual(DEFAULT_COMPOSING_PREFS);
    expect(parseComposingPrefs("{oops")).toEqual(DEFAULT_COMPOSING_PREFS);
    expect(parseComposingPrefs('{"undoSendSeconds":7}')).toEqual(DEFAULT_COMPOSING_PREFS);
  });
  it("keeps a saved choice", () => {
    expect(parseComposingPrefs('{"undoSendSeconds":30}').undoSendSeconds).toBe(30);
  });
});
