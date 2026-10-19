import { describe, expect, it } from "vitest";
import { DEFAULT_COMPOSING_PREFS, parseComposingPrefs } from "./composingPrefs";

describe("parseComposingPrefs", () => {
  it("defaults when nothing or nonsense was saved", () => {
    expect(parseComposingPrefs(null)).toEqual(DEFAULT_COMPOSING_PREFS);
    expect(parseComposingPrefs("{oops")).toEqual(DEFAULT_COMPOSING_PREFS);
    expect(
      parseComposingPrefs(
        '{"undoSendSeconds":7,"defaultFrom":{"accountId":"x"},"style":{"font":"Papyrus","size":"99px"}}',
      ),
    ).toEqual(DEFAULT_COMPOSING_PREFS);
  });
  it("keeps saved choices, and fills in ones saved before they existed", () => {
    expect(parseComposingPrefs('{"undoSendSeconds":30}')).toEqual({
      ...DEFAULT_COMPOSING_PREFS,
      undoSendSeconds: 30,
    });
    const all = parseComposingPrefs(
      '{"defaultFrom":{"accountId":2,"email":"me@y.com"},"style":{"font":"Georgia, serif","size":"18px"}}',
    );
    expect(all.defaultFrom).toEqual({ accountId: 2, email: "me@y.com" });
    expect(all.style).toEqual({ font: "Georgia, serif", size: "18px" });
  });
});
