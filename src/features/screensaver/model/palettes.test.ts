import { describe, expect, it } from "vitest";
import { ACCENTS } from "../../settings/model/appearance";
import { colorTable, mix, PALETTES, paletteColors, paletteFor, parseColor } from "./palettes";
import { ink, SLOT } from "./scene";

describe("palettes", () => {
  it("reads hex colours and every Appearance accent", () => {
    expect(parseColor("#0a84ff")).toEqual([10, 132, 255]);
    expect(parseColor("hsl(0 100% 50%)")).toEqual([255, 0, 0]);
    for (const a of ACCENTS) expect(parseColor(a.color)).not.toBeNull();
    expect(parseColor("teal")).toBeNull();
  });

  it("puts the configured accent in Mono + accent, and derives Accent from it", () => {
    const accent = [200, 40, 120] as const;
    expect(paletteColors("mono", accent)[SLOT.accent]).toEqual(accent);
    const tints = paletteColors("accent", accent);
    expect(tints[SLOT.accent]).toEqual(accent);
    expect(tints[SLOT.dark]).toEqual(mix(accent, [0, 0, 0], 0.5));
  });

  it("keeps Mono's other colours grey", () => {
    for (const [r, g, b] of paletteColors("mono", null).slice(0, 4)) {
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(16);
    }
  });

  it("has five colours for every palette and an opaque entry for every ink", () => {
    for (const p of PALETTES) {
      const colors = paletteColors(p.id, null);
      expect(colors).toHaveLength(5);
      const table = colorTable(colors);
      expect(table[0]).toBe(0);
      expect(table[ink(SLOT.accent, 3)]! >>> 24).toBe(255);
    }
    expect(paletteFor("nope")).toBe("mono");
  });
});
