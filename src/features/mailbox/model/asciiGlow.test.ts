import { describe, expect, it } from "vitest";
import { parseStyle } from "../../emptyToys/model/style";
import {
  ASCII_GLOW_DEFAULTS as T,
  cellLook,
  cleared,
  clearing,
  falloff,
  roundedBoxDistance,
  shimmer,
  wake,
} from "./asciiGlow";

describe("parseStyle", () => {
  it("keeps a known style, else pixel art", () => {
    expect(parseStyle('"ascii"')).toBe("ascii");
    expect(parseStyle('"sixel"')).toBe("pixel");
    expect(parseStyle(null)).toBe("pixel");
    expect(parseStyle("{oops")).toBe("pixel");
  });
});

describe("falloff", () => {
  it("is full at the center, fades outwards and is gone past the reach", () => {
    expect(falloff(0, 0, T)).toBe(1);
    expect(falloff(0.5, 0, T)).toBeGreaterThan(falloff(0.8, 0, T));
    expect(falloff(1, 0, T)).toBe(0);
    expect(falloff(T.reach + 0.2, 0.05, T)).toBe(0);
  });
});

describe("cellLook", () => {
  it("leaves faint cells empty", () => {
    expect(cellLook(T.cutoff / 2, 0.5, 0, true, T)).toBeNull();
  });

  it("picks denser characters and stronger tiles as the glow brightens", () => {
    const dim = cellLook(0.2, 0.5, 0, true, T)!;
    const bright = cellLook(0.8, 0.5, 0, true, T)!;
    expect(bright.glyph).toBeGreaterThan(dim.glyph);
    expect(bright.tileAlpha).toBeGreaterThan(dim.tileAlpha);
    expect(bright.glyphAlpha).toBeGreaterThan(dim.glyphAlpha);
  });

  it("never picks the empty character, even shimmering down", () => {
    expect(cellLook(T.cutoff, 0, -1, true, T)!.glyph).toBe(1);
    expect(cellLook(1, 1, 1, true, T)!.glyph).toBe(T.ramp.length - 1);
  });

  it("flips most of the hottest cells, the same ones each time", () => {
    expect(cellLook(0.95, 0.1, 0, true, T)!.hot).toBe(true);
    expect(cellLook(0.95, 0.9, 0, true, T)!.hot).toBe(false);
    expect(cellLook(0.5, 0.1, 0, true, T)!.hot).toBe(false);
  });
});

describe("shimmer", () => {
  it("steps a notch only for a moment each turn, faster where it's bright", () => {
    let clock = 0.5;
    let notches = 0;
    for (let i = 0; i < 600; i++) {
      const s = shimmer(clock, 1, 0.9, 1 / 60, T);
      clock = s.clock;
      if (s.notch !== 0) notches++;
      expect([0, 1]).toContain(s.notch);
    }
    expect(notches).toBeGreaterThan(0);
    expect(notches).toBeLessThan(600 / 4);
  });
});

describe("wake", () => {
  it("fades the trail a moving glow leaves behind", () => {
    let heat = wake(0, 1, 1 / 60, T);
    expect(heat).toBeCloseTo(0.75);
    for (let i = 0; i < 60; i++) heat = wake(heat, 0, 1 / 60, T);
    expect(heat).toBeLessThan(0.1);
  });
});

describe("clearing", () => {
  const icon = { kind: "icon", x0: 100, y0: 100, x1: 156, y1: 156 } as const;
  const words = { kind: "words", x0: 60, y0: 180, x1: 200, y1: 198 } as const;

  it("leaves nothing on the icon, comes back smoothly, and is whole far off", () => {
    expect(clearing(128, 128, [icon], T)).toBe(0);
    const near = clearing(156 + T.iconPad + T.iconFeather * 0.25, 128, [icon], T);
    const far = clearing(156 + T.iconPad + T.iconFeather * 0.75, 128, [icon], T);
    expect(near).toBeGreaterThan(0);
    expect(far).toBeGreaterThan(near);
    expect(clearing(400, 400, [icon], T)).toBe(1);
  });

  it("follows the icon's rounded corners", () => {
    // Just past a corner diagonally is outside the rounded box, though
    // inside its square one.
    expect(roundedBoxDistance(101, 101, icon, 16)).toBeGreaterThan(0);
    expect(roundedBoxDistance(101, 101, icon, 0)).toBeLessThan(0);
  });

  it("the nearest shape decides", () => {
    expect(clearing(128, 189, [icon, words], T)).toBe(0);
  });

  it("thins characters or fades them, as tuned", () => {
    expect(cleared(0.8, 0.5, { ...T, thin: 1 })).toEqual({ v: 0.4, fade: 1 });
    expect(cleared(0.8, 0.5, { ...T, thin: 0 })).toEqual({ v: 0.8, fade: 0.5 });
  });
});

describe("cleared", () => {
  it("leaves nothing where the clearing leaves nothing, however it's split", () => {
    for (const thin of [0, 0.3, 0.7, 1]) {
      const c = cleared(1, 0, { ...T, thin });
      expect(c.v * c.fade).toBe(0);
    }
  });
});

describe("clearing a whole cell", () => {
  it("clears a cell that only overlaps a letter at its edge", () => {
    const words = { kind: "words", x0: 100, y0: 100, x1: 160, y1: 116 } as const;
    // A cell centered 3px past the letters' right edge, 8px wide.
    expect(clearing(163, 108, [words], T)).toBeGreaterThan(0);
    expect(clearing(163, 108, [words], T, 4, 7.5)).toBe(0);
  });
});
