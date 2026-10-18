import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCREENSAVER_PREFS,
  makeScene,
  parsePrefs,
  pickScene,
  SCREENSAVERS,
} from "./catalog";
import { SHADES, SLOT_COUNT, seeded, testSetup } from "./scene";

describe("screensaver prefs", () => {
  it("defaults anything missing or unknown", () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_SCREENSAVER_PREFS);
    expect(parsePrefs("nope")).toEqual(DEFAULT_SCREENSAVER_PREFS);
    expect(parsePrefs('{"choice":"toasters","palette":"plaid"}')).toEqual(
      DEFAULT_SCREENSAVER_PREFS,
    );
    expect(parsePrefs('{"choice":"koi","palette":"dusk"}')).toEqual({
      choice: "koi",
      palette: "dusk",
    });
  });
});

describe("pickScene", () => {
  it("plays what's asked, else the choice, else a random one that isn't the last", () => {
    expect(pickScene("rain", "koi", null, seeded())).toBe("rain");
    expect(pickScene(null, "koi", "koi", seeded())).toBe("koi");
    const rng = seeded(3);
    for (let i = 0; i < 50; i++) expect(pickScene(null, "random", "lava", rng)).not.toBe("lava");
  });
});

describe("every scene", () => {
  for (const { id } of SCREENSAVERS)
    it(`${id} runs a minute, with and without the pointer, drawing only palette values`, () => {
      const setup = testSetup(90, 80, seeded());
      const scene = makeScene(id, setup);
      const out = new Uint8Array(90 * 80);
      let drew = false;
      for (let i = 0; i < 60 * 60; i++) {
        const pointer = i % 600 < 300 ? null : { x: 20 + (i % 50), y: 30 + ((i / 7) % 20) };
        scene.frame(1 / 60, pointer);
        if (i % 120 === 0) {
          scene.draw(out);
          drew ||= out.some((v) => v > 0);
          for (const v of out) expect(v).toBeLessThanOrEqual(SLOT_COUNT * SHADES);
        }
      }
      expect(drew).toBe(true);
    });
});
