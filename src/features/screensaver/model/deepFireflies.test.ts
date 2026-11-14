import { describe, expect, it } from "vitest";
import { GLOW_RAMP, glowChar, grassHeight } from "./deepFireflies";
import { FireflyScene } from "./fireflies";
import { seeded, testSetup } from "./scene";

describe("fireflies in the Toybox's styles", () => {
  it("draw a flash in ASCII brightest at its heart, fading out", () => {
    expect(glowChar(1)).toBe("@");
    expect(GLOW_RAMP.indexOf(glowChar(0.3)!)).toBeLessThan(GLOW_RAMP.indexOf("@"));
    // A faint edge: one of the faintest characters.
    expect(GLOW_RAMP.indexOf(glowChar(0.08)!)).toBeLessThanOrEqual(1);
    expect(glowChar(0.02)).toBeNull();
  });

  it("grow grass of uneven height along the bottom, the same each time", () => {
    const heights = Array.from({ length: 200 }, (_, x) => grassHeight(x * 4));
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(0.4);
    expect(Math.max(...heights)).toBeLessThanOrEqual(1);
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(0.3);
    expect(grassHeight(123)).toBe(grassHeight(123));
  });

  it("carry on through a resize: the flies stay where they were", () => {
    const scene = new FireflyScene(testSetup(200, 150, seeded(2)));
    for (let i = 0; i < 60 * 3; i++) scene.frame(1 / 60, null);
    const at = scene.flies.map((f) => [f.x, f.y]);
    scene.resize(testSetup(260, 180, seeded(3)));
    expect(scene.flies.map((f) => [f.x, f.y])).toEqual(at);
    expect(scene.size).toEqual({ cols: 260, rows: 180 });
  });

  it("can be fewer, and flash less often", () => {
    const flashes = (pace: number) => {
      const scene = new FireflyScene(testSetup(200, 150, seeded(4)), 10);
      scene.pace = pace;
      let lit = 0;
      for (let i = 0; i < 60 * 20; i++) {
        scene.frame(1 / 60, null);
        // Rising into a flash: just past the start of its cycle.
        for (const f of scene.flies) if (f.phase < f.rate * pace * (1 / 60)) lit++;
      }
      return { lit, count: scene.flies.length };
    };
    const usual = flashes(1);
    const calm = flashes(0.5);
    expect(usual.count).toBe(10);
    expect(calm.lit).toBeLessThan(usual.lit * 0.7);
  });
});
