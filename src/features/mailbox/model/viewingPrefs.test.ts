import { describe, expect, it } from "vitest";
import { DEFAULT_VIEWING_PREFS, inOrder, parseViewingPrefs } from "./viewingPrefs";

describe("parseViewingPrefs", () => {
  it("defaults when nothing or nonsense was saved", () => {
    expect(parseViewingPrefs(null)).toEqual(DEFAULT_VIEWING_PREFS);
    expect(parseViewingPrefs("{oops")).toEqual(DEFAULT_VIEWING_PREFS);
    expect(parseViewingPrefs('{"afterRemoval":"sideways","markRead":"soon"}')).toEqual(
      DEFAULT_VIEWING_PREFS,
    );
  });
  it("keeps saved choices, and fills in ones saved before they existed", () => {
    expect(parseViewingPrefs('{"afterRemoval":"none"}')).toEqual({
      ...DEFAULT_VIEWING_PREFS,
      afterRemoval: "none",
    });
    const all = parseViewingPrefs('{"markRead":"never","order":"newestFirst"}');
    expect(all.markRead).toBe("never");
    expect(all.order).toBe("newestFirst");
    expect(all.deleteKey).toBe("trash");
    expect(parseViewingPrefs('{"deleteKey":"archive"}').deleteKey).toBe("archive");
    expect(parseViewingPrefs('{"deleteKey":"shred"}').deleteKey).toBe("trash");
    expect(all.searchSpamTrash).toBe(false);
    expect(parseViewingPrefs('{"searchSpamTrash":true}').searchSpamTrash).toBe(true);
    expect(parseViewingPrefs('{"searchSpamTrash":"yes"}').searchSpamTrash).toBe(false);
  });
});

describe("inOrder", () => {
  it("keeps oldest first, or turns it round without changing the original", () => {
    const messages = [1, 2, 3];
    expect(inOrder(messages, "oldestFirst")).toEqual([1, 2, 3]);
    expect(inOrder(messages, "newestFirst")).toEqual([3, 2, 1]);
    expect(messages).toEqual([1, 2, 3]);
  });
});
