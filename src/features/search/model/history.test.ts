import { describe, expect, it } from "vitest";
import { forget, MAX_HISTORY, parseHistory, remember, suggestions } from "./history";

describe("search history", () => {
  it("puts the newest first, once whatever its case, and keeps only so many", () => {
    let h = remember([], "  invoice   march ");
    expect(h).toEqual(["invoice march"]);
    h = remember(h, "from:sam");
    h = remember(h, "Invoice March");
    expect(h).toEqual(["Invoice March", "from:sam"]);
    expect(remember(h, "   ")).toBe(h);
    for (let i = 0; i < 20; i++) h = remember(h, `q${i}`);
    expect(h).toHaveLength(MAX_HISTORY);
    expect(h[0]).toBe("q19");
  });

  it("forgets one, whatever its case", () => {
    expect(forget(["a", "Bee"], "bee")).toEqual(["a"]);
  });

  it("offers all with nothing typed, else those containing it", () => {
    const h = ["invoice march", "from:sam", "Invoice"];
    expect(suggestions(h, "")).toEqual(h);
    expect(suggestions(h, "invo")).toEqual(["invoice march", "Invoice"]);
    expect(suggestions(h, "invoice")).toEqual(["invoice march"]);
  });

  it("reads back only what makes sense", () => {
    expect(parseHistory('["a", 3, "", "b"]')).toEqual(["a", "b"]);
    expect(parseHistory("{oops")).toEqual([]);
    expect(parseHistory('{"a":1}')).toEqual([]);
    expect(parseHistory(null)).toEqual([]);
  });
});
