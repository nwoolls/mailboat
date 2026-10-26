import { beforeEach, describe, expect, it } from "vitest";
import { carryOverSettings } from "./carryOver";

describe("carryOverSettings", () => {
  beforeEach(() => localStorage.clear());

  it("copies settings saved under the old names, and keeps the old ones", () => {
    localStorage.setItem("old.list", '{"density":"compact"}');
    localStorage.setItem("old.textSize", "1.1");
    localStorage.setItem("unrelated", "x");
    carryOverSettings(localStorage, "old.");
    expect(localStorage.getItem("prefs.list")).toBe('{"density":"compact"}');
    expect(localStorage.getItem("prefs.textSize")).toBe("1.1");
    expect(localStorage.getItem("old.list")).toBe('{"density":"compact"}');
    expect(localStorage.getItem("prefs.unrelated")).toBeNull();
  });

  it("never overwrites a setting already saved under the new name", () => {
    localStorage.setItem("old.list", "old");
    localStorage.setItem("prefs.list", "new");
    carryOverSettings(localStorage, "old.");
    expect(localStorage.getItem("prefs.list")).toBe("new");
  });
});
