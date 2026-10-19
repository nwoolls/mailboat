import { describe, expect, it } from "vitest";
import { DEFAULT_VIEWING_PREFS, parseViewingPrefs } from "./viewingPrefs";

describe("parseViewingPrefs", () => {
  it("defaults when nothing or nonsense was saved", () => {
    expect(parseViewingPrefs(null)).toEqual(DEFAULT_VIEWING_PREFS);
    expect(parseViewingPrefs("{oops")).toEqual(DEFAULT_VIEWING_PREFS);
    expect(parseViewingPrefs('{"afterRemoval":"sideways"}')).toEqual(DEFAULT_VIEWING_PREFS);
  });
  it("keeps a saved choice", () => {
    expect(parseViewingPrefs('{"afterRemoval":"none"}').afterRemoval).toBe("none");
  });
});
