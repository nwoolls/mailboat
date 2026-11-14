import { describe, expect, it } from "vitest";
import { DEFAULT_TOY } from "../../emptyToys/model/toys";
import { emptyToy, lastToy, toyboxStyle } from "../../emptyToys/ui/prefs";
import { restoreWindowDefaults } from "./restoreDefaults";

describe("restoring the default settings", () => {
  it("puts the Toybox back as it started: the style, the toy and the toy it remembers", () => {
    toyboxStyle.set("ascii");
    emptyToy.set("none");
    lastToy.set("sky");
    restoreWindowDefaults();
    expect(toyboxStyle.get()).toBe("pixel");
    expect(emptyToy.get()).toBe(DEFAULT_TOY);
    expect(lastToy.get()).toBe(DEFAULT_TOY);
  });
});
