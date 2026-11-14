import { describe, expect, it } from "vitest";
import {
  chunkCells,
  coverageChar,
  dominantInk,
  lookFor,
  RESTYLED,
  SCREENSAVER_LOOK_DEFAULTS as T,
} from "./looks";

describe("which screensavers are restyled", () => {
  it("draws restyled scenes in the chosen style, the rest as they were", () => {
    expect(lookFor("jellyfish", "pixel")).toBe("chunky");
    expect(lookFor("jellyfish", "ascii")).toBe("ascii");
    expect(lookFor("starfield", "pixel")).toBe("chunky");
    expect(lookFor("fireworks", "ascii")).toBe("ascii");
    expect(lookFor("rain", "pixel")).toBe("chunky");
    expect(lookFor("code", "ascii")).toBe("ascii");
    expect(lookFor("koi", "ascii")).toBe("fine");
    expect(RESTYLED.has("koi")).toBe(false);
  });
});

describe("chunky pixel art", () => {
  it("makes blocks of about the chosen size in whole cells", () => {
    expect(chunkCells(2, T)).toBe(3);
    expect(chunkCells(3, T)).toBe(2);
    expect(chunkCells(1, T)).toBe(6);
    expect(chunkCells(20, T)).toBe(1);
  });

  it("gives a block its most common color, as solid as its cells on average", () => {
    const { ink, opacity } = dominantInk([0, 5, 5, 9], [255, 255, 255, 255]);
    expect(ink).toBe(5);
    expect(opacity).toBe(Math.round((255 * 3) / 4));
  });

  it("weighs colors by how solid they are", () => {
    expect(dominantInk([5, 5, 9], [40, 40, 255]).ink).toBe(9);
  });

  it("leaves an empty block clear", () => {
    expect(dominantInk([0, 0, 0, 0], [255, 255, 255, 255])).toEqual({ ink: 0, opacity: 0 });
  });
});

describe("ASCII art", () => {
  it("picks denser characters as more of a cell is covered, none when barely", () => {
    expect(coverageChar(0, T)).toBeNull();
    const thin = coverageChar(0.2, T)!;
    const thick = coverageChar(0.9, T)!;
    expect(T.ramp.indexOf(thick)).toBeGreaterThan(T.ramp.indexOf(thin));
    expect(coverageChar(1, T)).toBe(T.ramp.at(-1));
  });
});
