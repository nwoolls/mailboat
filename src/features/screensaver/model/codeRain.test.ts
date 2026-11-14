import { describe, expect, it } from "vitest";
import {
  CODE_RAIN_DEFAULTS as T,
  litAt,
  makeCodeRain,
  resizeCodeRain,
  stepCodeRain,
} from "./codeRain";
import { seeded } from "./scene";

describe("code rain", () => {
  it("is already raining when it starts, and its streams fall", () => {
    const rain = makeCodeRain(80, 40, T, seeded(1));
    const falling = rain.streams.flat();
    expect(falling.length).toBeGreaterThan(10);
    const heads = falling.map((s) => s.head);
    stepCodeRain(rain, 0.5, T, seeded(2));
    falling.forEach((s, i) => expect(s.head).toBeGreaterThan(heads[i]!));
  });

  it("lights a stream's head brightest, fading along the trail behind it", () => {
    const rain = makeCodeRain(4, 30, T, seeded(1));
    rain.streams = [[{ head: 20.5, speed: 9, length: 10 }], [], [], []];
    const head = litAt(rain, 0, 20);
    expect(head.head).toBe(true);
    const behind = litAt(rain, 0, 15);
    expect(behind.head).toBe(false);
    expect(behind.lit).toBeLessThan(head.lit);
    expect(behind.lit).toBeGreaterThan(0);
    // Ahead of the head, and past the trail, nothing.
    expect(litAt(rain, 0, 22).lit).toBe(0);
    expect(litAt(rain, 0, 5).lit).toBe(0);
  });

  it("cascades down every column now and then, and says so (to nod the icon)", () => {
    const rain = makeCodeRain(30, 40, T, seeded(3));
    rain.nextCascade = 1;
    let cascaded = false;
    for (let i = 0; i < 90 && !cascaded; i++) cascaded = stepCodeRain(rain, 1 / 60, T, seeded(i));
    expect(cascaded).toBe(true);
    for (const col of rain.streams) expect(col.some((s) => s.head < 3)).toBe(true);
  });

  it("flickers: characters change as it runs", () => {
    const rain = makeCodeRain(40, 30, T, seeded(1));
    const before = rain.glyphs.slice();
    const rng = seeded(9);
    for (let i = 0; i < 60; i++) stepCodeRain(rain, 1 / 60, T, rng);
    const changed = rain.glyphs.filter((g, i) => g !== before[i]).length;
    expect(changed).toBeGreaterThan(rain.glyphs.length * 0.3);
  });

  it("carries on through a resize: the columns that remain keep their streams", () => {
    const rain = makeCodeRain(40, 30, T, seeded(1));
    const kept = rain.streams.slice(0, 30);
    resizeCodeRain(rain, 30, 50, seeded(2));
    expect(rain.streams).toHaveLength(30);
    rain.streams.forEach((col, i) => expect(col).toBe(kept[i]));
    expect(rain.glyphs).toHaveLength(30 * 50);
  });
});
