import { describe, expect, it } from "vitest";
import { ASCII_POND_DEFAULTS as T, pondChars, pondLook, strongest } from "./asciiPond";
import { PIXEL_POND_DEFAULTS, pondBand } from "./pixelPond";

describe("pondLook", () => {
  it("leaves calm water empty", () => {
    expect(pondLook(0, 0.5, true, T)).toBeNull();
    expect(pondLook(-T.cutoff / T.crestGain / 2, 0.5, true, T)).toBeNull();
  });

  it("draws a lit slope as a tile, denser and stronger the brighter it is", () => {
    const dim = pondLook(-0.05, 0.5, true, T)!;
    const bright = pondLook(-0.25, 0.5, true, T)!;
    expect(dim.kind).toBe("crest");
    expect(bright.kind).toBe("crest");
    if (dim.kind !== "crest" || bright.kind !== "crest") return;
    expect(T.crestRamp.indexOf(bright.char)).toBeGreaterThan(T.crestRamp.indexOf(dim.char));
    expect(bright.tileAlpha).toBeGreaterThan(dim.tileAlpha);
  });

  it("draws a slope facing away as a faint wave character, without a tile", () => {
    const look = pondLook(0.3, 0.5, true, T)!;
    expect(look.kind).toBe("trough");
    expect(T.troughRamp).toContain(look.char);
    expect(look.glyphAlpha).toBeLessThanOrEqual(T.troughAlpha);
  });

  it("flips some of the brightest water to pale tiles", () => {
    const look = pondLook(-1, 0.1, true, T)!;
    expect(look.kind === "crest" && look.hot).toBe(true);
  });
});

describe("strongest", () => {
  it("finds a ring passing through any part of a tall cell", () => {
    // Only a thin band near the cell's bottom is moving.
    const sample = (y: number) => (y > 10 && y < 14 ? -0.4 : 0);
    expect(strongest(sample, 0, 15)).toBe(-0.4);
  });
});

describe("pondChars", () => {
  it("includes every character the pond can draw", () => {
    const chars = pondChars(T);
    for (const c of [T.dropletChar, T.trailChar, T.plopChar, "~", "@"]) expect(chars).toContain(c);
  });
});

describe("the pixel pond's bands", () => {
  const P = PIXEL_POND_DEFAULTS;
  it("leaves calm water clear", () => {
    expect(pondBand(0, 1, 1, P)).toBeNull();
  });

  it("steps lit water into crest bands and dark water into trough bands", () => {
    const lit = pondBand(-1, 1, 1, P)!;
    expect(lit).toEqual({ kind: "crest", band: P.crestBands });
    const dark = pondBand(1, 1, 1, P)!;
    expect(dark).toEqual({ kind: "trough", band: P.troughBands });
  });

  it("dithers between neighboring blocks on a band's edge", () => {
    const edge = -1.5 / P.crestBands / P.crestGain;
    const seen = new Set<number>();
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++) seen.add(pondBand(edge, x, y, P)?.band ?? 0);
    expect(seen.size).toBeGreaterThan(1);
  });
});
