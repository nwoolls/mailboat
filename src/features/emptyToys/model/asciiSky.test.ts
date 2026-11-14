import { describe, expect, it } from "vitest";
import { moonLit, noise, rayChar, SKY_CHARS, skyChar } from "./asciiSky";
import type { Cell, Material } from "./skyScene";
import { duskiness, skyAt, skyColorsAt } from "./sky";

const cell = (material: Material, more: Partial<Cell> = {}): Cell => ({
  material,
  color: [100, 120, 140],
  edge: 0,
  slope: 0,
  glow: 0,
  ...more,
});

describe("moonLit", () => {
  it("lights nothing at new moon and all of it at full", () => {
    expect(moonLit(0, 0, 0)).toBe(false);
    expect(moonLit(0.9, 0, 0.001)).toBe(false);
    expect(moonLit(-0.9, 0, 0.5)).toBe(true);
    expect(moonLit(0.9, 0, 0.5)).toBe(true);
  });

  it("lights the right half at first quarter and the left at last", () => {
    expect(moonLit(0.5, 0, 0.25)).toBe(true);
    expect(moonLit(-0.5, 0, 0.25)).toBe(false);
    expect(moonLit(-0.5, 0, 0.75)).toBe(true);
    expect(moonLit(0.5, 0, 0.75)).toBe(false);
  });
});

describe("skyChar", () => {
  it("leaves the sky to its wash", () => {
    expect(skyChar(cell("sky"), 0.5)).toBeNull();
  });

  it("draws ridgelines along their slope", () => {
    expect(skyChar(cell("mountain", { edge: 1, slope: 1 }), 0.5)).toBe("/");
    expect(skyChar(cell("mountain", { edge: -1, slope: -1 }), 0.5)).toBe("\\");
    expect(skyChar(cell("mountain", { edge: 1, slope: 0 }), 0.5)).toBe("^");
  });

  it("tufts the grass along its top", () => {
    expect(['"', ","]).toContain(skyChar(cell("grass", { edge: 1 }), 0.2));
  });

  it("twinkles stars brighter as they glow", () => {
    expect(skyChar(cell("star", { glow: 0.1 }), 0.5)).toBeNull();
    expect(skyChar(cell("star", { glow: 0.5 }), 0.5)).toBe(".");
    expect(skyChar(cell("star", { glow: 0.9 }), 0.5)).toBe("+");
  });

  it("only draws characters the painter prepares", () => {
    const materials: Material[] = [
      "star",
      "sparkle",
      "sun",
      "moon",
      "cloud",
      "mountain",
      "hill",
      "grass",
      "flower",
    ];
    for (const m of materials)
      for (const glow of [-1, 0, 0.3, 0.6, 1])
        for (const edge of [-1, 0, 1])
          for (const slope of [-1, 0, 1])
            for (const seed of [0.1, 0.4, 0.6, 0.9]) {
              const c = skyChar(cell(m, { glow, edge, slope }), seed);
              if (c) expect(SKY_CHARS).toContain(c);
            }
  });
});

describe("rays", () => {
  it("draw along their direction", () => {
    expect(rayChar(0)).toBe("-");
    expect(rayChar(Math.PI / 2)).toBe("|");
    expect(rayChar(Math.PI / 4)).toBe("\\");
    expect(rayChar((3 * Math.PI) / 4)).toBe("/");
  });
});

describe("noise", () => {
  it("is smooth and repeatable", () => {
    expect(noise(3.2, 7.7)).toBe(noise(3.2, 7.7));
    expect(Math.abs(noise(3.2, 7.7) - noise(3.21, 7.7))).toBeLessThan(0.05);
  });
});

describe("sky colors", () => {
  it("match the sky's own, as numbers", () => {
    for (const hour of [3, 6.5, 12, 19, 22]) {
      const { top, horizon } = skyColorsAt(hour);
      expect(skyAt(hour).top).toBe(`rgb(${top.join(" ")})`);
      expect(skyAt(hour).horizon).toBe(`rgb(${horizon.join(" ")})`);
    }
  });

  it("are dusky only near sunrise and sunset", () => {
    expect(duskiness(6.5)).toBe(1);
    expect(duskiness(19.5)).toBe(1);
    expect(duskiness(12)).toBe(0);
    expect(duskiness(0)).toBe(0);
  });
});
