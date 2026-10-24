import { describe, expect, it } from "vitest";
import { cellPxOf } from "./catalog";
import { EnvelopeScene } from "./envelopes";
import { SCENE_CELL_PX } from "./scene";

/** A seeded random number generator, so runs repeat. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1_664_525 + 1_013_904_223) % 2 ** 32;
    return s / 2 ** 32;
  };
}

describe("EnvelopeScene", () => {
  it("draws on a finer grid than the other scenes", () => {
    expect(cellPxOf("envelopes")).toBe(2);
    expect(cellPxOf("sandscape")).toBe(SCENE_CELL_PX);
  });

  it("flies, lands on the icon and words, and draws its envelopes", () => {
    // About the reader's size at 2px cells, with the icon and words in the middle.
    const cols = 400;
    const rows = 300;
    const scene = new EnvelopeScene({
      cols,
      rows,
      solid: new Uint8Array(cols * rows),
      letters: new Uint8Array(cols * rows),
      icon: { x0: 180, y0: 120, x1: 220, y1: 160 },
      words: { x0: 120, y0: 175, x1: 280, y1: 190 },
      rng: seeded(7),
    });
    let mostPerched = 0;
    for (let i = 0; i < 60 * 120; i++) {
      scene.frame(1 / 60, null);
      mostPerched = Math.max(mostPerched, scene.perched);
    }
    expect(mostPerched).toBeGreaterThan(0);
    const out = new Uint8Array(cols * rows);
    scene.draw(out);
    expect(out.some((v) => v > 0)).toBe(true);
  });
});
